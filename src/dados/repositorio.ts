// Abstracao de dados (modelo multiunidade). A camada de negocio depende so
// desta interface. Implementacoes: local (offline, seed) e supabase (RPC).

import type { RegistroMedicamento, EstoqueUnidade } from '../dominio/tipos.ts';

export type RegistroLog = {
  sessaoHash: string | null;
  termoDigitado: string;
  codigoEncontrado: string | null;
  situacaoRetornada: string | null;
  encaminhadoHumano: boolean;
  motivoEncaminhamento: string | null;
};

export type Indicadores = {
  consultas_totais: number;
  termos_reconhecidos: number;
  taxa_reconhecimento_pct: number;
  encaminhamentos_humanos: number;
  taxa_resolucao_automatica_pct: number;
  consultas_itens_em_falta: number;
};

/** Uma linha do painel editor: estoque de um medicamento numa unidade. */
export type ItemEstoque = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  unidade_id: string;
  unidade_nome: string;
  estoque_atual: number;
  estoque_minimo: number;
  situacao: string;
};

export interface Repositorio {
  /** Espelha public.buscar_medicamento — devolve o catalogo (sem estoque). */
  buscar(termo: string, limite?: number): Promise<RegistroMedicamento[]>;
  /** Espelha public.estoque_medicamento — estoque de um medicamento por unidade. */
  estoquePorCodigo(codigo: string): Promise<EstoqueUnidade[]>;
  /** Insere um registro anonimo em consultas_log. Nunca lanca para o chamador. */
  registrarLog(registro: RegistroLog): Promise<void>;
  /** Indicadores do piloto (vw_indicadores). */
  indicadores(): Promise<Indicadores>;

  // --- Painel editor ao vivo (por unidade) ---
  listarEstoque(): Promise<ItemEstoque[]>;
  /** Altera o estoque de um item numa unidade. Retorna false se nao existir. */
  alterarEstoque(codigo: string, unidadeId: string, estoqueAtual: number): Promise<boolean>;
}
