// Redacao da resposta, com fallback deterministico OBRIGATORIO. Modelo
// multiunidade: a IA recebe o medicamento + seu estoque em cada unidade e
// redige informando ONDE esta disponivel. Nunca decide disponibilidade.
// Provedores: template (gratis) | gemini (Google, gratis) | anthropic (pago).

import type { MedicamentoComEstoque } from './tipos.ts';
import { montarRespostaDeterministica, descreverItem, formatarAtualizacao } from './mensagens.ts';
import { config, usaIA, ehDemonstracao } from '../config.ts';

const SISTEMA = [
  'Você é o assistente virtual informativo de uma Farmácia Municipal, no WhatsApp.',
  'A rede tem mais de uma unidade (farmácia). Sua única função é redigir, em português',
  'claro e cordial, a resposta sobre a DISPONIBILIDADE de um medicamento, informando EM QUAIS',
  'UNIDADES ele consta, a partir EXCLUSIVAMENTE do estoque por unidade fornecido pelo sistema.',
  '',
  'Regras obrigatórias:',
  '1. Baseie-se apenas nos dados fornecidos. Nunca invente unidades, quantidades ou datas.',
  '2. Diga claramente em quais unidades está disponível, em quais está em falta ou com estoque baixo.',
  '3. Inclua a ressalva de que o estoque muda ao longo do dia.',
  '4. Informe a data/hora da última atualização como fornecida.',
  '5. Não peça CPF, cartão SUS, nome, endereço, receita ou qualquer dado de saúde.',
  '',
  'Proibições:',
  '6. Não diagnostique, não indique, não sugira substituição, não comente posologia/uso.',
  '7. Não reserve, separe nem prometa medicamento. Não estime prazo de reposição.',
  '',
  'Formato: 2 a 5 frases curtas, tom acolhedor, sem emojis excessivos, sem markdown.',
].join('\n');

function conteudoUsuario(m: MedicamentoComEstoque): string {
  const situacaoTxt: Record<string, string> = {
    DISPONIVEL: 'DISPONÍVEL',
    'ESTOQUE BAIXO': 'DISPONÍVEL em quantidade reduzida (estoque baixo)',
    'EM FALTA': 'EM FALTA',
  };
  const linhas = m.estoques.map(
    (e) =>
      `- ${e.unidade_nome}: ${situacaoTxt[e.situacao]} (atualizado em ${formatarAtualizacao(e.atualizado_em)})`,
  );
  return [
    `Medicamento: ${descreverItem(m.medicamento)}`,
    '',
    'Estoque por unidade (única fonte permitida):',
    ...(linhas.length ? linhas : ['- Sem registro de estoque em nenhuma unidade.']),
    '',
    'Redija a resposta ao cidadão, dizendo em quais unidades ele encontra o medicamento.',
  ].join('\n');
}

// Limitador de concorrencia para nao estourar cota.
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

// --- Gemini (Google AI Studio), via REST ---
async function gerarGemini(m: MedicamentoComEstoque): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.modelo}:generateContent?key=${config.gemini.apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: 'user', parts: [{ text: conteudoUsuario(m) }] }],
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(`Gemini ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const texto = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  if (!texto) throw new Error('Gemini: resposta vazia');
  return texto;
}

// --- Anthropic (Claude), via SDK (import dinamico) ---
type ClienteAnthropic = {
  messages: {
    create: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};
let clienteAnthropic: Promise<ClienteAnthropic> | null = null;
async function gerarAnthropic(m: MedicamentoComEstoque): Promise<string> {
  if (!clienteAnthropic) {
    clienteAnthropic = (async () => {
      const mod: any = await import('@anthropic-ai/sdk');
      const Anthropic = mod.default;
      return new Anthropic({
        apiKey: config.anthropic.apiKey,
        timeout: 9000,
        maxRetries: 0,
      }) as ClienteAnthropic;
    })();
  }
  const sb = await clienteAnthropic;
  const resp = await sb.messages.create({
    model: config.anthropic.modelo,
    max_tokens: 500,
    system: SISTEMA,
    messages: [{ role: 'user', content: conteudoUsuario(m) }],
  });
  const texto = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
  if (!texto) throw new Error('Anthropic: resposta vazia');
  return texto;
}

/** Redige a resposta; em qualquer falha, cai no template deterministico. */
export async function redigirComIA(m: MedicamentoComEstoque): Promise<string> {
  const texto = await gerar(m);
  return ehDemonstracao ? `${texto}\n\n⚠️ Demonstração com dados fictícios.` : texto;
}

async function gerar(m: MedicamentoComEstoque): Promise<string> {
  if (!usaIA) return montarRespostaDeterministica(m);
  await adquirir();
  try {
    const texto = config.iaProvedor === 'gemini' ? await gerarGemini(m) : await gerarAnthropic(m);
    return texto || montarRespostaDeterministica(m);
  } catch {
    return montarRespostaDeterministica(m);
  } finally {
    liberar();
  }
}
