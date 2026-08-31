// Redacao da resposta pela IA, com fallback deterministico OBRIGATORIO.
//
// A IA recebe SOMENTE o registro devolvido pelo banco e as regras de redacao.
// Nunca decide disponibilidade. Se a API falhar, estourar cota (429) ou nao
// estar configurada, cai em montarRespostaDeterministica — o cidadao recebe a
// informacao correta montada por template. (CLAUDE.md secoes 5 e 6.)

import type { RegistroMedicamento } from './tipos.ts';
import { montarRespostaDeterministica, descreverItem, formatarAtualizacao } from './mensagens.ts';
import { config, usaIA, ehDemonstracao } from '../config.ts';

const SISTEMA = [
  'Você é o assistente virtual informativo de uma Farmácia Municipal, no WhatsApp.',
  'Sua única função é redigir, em português claro e cordial, a resposta sobre a DISPONIBILIDADE',
  'de um medicamento, a partir EXCLUSIVAMENTE do registro fornecido pelo sistema.',
  '',
  'Regras obrigatórias:',
  '1. Baseie-se apenas no registro fornecido. Nunca invente dados que não estejam nele.',
  '2. Nunca afirme disponibilidade sem o registro. Você sempre recebe um registro válido.',
  '3. Em resposta positiva, inclua a ressalva de que o estoque muda ao longo do dia.',
  '4. Informe a data/hora da última atualização exatamente como fornecida.',
  '5. Não peça CPF, cartão SUS, nome, endereço, receita ou qualquer dado de saúde.',
  '',
  'Proibições:',
  '6. Não diagnostique, não indique, não sugira substituição, não comente posologia,',
  '   efeitos, interações ou uso. Isso é papel do profissional de saúde.',
  '7. Não reserve, separe nem prometa medicamento.',
  '8. Não estime prazo de reposição.',
  '',
  'Formato: 2 a 4 frases curtas, tom acolhedor, sem emojis excessivos. Não use markdown.',
].join('\n');

function conteudoUsuario(r: RegistroMedicamento): string {
  const situacaoTexto = {
    DISPONIVEL: 'consta como DISPONÍVEL',
    'ESTOQUE BAIXO': 'consta como DISPONÍVEL em quantidade reduzida (estoque baixo)',
    'EM FALTA': 'consta como EM FALTA',
  }[r.situacao];

  return [
    'Registro devolvido pelo sistema (única fonte permitida):',
    `- Medicamento: ${descreverItem(r)}`,
    `- Situação: ${situacaoTexto}`,
    `- Unidade: ${r.unidade_nome ?? 'não informada'}`,
    `- Última atualização: ${formatarAtualizacao(r.atualizado_em)}`,
    '',
    'Redija a resposta ao cidadão seguindo as regras.',
  ].join('\n');
}

// Limitador simples de concorrencia para nao estourar a cota da API.
const MAX_CONCORRENCIA = 4;
let emVoo = 0;
const fila: Array<() => void> = [];

function adquirir(): Promise<void> {
  if (emVoo < MAX_CONCORRENCIA) {
    emVoo++;
    return Promise.resolve();
  }
  return new Promise((resolve) => fila.push(resolve));
}

function liberar(): void {
  emVoo--;
  const proximo = fila.shift();
  if (proximo) {
    emVoo++;
    proximo();
  }
}

type ClienteAnthropic = {
  messages: {
    create: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

let clientePromessa: Promise<ClienteAnthropic> | null = null;

async function cliente(): Promise<ClienteAnthropic> {
  if (!clientePromessa) {
    clientePromessa = (async () => {
      const mod = await import('@anthropic-ai/sdk');
      const Anthropic = mod.default;
      return new Anthropic({ apiKey: config.anthropic.apiKey }) as unknown as ClienteAnthropic;
    })();
  }
  return clientePromessa;
}

/**
 * Redige a resposta. Tenta a IA; em qualquer falha, cai no template
 * deterministico. O aviso de demonstracao (dados ficticios) e anexado aqui,
 * fora do controle da IA, para garantir que sempre apareca.
 */
export async function redigirComIA(r: RegistroMedicamento): Promise<string> {
  const texto = await gerar(r);
  return ehDemonstracao ? `${texto}\n\n⚠️ Demonstração com dados fictícios.` : texto;
}

async function gerar(r: RegistroMedicamento): Promise<string> {
  if (!usaIA) return montarRespostaDeterministica(r);
  await adquirir();
  try {
    const sb = await cliente();
    const resp = await sb.messages.create({
      model: config.anthropic.modelo,
      max_tokens: 400,
      system: SISTEMA,
      messages: [{ role: 'user', content: conteudoUsuario(r) }],
    });
    const texto = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();
    return texto || montarRespostaDeterministica(r);
  } catch {
    return montarRespostaDeterministica(r);
  } finally {
    liberar();
  }
}
