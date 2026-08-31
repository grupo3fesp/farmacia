// Repositorio Supabase: chama a RPC public.buscar_medicamento e grava o log.
// Ativa-se quando REPOSITORIO=supabase e as credenciais estao no ambiente.
//
// O SDK entra por import dinamico: o caminho local (fase A) roda sem ele
// instalado. Instale com `npm install` quando for conectar o banco real.

import type { RegistroMedicamento } from '../dominio/tipos.ts';
import type { Repositorio, RegistroLog, Indicadores, ItemEstoque } from './repositorio.ts';
import { criarClienteSupabase, type ClienteSupabase } from './cliente-supabase.ts';

type Config = {
  url: string;
  anonKey: string;
  serviceKey?: string;
};

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
      throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente: necessaria para ler indicadores.');
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
      // Log e best-effort: nunca derruba o atendimento ao cidadao.
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
      .from('medicamentos')
      .select('codigo, principio_ativo, apresentacao, estoque_atual, estoque_minimo, situacao')
      .order('codigo');
    if (error) throw new Error(`Falha ao listar estoque: ${JSON.stringify(error)}`);
    return (data as ItemEstoque[]) ?? [];
  }

  async alterarEstoque(codigo: string, estoqueAtual: number): Promise<boolean> {
    if (!Number.isInteger(estoqueAtual) || estoqueAtual < 0) return false;
    // Escrita administrativa: exige a service_role. O gatilho fn_carimba_atualizacao
    // atualiza `atualizado_em` no banco automaticamente.
    const sb = await this.clienteServico();
    const { data, error } = await sb
      .from('medicamentos')
      .update({ estoque_atual: estoqueAtual })
      .eq('codigo', codigo)
      .select('codigo');
    if (error) throw new Error(`Falha ao alterar estoque: ${JSON.stringify(error)}`);
    return Array.isArray(data) && data.length > 0;
  }
}
