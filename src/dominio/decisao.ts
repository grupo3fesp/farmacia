// Logica de decisao — o coracao do sistema (CLAUDE.md secao 5).
//
// Regra de ouro: a IA NUNCA decide se o medicamento existe. Toda a ramificacao
// aqui e deterministica. So o ramo `redigir_ia` aciona o modelo, e mesmo assim
// passando apenas o registro ja devolvido pelo banco. A ordem dos desvios e
// obrigatoria e nao pode ser reordenada por conveniencia.

import type { Decisao, RegistroMedicamento } from './tipos.ts';
import { MSG, montarDesambiguacao } from './mensagens.ts';
import { normalizar } from './texto.ts';

export type Intencao =
  | 'atendente'
  | 'clinica'
  | 'saudacao'
  | 'agradecimento'
  | 'despedida'
  | 'consulta';

// Frases sociais (normalizadas). So batem quando a mensagem INTEIRA e uma
// saudacao/agradecimento/despedida — "bom dia, tem dipirona?" segue para a busca.
const SAUDACOES = new Set([
  'oi', 'ola', 'oie', 'oii', 'opa', 'ei', 'eae', 'e ai', 'eai', 'salve',
  'bom dia', 'boa tarde', 'boa noite', 'boas', 'ola bom dia', 'oi bom dia',
  'oi boa tarde', 'oi boa noite', 'tudo bem', 'tudo bom', 'tudo certo',
  'como vai', 'oi tudo bem', 'ola tudo bem', 'bom dia tudo bem',
]);
const AGRADECIMENTOS = new Set([
  'obrigado', 'obrigada', 'obg', 'obgd', 'vlw', 'valeu', 'agradecido',
  'agradecida', 'grato', 'grata', 'muito obrigado', 'muito obrigada',
  'obrigado atendente', 'ok obrigado', 'ok obrigada',
]);
const DESPEDIDAS = new Set([
  'tchau', 'ate logo', 'ate mais', 'ate breve', 'ate', 'falou', 'flw',
  'adeus', 'ate mais tarde', 'ok tchau',
]);

/** Reduz a mensagem a letras/numeros e espacos simples, para casar frases sociais. */
function chaveSocial(texto: string): string {
  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Perguntas clinicas: uso, dose, combinacao, indicacao. Estas nunca vao a busca,
// e a resposta e uma recusa fixa (CLAUDE.md secao 6, regras 7 a 10).
const PADROES_CLINICOS = [
  'posso tomar',
  'pode tomar',
  'posso usar',
  'junto com',
  'junto do',
  'combinar',
  'interage',
  'interacao',
  'faz mal',
  'efeito colateral',
  'efeitos colaterais',
  'quantos comprimidos',
  'quantas gotas',
  'qual a dose',
  'qual dose',
  'dosagem',
  'de quanto em quanto',
  'quantas vezes',
  'para que serve',
  'pra que serve',
  'serve para',
  'como tomar',
  'como usar',
  'substituir',
  'no lugar de',
];

/**
 * Classifica a intencao antes de qualquer busca. Mantida simples e
 * deterministica de proposito: o encaminhamento e a recusa nao dependem da IA.
 */
export function detectarIntencao(texto: string): Intencao {
  const t = normalizar(texto);
  if (t === 'atendente' || t.includes('atendente') || t.includes('quero falar com')) {
    return 'atendente';
  }
  // Mensagem puramente social (saudacao/agradecimento/despedida).
  const s = chaveSocial(texto);
  if (SAUDACOES.has(s)) return 'saudacao';
  if (AGRADECIMENTOS.has(s)) return 'agradecimento';
  if (DESPEDIDAS.has(s)) return 'despedida';
  if (PADROES_CLINICOS.some((p) => t.includes(p))) return 'clinica';
  return 'consulta';
}

/**
 * Aplica os quatro desvios da secao 5 sobre o resultado da busca.
 * `houveErro` sinaliza falha tecnica na consulta ao banco.
 */
export function decidirPorResultados(
  resultados: RegistroMedicamento[],
  houveErro: boolean,
): Decisao {
  // 1. Falha tecnica -> texto fixo, sem IA.
  if (houveErro) {
    return { tipo: 'texto_fixo', texto: MSG.FALHA_CONSULTA, motivoEncaminhamento: 'falha_consulta' };
  }

  // 2. Nada encontrado -> texto fixo, sem IA. NUNCA perguntar ao modelo.
  if (resultados.length === 0) {
    return {
      tipo: 'texto_fixo',
      texto: MSG.TERMO_NAO_RECONHECIDO,
      motivoEncaminhamento: 'termo_nao_reconhecido',
    };
  }

  // 3. Empate no topo (mesma semelhanca) -> desambiguar, sem IA.
  const topo = resultados[0].semelhanca;
  const empatados = resultados.filter((r) => r.semelhanca === topo);
  if (empatados.length > 1) {
    return { tipo: 'desambiguacao', texto: montarDesambiguacao(empatados), opcoes: empatados };
  }

  // 4. Registro unico -> IA redige, recebendo SO este registro.
  return { tipo: 'redigir_ia', registro: resultados[0] };
}

/** Decisao de intencao clinica: recusa fixa, sem IA e sem busca. */
export function decisaoRecusaClinica(): Decisao {
  return { tipo: 'recusa_clinica', texto: MSG.RECUSA_CLINICA };
}

/** Resposta social (saudacao, agradecimento, despedida). Sem busca e sem IA. */
export function decisaoSocial(intencao: 'saudacao' | 'agradecimento' | 'despedida'): Decisao {
  const texto =
    intencao === 'saudacao'
      ? MSG.SAUDACAO
      : intencao === 'agradecimento'
        ? MSG.AGRADECIMENTO
        : MSG.ENCERRAMENTO;
  return { tipo: 'social', texto };
}

/** Encaminhamento humano explicito (o cidadao digitou ATENDENTE). */
export function decisaoAtendente(): Decisao {
  return {
    tipo: 'texto_fixo',
    texto: MSG.ENCAMINHAMENTO_HUMANO,
    motivoEncaminhamento: 'pedido_do_cidadao',
  };
}
