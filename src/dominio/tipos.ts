// Tipos centrais do dominio. Espelham as colunas devolvidas por
// public.buscar_medicamento (ver db/01_schema_supabase.sql, secao 5).

export type Situacao = 'DISPONIVEL' | 'ESTOQUE BAIXO' | 'EM FALTA';

export type OrigemBusca = 'sinonimo_exato' | 'principio_ativo' | 'aproximado';

/** Um registro tal como a RPC buscar_medicamento o devolve. */
export type RegistroMedicamento = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  forma_farmaceutica: string | null;
  unidade_medida: string | null;
  estoque_atual: number;
  situacao: Situacao;
  tipo_receita: string | null;
  unidade_nome: string | null;
  atualizado_em: string; // ISO 8601
  origem: OrigemBusca;
  semelhanca: number;
};

/** Uma mensagem recebida, ja normalizada pelo canal para a camada de negocio. */
export type MensagemRecebida = {
  remetente: string; // identificador cru do canal (numero, id do simulador)
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
  | { tipo: 'recusa_clinica'; texto: string };
