// Repositorio Supabase (modelo multiunidade): chama as RPCs buscar_medicamento
// e estoque_medicamento, e edita a tabela estoques por unidade (service_role).

import type { RegistroMedicamento, EstoqueUnidade, Situacao } from '../dominio/tipos.ts';
import type { Repositorio, RegistroLog, Indicadores, ItemEstoque } from './repositorio.ts';
import { criarClienteSupabase, type ClienteSupabase } from './cliente-supabase.ts';

type Config = { url: string; anonKey: string; serviceKey?: string };

export class RepositorioSupabase implements Repositorio {
  private readonly cfg: Config;
  private anon: ClienteSupabase | null = null;
  private servico: ClienteSupabase | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  private async clienteAnon(): Promise<ClienteSupabase> {
    if (!this.anon) this.anon = await criarClienteSupabase(this.cfg.url, this.cfg.anonKey);
    return this.anon;
  }

  private async clienteServico(): Promise<ClienteSupabase> {
    if (!this.cfg.serviceKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente: necessaria para editar estoque e ler indicadores.');
    }
    if (!this.servico) this.servico = await criarClienteSupabase(this.cfg.url, this.cfg.serviceKey);
    return this.servico;
  }

  async buscar(termo: string, limite = 5): Promise<RegistroMedicamento[]> {
    const sb = await this.clienteAnon();
    const { data, error } = await sb.rpc('buscar_medicamento', { p_termo: termo, p_limite: limite });
    if (error) throw new Error(`Falha na RPC buscar_medicamento: ${JSON.stringify(error)}`);
    return (data as RegistroMedicamento[]) ?? [];
  }

  async estoquePorCodigo(codigo: string): Promise<EstoqueUnidade[]> {
    const sb = await this.clienteAnon();
    const { data, error } = await sb.rpc('estoque_medicamento', { p_codigo: codigo });
    if (error) throw new Error(`Falha na RPC estoque_medicamento: ${JSON.stringify(error)}`);
    type Linha = {
      unidade_id: string;
      unidade_nome: string;
      endereco: string | null;
      horario: string | null;
      estoque_atual: number;
      estoque_minimo: number;
      situacao: Situacao;
      atualizado_em: string;
    };
    return ((data as Linha[]) ?? []).map((l) => ({ ...l }));
  }

  async registrarLog(r: RegistroLog): Promise<void> {
    try {
      const sb = await this.clienteAnon();
      await sb.from('consultas_log').insert({
        sessao_hash: r.sessaoHash,
        termo_digitado: r.termoDigitado,
        codigo_encontrado: r.codigoEncontrado,
        situacao_retornada: r.situacaoRetornada,
        encaminhado_humano: r.encaminhadoHumano,
        motivo_encaminhamento: r.motivoEncaminhamento,
      });
    } catch {
      // best-effort: nunca derruba o atendimento.
    }
  }

  async indicadores(): Promise<Indicadores> {
    const sb = await this.clienteServico();
    const { data, error } = await sb.from('vw_indicadores').select('*').maybeSingle();
    if (error) throw new Error(`Falha ao ler vw_indicadores: ${JSON.stringify(error)}`);
    return data as Indicadores;
  }

  async listarEstoque(): Promise<ItemEstoque[]> {
    const sb = await this.clienteAnon();
    const { data, error } = await sb
      .from('estoques')
      .select(
        'codigo, unidade_id, estoque_atual, estoque_minimo, situacao, medicamentos!inner(principio_ativo, apresentacao), unidades!inner(nome)',
      );
    if (error) throw new Error(`Falha ao listar estoque: ${JSON.stringify(error)}`);
    type Linha = {
      codigo: string;
      unidade_id: string;
      estoque_atual: number;
      estoque_minimo: number;
      situacao: string;
      medicamentos: { principio_ativo: string; apresentacao: string };
      unidades: { nome: string };
    };
    return ((data as Linha[]) ?? [])
      .map((l) => ({
        codigo: l.codigo,
        principio_ativo: l.medicamentos.principio_ativo,
        apresentacao: l.medicamentos.apresentacao,
        unidade_id: l.unidade_id,
        unidade_nome: l.unidades.nome,
        estoque_atual: l.estoque_atual,
        estoque_minimo: l.estoque_minimo,
        situacao: l.situacao,
      }))
      .sort(
        (a, b) =>
          a.principio_ativo.localeCompare(b.principio_ativo, 'pt-BR') ||
          a.apresentacao.localeCompare(b.apresentacao, 'pt-BR') ||
          a.unidade_nome.localeCompare(b.unidade_nome, 'pt-BR'),
      );
  }

  async alterarEstoque(codigo: string, unidadeId: string, estoqueAtual: number): Promise<boolean> {
    if (!Number.isInteger(estoqueAtual) || estoqueAtual < 0) return false;
    const sb = await this.clienteServico();
    const { data, error } = await sb
      .from('estoques')
      .update({ estoque_atual: estoqueAtual })
      .eq('codigo', codigo)
      .eq('unidade_id', unidadeId)
      .select('codigo');
    if (error) throw new Error(`Falha ao alterar estoque: ${JSON.stringify(error)}`);
    return Array.isArray(data) && data.length > 0;
  }
}
