// Abstracao de dados. A camada de negocio depende apenas desta interface,
// nunca de Supabase ou do seed diretamente. Duas implementacoes a satisfazem:
//   - RepositorioLocal  (src/dados/local.ts)    -> roda offline, a partir do seed
//   - RepositorioSupabase (src/dados/supabase.ts) -> chama a RPC buscar_medicamento
// Trocar de uma para a outra e so configuracao (ver src/dados/index.ts).

import type { RegistroMedicamento } from '../dominio/tipos.ts';

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

export type ItemEstoque = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  estoque_atual: number;
  estoque_minimo: number;
  situacao: string;
};

export interface Repositorio {
  /** Espelha public.buscar_medicamento(p_termo, p_limite). */
  buscar(termo: string, limite?: number): Promise<RegistroMedicamento[]>;
  /** Insere um registro anonimo em consultas_log. Nunca lanca para o chamador. */
  registrarLog(registro: RegistroLog): Promise<void>;
  /** Indicadores do piloto (vw_indicadores). */
  indicadores(): Promise<Indicadores>;

  /** Lista o estoque atual, para o painel editor ao vivo. */
  listarEstoque(): Promise<ItemEstoque[]>;

  /**
   * Altera o estoque de um item e recarimba a data. Escrita administrativa:
   * no Supabase exige a service_role (RLS bloqueia escrita para anon), que
   * fica somente no backend. Retorna false se o codigo nao existe.
   */
  alterarEstoque(codigo: string, estoqueAtual: number): Promise<boolean>;
}
