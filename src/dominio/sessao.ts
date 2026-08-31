// Estado de sessao por remetente (CLAUDE.md secoes 7 e 12).
//
// Nenhum estado conversacional pode viver fora de uma chave de sessao: guardar
// a desambiguacao em variavel de modulo produz o bug de o usuario A receber a
// resposta da pergunta feita ao usuario B. A chave e o hash do remetente — o
// numero nunca e guardado em claro.
//
// O armazenamento e abstraido para suportar dois cenarios (CLAUDE.md secao 7):
//   - ArmazenamentoMemoria  -> uma instancia (dev local, servidor persistente)
//   - Armazenamento no Supabase (src/dados/sessao-supabase.ts) -> serverless /
//     multiplas instancias (Vercel), onde a memoria local nao e compartilhada.

import { createHash } from 'node:crypto';
import type { RegistroMedicamento } from './tipos.ts';

export const TTL_SESSAO_MS = 5 * 60 * 1000; // 5 minutos
export const TTL_DEDUP_MS = 10 * 60 * 1000; // janela de deduplicacao de message.id

export type EstadoSessao = {
  aguardando: 'desambiguacao' | null;
  opcoes: RegistroMedicamento[]; // apenas registros; nunca texto livre do cidadao
  jaSaudou: boolean;
  expiraEm: number; // epoch ms
};

/** Backend de persistencia do estado de sessao e da deduplicacao. */
export interface ArmazenamentoSessao {
  obterSessao(chave: string): Promise<EstadoSessao | undefined>; // ja respeita expiracao
  salvarSessao(chave: string, estado: EstadoSessao): Promise<void>;
  /** Registra o message.id; retorna true se ele JA havia sido visto. */
  jaVista(idMensagem: string, ttlMs: number): Promise<boolean>;
}

/** Armazenamento em memoria: uma instancia. Padrao no dev local. */
export class ArmazenamentoMemoria implements ArmazenamentoSessao {
  private readonly sessoes = new Map<string, EstadoSessao>();
  private readonly vistos = new Map<string, number>();

  async obterSessao(chave: string): Promise<EstadoSessao | undefined> {
    const s = this.sessoes.get(chave);
    if (!s) return undefined;
    if (s.expiraEm <= Date.now()) {
      this.sessoes.delete(chave);
      return undefined;
    }
    return s;
  }

  async salvarSessao(chave: string, estado: EstadoSessao): Promise<void> {
    this.sessoes.set(chave, estado);
  }

  async jaVista(idMensagem: string, ttlMs: number): Promise<boolean> {
    const agora = Date.now();
    for (const [id, exp] of this.vistos) if (exp <= agora) this.vistos.delete(id);
    if (this.vistos.has(idMensagem)) return true;
    this.vistos.set(idMensagem, agora + ttlMs);
    return false;
  }
}

export class GerenciadorSessao {
  private readonly sal: string;
  private readonly arm: ArmazenamentoSessao;

  constructor(sal: string, armazenamento: ArmazenamentoSessao = new ArmazenamentoMemoria()) {
    this.sal = sal;
    this.arm = armazenamento;
  }

  /** Hash anonimo do remetente. Usado como chave e no log (nunca o numero cru). */
  hash(remetente: string): string {
    return createHash('sha256').update(this.sal + '|' + remetente).digest('hex');
  }

  /** Deduplicacao idempotente: true se este message.id ja foi processado. */
  async jaProcessada(idMensagem: string): Promise<boolean> {
    if (!idMensagem) return false;
    return this.arm.jaVista(idMensagem, TTL_DEDUP_MS);
  }

  /** Estado vigente da sessao, ou undefined se inexistente ou expirado. */
  async obter(chave: string): Promise<EstadoSessao | undefined> {
    return this.arm.obterSessao(chave);
  }

  private async garantir(chave: string): Promise<EstadoSessao> {
    const existente = await this.obter(chave);
    if (existente) return existente;
    return {
      aguardando: null,
      opcoes: [],
      jaSaudou: false,
      expiraEm: Date.now() + TTL_SESSAO_MS,
    };
  }

  /** Marca que a sessao ja recebeu as boas-vindas; retorna se era a primeira vez. */
  async primeiraInteracao(chave: string): Promise<boolean> {
    const s = await this.garantir(chave);
    const primeira = !s.jaSaudou;
    s.jaSaudou = true;
    s.expiraEm = Date.now() + TTL_SESSAO_MS;
    await this.arm.salvarSessao(chave, s);
    return primeira;
  }

  /** Guarda uma pergunta de desambiguacao em aberto. */
  async aguardarDesambiguacao(chave: string, opcoes: RegistroMedicamento[]): Promise<void> {
    const s = await this.garantir(chave);
    s.aguardando = 'desambiguacao';
    s.opcoes = opcoes;
    s.expiraEm = Date.now() + TTL_SESSAO_MS;
    await this.arm.salvarSessao(chave, s);
  }

  /**
   * Interpreta a resposta a uma desambiguacao pendente.
   *  - registro escolhido, se o texto for um numero valido dentro das opcoes;
   *  - null se nao ha desambiguacao pendente OU a resposta nao corresponde
   *    (ex.: "3" quando havia duas) — nesse caso o chamador trata como consulta nova.
   */
  async resolverDesambiguacao(chave: string, texto: string): Promise<RegistroMedicamento | null> {
    const s = await this.obter(chave);
    if (!s || s.aguardando !== 'desambiguacao') return null;
    const escolha = Number(texto.trim());
    const valido = Number.isInteger(escolha) && escolha >= 1 && escolha <= s.opcoes.length;
    const opcoes = s.opcoes;
    // Em qualquer resposta, a desambiguacao deixa de estar pendente.
    s.aguardando = null;
    s.opcoes = [];
    s.expiraEm = Date.now() + TTL_SESSAO_MS;
    await this.arm.salvarSessao(chave, s);
    return valido ? opcoes[escolha - 1] : null;
  }
}
