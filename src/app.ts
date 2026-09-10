// Raiz de composicao + handlers de aplicacao, independentes do transporte.
// Tanto o servidor HTTP local (src/index.ts) quanto as funcoes serverless da
// Vercel (api/*.ts) usam estes handlers — uma unica fonte de logica.

import { config } from './config.ts';
import { criarRepositorio } from './dados/index.ts';
import type { Repositorio } from './dados/repositorio.ts';
import {
  GerenciadorSessao,
  ArmazenamentoMemoria,
  type ArmazenamentoSessao,
} from './dominio/sessao.ts';
import { ArmazenamentoSupabaseSessao } from './dados/sessao-supabase.ts';
import { Atendimento } from './dominio/atendimento.ts';
import { CanalWhatsApp } from './canais/whatsapp.ts';
import { CanalTwilio, montarTwiml } from './canais/twilio.ts';
import { ehDemonstracao } from './config.ts';

function criarArmazenamentoSessao(): ArmazenamentoSessao {
  if (config.sessao === 'supabase') {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error(
        'SESSAO=supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. ' +
          'Rode db/03_sessoes.sql e configure as chaves.',
      );
    }
    return new ArmazenamentoSupabaseSessao(config.supabase.url, config.supabase.serviceKey);
  }
  return new ArmazenamentoMemoria();
}

// Singletons por processo/instancia. Em serverless, sao recriados a cada cold
// start — o estado que precisa sobreviver mora no Supabase, nao aqui.
const repo: Repositorio = criarRepositorio();
const sessao = new GerenciadorSessao(config.salSessao, criarArmazenamentoSessao());
const atendimento = new Atendimento(repo, sessao);
const canalWhatsApp =
  config.whatsapp.token && config.whatsapp.phoneNumberId
    ? new CanalWhatsApp({
        token: config.whatsapp.token,
        phoneNumberId: config.whatsapp.phoneNumberId,
      })
    : null;
// O Twilio nao exige configuracao para responder (fluxo TwiML).
const canalTwilio = new CanalTwilio();

export type RespostaApp = { status: number; corpo: unknown };

const ok = (corpo: unknown): RespostaApp => ({ status: 200, corpo });
const erro = (status: number, msg: string): RespostaApp => ({ status, corpo: { erro: msg } });

/** POST /api/mensagem — processa uma mensagem do simulador. */
export async function handleMensagem(corpo: unknown): Promise<RespostaApp> {
  const c = corpo as { remetente?: string; texto?: string; idMensagem?: string } | null;
  if (!c || typeof c.texto !== 'string' || !c.texto.trim()) {
    return erro(400, 'Informe { remetente, texto }');
  }
  const resultado = await atendimento.processar({
    remetente: c.remetente?.trim() || 'simulador-anonimo',
    texto: c.texto,
    idMensagem: c.idMensagem ?? '',
  });
  return ok(resultado);
}

/** GET /api/estoque — lista o estoque para o painel editor. */
export async function handleListarEstoque(): Promise<RespostaApp> {
  try {
    return ok({ modo: config.modo, editavel: true, protegido: config.adminToken !== '', itens: await repo.listarEstoque() });
  } catch (e) {
    return erro(502, (e as Error).message);
  }
}

/** POST /api/estoque — altera o estoque (gate opcional por ADMIN_TOKEN). */
export async function handleAlterarEstoque(corpo: unknown, tokenRecebido: string | undefined): Promise<RespostaApp> {
  if (config.adminToken && tokenRecebido !== config.adminToken) {
    return erro(401, 'Edicao protegida: token de admin invalido ou ausente.');
  }
  const c = corpo as { codigo?: string; unidade_id?: string; estoque_atual?: number } | null;
  if (
    !c ||
    typeof c.codigo !== 'string' ||
    typeof c.unidade_id !== 'string' ||
    typeof c.estoque_atual !== 'number'
  ) {
    return erro(400, 'Informe { codigo, unidade_id, estoque_atual }');
  }
  try {
    const okAlt = await repo.alterarEstoque(c.codigo, c.unidade_id, c.estoque_atual);
    if (!okAlt) return erro(400, 'Item (medicamento/unidade) inexistente ou valor invalido');
    return ok({ ok: true, itens: await repo.listarEstoque() });
  } catch (e) {
    return erro(502, (e as Error).message);
  }
}

/** GET /api/indicadores — KPIs do piloto. */
export async function handleIndicadores(): Promise<RespostaApp> {
  try {
    return ok(await repo.indicadores());
  } catch (e) {
    return ok({ indisponivel: true, motivo: (e as Error).message });
  }
}

/** GET /webhook — verificacao da Meta. */
export function handleWebhookVerify(
  mode: string | null,
  token: string | null,
  challenge: string | null,
): { status: number; texto: string } {
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken && challenge) {
    return { status: 200, texto: challenge };
  }
  return { status: 403, texto: 'forbidden' };
}

/** POST /webhook — recebe mensagens da Meta (processa apos responder 200). */
export async function handleWebhookMensagem(corpo: unknown): Promise<void> {
  if (!canalWhatsApp) return;
  const msg = canalWhatsApp.receber(corpo);
  if (!msg) return;
  try {
    const { mensagens, ignorada } = await atendimento.processar(msg);
    if (ignorada) return;
    for (const texto of mensagens) await canalWhatsApp.enviar(msg.remetente, texto);
  } catch (e) {
    console.error('Erro ao processar mensagem do WhatsApp:', (e as Error).message);
  }
}

/** POST do webhook do Twilio: processa e responde em TwiML (sem token de saida). */
export async function handleTwilioInbound(corpo: unknown): Promise<{ status: number; xml: string }> {
  const msg = canalTwilio.receber(corpo);
  if (!msg) return { status: 200, xml: montarTwiml([]) };
  try {
    const { mensagens, ignorada } = await atendimento.processar(msg);
    // No WhatsApp, juntamos tudo numa única mensagem: melhor leitura e economiza
    // o saldo do sandbox (uma bolha por turno em vez de 3 na primeira interação).
    const saida = ignorada || mensagens.length === 0 ? [] : [mensagens.join('\n\n')];
    return { status: 200, xml: montarTwiml(saida) };
  } catch (e) {
    console.error('Erro no webhook do Twilio:', (e as Error).message);
    // Responde vazio (200) para o Twilio nao reentregar em loop.
    return { status: 200, xml: montarTwiml([]) };
  }
}

export const infoApp = {
  modo: config.modo,
  repositorio: config.repositorio,
  sessao: config.sessao,
  ia: config.iaProvedor,
  edicaoProtegida: config.adminToken !== '',
  demonstracao: ehDemonstracao,
};
