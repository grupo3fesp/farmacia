// Leitura e validacao de configuracao. Carrega um .env simples sem depender de
// pacote externo (o caminho local roda sem `npm install`). Variaveis ja
// presentes no ambiente tem prioridade sobre o arquivo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function carregarEnv(): void {
  let conteudo: string;
  try {
    conteudo = readFileSync(join(raiz, '.env'), 'utf8');
  } catch {
    return; // sem .env: usa apenas o ambiente do processo
  }
  for (const linhaBruta of conteudo.split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const idx = linha.indexOf('=');
    if (idx === -1) continue;
    const chave = linha.slice(0, idx).trim();
    let valor = linha.slice(idx + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!(chave in process.env)) process.env[chave] = valor;
  }
}

carregarEnv();

const env = process.env;

export type Modo = 'demonstracao' | 'piloto';
export type FonteRepositorio = 'local' | 'supabase';
export type BackendSessao = 'memoria' | 'supabase';
export type ProvedorIA = 'template' | 'gemini' | 'anthropic';

export const config = {
  porta: Number(env.PORT ?? 3000),
  modo: (env.MODO === 'piloto' ? 'piloto' : 'demonstracao') as Modo,
  repositorio: (env.REPOSITORIO === 'supabase' ? 'supabase' : 'local') as FonteRepositorio,
  // Onde guardar o estado de sessao. 'supabase' e obrigatorio em serverless
  // (Vercel). 'memoria' serve para dev local / servidor persistente.
  sessao: (env.SESSAO === 'supabase' ? 'supabase' : 'memoria') as BackendSessao,

  supabase: {
    url: env.SUPABASE_URL ?? '',
    anonKey: env.SUPABASE_ANON_KEY ?? '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  },

  // Provedor da redacao: template (gratis, deterministico) | gemini (Google AI,
  // tier gratis) | anthropic (Claude, pago). Se nao definido, infere pela chave
  // presente; sem chave nenhuma, fica no template.
  iaProvedor: ((): ProvedorIA => {
    const p = env.IA_PROVEDOR;
    if (p === 'gemini' || p === 'anthropic' || p === 'template') return p;
    if ((env.ANTHROPIC_API_KEY ?? '') !== '') return 'anthropic';
    if ((env.GEMINI_API_KEY ?? '') !== '') return 'gemini';
    return 'template';
  })(),

  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY ?? '',
    modelo: env.ANTHROPIC_MODELO ?? 'claude-sonnet-5',
  },

  gemini: {
    apiKey: env.GEMINI_API_KEY ?? '',
    // flash-lite: rápido (~1s) e barato, ideal para redação. O alias -latest
    // acompanha a versão vigente (modelos datados saem de disponibilidade).
    modelo: env.GEMINI_MODELO ?? 'gemini-flash-lite-latest',
  },

  whatsapp: {
    token: env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? '',
  },

  // Sal para o hash da sessao. Nunca gravamos o remetente em claro (LGPD).
  salSessao: env.SAL_SESSAO ?? 'demo-sal-trocar-no-piloto',

  // Token opcional para proteger a edicao de estoque quando publicada. Vazio =
  // painel aberto (edicao ao vivo livre, util na demonstracao presencial).
  adminToken: env.ADMIN_TOKEN ?? '',
} as const;

export const ehDemonstracao = config.modo === 'demonstracao';
export const usaIA =
  (config.iaProvedor === 'anthropic' && config.anthropic.apiKey !== '') ||
  (config.iaProvedor === 'gemini' && config.gemini.apiKey !== '');
