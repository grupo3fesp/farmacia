// Textos padrao e montadores de resposta deterministica.
// Fonte: CLAUDE.md secao 6 e docs/fluxo_conversa_assistente_farmacia.md secao 5.
//
// Os caminhos "sem IA" (nao reconhecido, desambiguacao, falha, recusa clinica)
// usam estes textos diretamente. montarRespostaDeterministica e o fallback
// quando a API da IA falha: monta a frase por template, sempre correta.

import type { RegistroMedicamento } from './tipos.ts';

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

/** Data/hora da ultima atualizacao no formato dd/mm/aaaa às HHhMM. */
export function formatarAtualizacao(iso: string): string {
  const d = new Date(iso);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}, às ${dois(
    d.getHours(),
  )}h${dois(d.getMinutes())}`;
}

/** Pergunta de desambiguacao entre apresentacoes do mesmo item. Sem IA. */
export function montarDesambiguacao(opcoes: RegistroMedicamento[]): string {
  const linhas = opcoes.map((r, i) => `${i + 1} – ${descreverItem(r)}`);
  return [
    'Encontrei mais de uma apresentação para esse medicamento. Qual delas você procura?',
    ...linhas,
    `É só responder com o número (1 a ${opcoes.length}).`,
  ].join('\n');
}

/**
 * Fallback deterministico quando a IA esta fora do ar. Monta a resposta por
 * template a partir dos campos do registro — o cidadao recebe a informacao
 * correta mesmo com o modelo indisponivel. (CLAUDE.md secao 5.)
 */
export function montarRespostaDeterministica(r: RegistroMedicamento): string {
  const item = descreverItem(r);
  const quando = formatarAtualizacao(r.atualizado_em);
  const unidade = r.unidade_nome ? ` na ${r.unidade_nome}` : '';

  if (r.situacao === 'DISPONIVEL') {
    return [
      `${item}: consta como disponível${unidade}.`,
      `Posição registrada em ${quando}.`,
      MSG.RESSALVA_ESTOQUE,
    ].join(' ');
  }
  if (r.situacao === 'ESTOQUE BAIXO') {
    return [
      `${item}: consta como disponível em quantidade reduzida${unidade} (posição de ${quando}).`,
      'Como restam poucas unidades, a retirada pode não ser possível se houver procura ao longo do dia.',
    ].join(' ');
  }
  return [
    `${item}: consta como em falta${unidade} na posição de ${quando}.`,
    'Vale consultar novamente nos próximos dias. Para falar com a equipe, digite ATENDENTE.',
  ].join(' ');
}
