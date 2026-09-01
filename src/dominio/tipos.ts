// Tipos centrais do dominio (modelo multiunidade).
// A busca (buscar_medicamento) devolve o catalogo; o estoque por unidade vem de
// estoque_medicamento(codigo). Ver db/01_schema_supabase.sql.

export type Situacao = 'DISPONIVEL' | 'ESTOQUE BAIXO' | 'EM FALTA';

export type OrigemBusca = 'sinonimo_exato' | 'principio_ativo' | 'aproximado';

/** Um medicamento no catalogo, como a RPC buscar_medicamento o devolve. */
export type RegistroMedicamento = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  forma_farmaceutica: string | null;
  unidade_medida: string | null;
  tipo_receita: string | null;
  origem: OrigemBusca;
  semelhanca: number;
};

/** Posicao de estoque de um medicamento numa unidade. */
export type EstoqueUnidade = {
  unidade_id: string;
  unidade_nome: string;
  endereco: string | null;
  horario: string | null;
  estoque_atual: number;
  estoque_minimo: number;
  situacao: Situacao;
  atualizado_em: string; // ISO 8601
};

/** Medicamento + seu estoque em cada unidade — o que a IA recebe para redigir. */
export type MedicamentoComEstoque = {
  medicamento: RegistroMedicamento;
  estoques: EstoqueUnidade[];
};

/** Uma mensagem recebida, ja normalizada pelo canal para a camada de negocio. */
export type MensagemRecebida = {
  remetente: string;
  texto: string;
  idMensagem: string;
};

export type MotivoEncaminhamento =
  | 'termo_nao_reconhecido'
  | 'falha_consulta'
  | 'pedido_do_cidadao'
  | 'duvida_clinica';

/** O que o dominio decide fazer com uma mensagem. */
export type Decisao =
  | { tipo: 'texto_fixo'; texto: string; motivoEncaminhamento?: MotivoEncaminhamento }
  | { tipo: 'desambiguacao'; texto: string; opcoes: RegistroMedicamento[] }
  | { tipo: 'redigir_ia'; registro: RegistroMedicamento }
  | { tipo: 'recusa_clinica'; texto: string }
  | { tipo: 'social'; texto: string };
