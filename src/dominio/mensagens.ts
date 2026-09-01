// Textos padrao e montadores de resposta deterministica.
// Fonte: CLAUDE.md secao 6 e docs/fluxo_conversa_assistente_farmacia.md secao 5.
//
// Os caminhos "sem IA" (nao reconhecido, desambiguacao, falha, recusa clinica)
// usam estes textos diretamente. montarRespostaDeterministica e o fallback
// quando a API da IA falha: monta a frase por template, sempre correta.

import type { RegistroMedicamento, MedicamentoComEstoque, EstoqueUnidade } from './tipos.ts';

export const MSG = {
  BOAS_VINDAS:
    'Olá! Sou o assistente virtual da Farmácia Municipal. Informo se um medicamento consta como disponível no estoque. Não realizo reservas e não oriento sobre uso de medicamentos.',
  AVISO_FINALIDADE:
    'Este canal é apenas informativo e não substitui a avaliação de profissional de saúde.',
  RESSALVA_ESTOQUE:
    'O estoque muda ao longo do dia; esta consulta reflete a última posição registrada e não garante a disponibilidade na retirada.',
  FALHA_CONSULTA:
    'Não consegui consultar o estoque neste momento. Tente novamente em alguns minutos ou digite ATENDENTE.',
  TERMO_NAO_RECONHECIDO:
    'Não localizei esse medicamento no cadastro da farmácia. Você pode reescrever o nome ou digitar ATENDENTE.',
  RECUSA_CLINICA:
    'Não posso orientar sobre uso, dosagem ou combinação de medicamentos. Procure o farmacêutico da unidade ou a equipe da sua UBS. Aqui informo apenas a disponibilidade de medicamentos.',
  ENCAMINHAMENTO_HUMANO:
    'Certo. Vou encaminhar seu contato para a equipe da Farmácia Municipal. O atendimento humano ocorre em horário comercial; fora dele, o retorno é no próximo dia útil.',
  SAUDACAO:
    'Como posso ajudar? Envie o nome do medicamento que você quer consultar e eu informo se ele consta no estoque.',
  AGRADECIMENTO:
    'Por nada! Sempre que precisar, é só enviar o nome de um medicamento para consultar a disponibilidade.',
  ENCERRAMENTO:
    'Consulta encerrada. Sempre que precisar, é só enviar o nome do medicamento.',
  AVISO_DEMO:
    '⚠️ Demonstração com dados fictícios. Os quantitativos não correspondem ao estoque real.',
} as const;

/** Descricao curta de um registro, usada em desambiguacao e templates. */
export function descreverItem(r: RegistroMedicamento): string {
  const forma = r.forma_farmaceutica ? ` ${r.forma_farmaceutica.toLowerCase()}` : '';
  return `${r.principio_ativo} ${r.apresentacao}${forma}`.trim();
}

/** Data/hora no formato dd/mm/aaaa às HHhMM, SEMPRE no fuso de São Paulo
 *  (o servidor pode rodar em UTC, ex.: Vercel). */
export function formatarAtualizacao(iso: string): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}, às ${get('hour')}h${get('minute')}`;
}

/**
 * Aviso quando o cidadao cita mais de um medicamento na mesma mensagem.
 * Nao enumera os nomes de proposito: se algum nao estiver no cadastro, listar
 * daria a impressao de que "faltou um".
 */
export function montarUmPorVez(): string {
  return [
    'Percebi que você mencionou mais de um medicamento.',
    'Consigo verificar a disponibilidade de um por vez — por favor, envie o nome de apenas um deles.',
  ].join(' ');
}

/** Pergunta de desambiguacao entre apresentacoes do mesmo item. Sem IA. */
export function montarDesambiguacao(opcoes: RegistroMedicamento[]): string {
  const linhas = opcoes.map((r, i) => `${i + 1} – ${descreverItem(r)}`);
  return [
    'Encontrei mais de uma opção para esse medicamento. Qual delas você procura?',
    ...linhas,
    `É só responder com o número (1 a ${opcoes.length}).`,
  ].join('\n');
}

/** Junta nomes em "A", "A e B", "A, B e C". */
export function listarNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? '';
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

/** Data/hora da posicao mais recente entre as unidades. */
function atualizacaoMaisRecente(estoques: EstoqueUnidade[]): string {
  const iso = estoques.reduce(
    (max, e) => (e.atualizado_em > max ? e.atualizado_em : max),
    estoques[0]?.atualizado_em ?? new Date().toISOString(),
  );
  return formatarAtualizacao(iso);
}

/** Rotulo curto da situacao de uma unidade. */
function rotuloSituacao(s: EstoqueUnidade['situacao']): string {
  if (s === 'DISPONIVEL') return 'disponível';
  if (s === 'ESTOQUE BAIXO') return 'disponível (estoque baixo)';
  return 'em falta';
}

/**
 * Fallback deterministico quando a IA esta fora do ar. Monta a resposta em
 * lista, uma unidade por linha — informacao correta mesmo com o modelo
 * indisponivel. (CLAUDE.md secao 5.)
 */
export function montarRespostaDeterministica(m: MedicamentoComEstoque): string {
  const item = descreverItem(m.medicamento);

  if (m.estoques.length === 0) {
    return `${item}: não há registro de estoque em nenhuma unidade no momento. Para mais informações, digite ATENDENTE.`;
  }

  const ordem: Record<EstoqueUnidade['situacao'], number> = {
    DISPONIVEL: 0,
    'ESTOQUE BAIXO': 1,
    'EM FALTA': 2,
  };
  const linhas = [...m.estoques]
    .sort(
      (a, b) =>
        ordem[a.situacao] - ordem[b.situacao] ||
        a.unidade_nome.localeCompare(b.unidade_nome, 'pt-BR'),
    )
    .map((e) => `• ${e.unidade_nome}: ${rotuloSituacao(e.situacao)}`);

  const temDisponivel = m.estoques.some((e) => e.situacao !== 'EM FALTA');
  const quando = atualizacaoMaisRecente(m.estoques);
  const fecho = temDisponivel
    ? MSG.RESSALVA_ESTOQUE
    : 'Vale consultar novamente nos próximos dias ou digitar ATENDENTE.';

  return [
    `${item} — disponibilidade por unidade:`,
    '',
    ...linhas,
    '',
    `${fecho} Posição registrada em ${quando}.`,
  ].join('\n');
}
