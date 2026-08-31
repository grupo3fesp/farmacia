// Armazenamento de sessao no Supabase, para hospedagem serverless / multiplas
// instancias (Vercel). Usa a service_role (as tabelas sessoes e mensagens_vistas
// tem RLS que bloqueia anon). Rode db/03_sessoes.sql antes de usar.

import type { RegistroMedicamento } from '../dominio/tipos.ts';
import type { ArmazenamentoSessao, EstadoSessao } from '../dominio/sessao.ts';
import { criarClienteSupabase, type ClienteSupabase } from './cliente-supabase.ts';

type LinhaSessao = {
  sessao_hash: string;
  aguardando: string | null;
  opcoes: RegistroMedicamento[] | null;
  ja_saudou: boolean;
  expira_em: string;
};

export class ArmazenamentoSupabaseSessao implements ArmazenamentoSessao {
  private readonly url: string;
  private readonly serviceKey: string;
  private cliente: ClienteSupabase | null = null;

  constructor(url: string, serviceKey: string) {
    this.url = url;
    this.serviceKey = serviceKey;
  }

  private async sb(): Promise<ClienteSupabase> {
    if (!this.cliente) this.cliente = await criarClienteSupabase(this.url, this.serviceKey);
    return this.cliente;
  }

  async obterSessao(chave: string): Promise<EstadoSessao | undefined> {
    const sb = await this.sb();
    const { data, error } = await sb
      .from('sessoes')
      .select('sessao_hash, aguardando, opcoes, ja_saudou, expira_em')
      .eq('sessao_hash', chave)
      .maybeSingle();
    if (error) throw new Error(`Falha ao ler sessao: ${JSON.stringify(error)}`);
    if (!data) return undefined;
    const linha = data as LinhaSessao;
    const expiraEm = new Date(linha.expira_em).getTime();
    if (expiraEm <= Date.now()) return undefined; // expirada; sera sobrescrita/limpa
    return {
      aguardando: linha.aguardando === 'desambiguacao' ? 'desambiguacao' : null,
      opcoes: linha.opcoes ?? [],
      jaSaudou: linha.ja_saudou,
      expiraEm,
    };
  }

  async salvarSessao(chave: string, estado: EstadoSessao): Promise<void> {
    const sb = await this.sb();
    const { error } = await sb.from('sessoes').upsert(
      {
        sessao_hash: chave,
        aguardando: estado.aguardando,
        opcoes: estado.opcoes,
        ja_saudou: estado.jaSaudou,
        expira_em: new Date(estado.expiraEm).toISOString(),
      },
      { onConflict: 'sessao_hash' },
    );
    if (error) throw new Error(`Falha ao salvar sessao: ${JSON.stringify(error)}`);
  }

  async jaVista(idMensagem: string, ttlMs: number): Promise<boolean> {
    const sb = await this.sb();
    // Limpeza oportunistica de expirados (barata, esporadica).
    if (Math.random() < 0.05) {
      await sb.from('mensagens_vistas').delete().lt('expira_em', new Date().toISOString());
    }
    const { data, error } = await sb
      .from('mensagens_vistas')
      .upsert(
        { id_mensagem: idMensagem, expira_em: new Date(Date.now() + ttlMs).toISOString() },
        { onConflict: 'id_mensagem', ignoreDuplicates: true },
      )
      .select('id_mensagem');
    if (error) throw new Error(`Falha na deduplicacao: ${JSON.stringify(error)}`);
    // Com ignoreDuplicates, só linhas realmente inseridas voltam no select.
    const novaInsercao = Array.isArray(data) && data.length > 0;
    return !novaInsercao; // ja vista = nao foi nova insercao
  }
}
