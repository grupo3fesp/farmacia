// Servidor HTTP local (dev / servidor persistente). Fino: delega toda a logica
// aos handlers de src/app.ts, os mesmos usados pelas funcoes serverless da
// Vercel (api/*.ts). Serve o simulador estatico de public/.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config } from './config.ts';
import {
  handleMensagem,
  handleListarEstoque,
  handleAlterarEstoque,
  handleIndicadores,
  handleWebhookVerify,
  handleWebhookMensagem,
  handleTwilioInbound,
  infoApp,
} from './app.ts';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function enviarJson(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

async function lerBruto(req: IncomingMessage): Promise<string> {
  const partes: Buffer[] = [];
  for await (const parte of req) partes.push(parte as Buffer);
  return Buffer.concat(partes).toString('utf8');
}

async function lerCorpo(req: IncomingMessage): Promise<unknown> {
  const bruto = await lerBruto(req);
  if (!bruto) return {};
  try {
    return JSON.parse(bruto);
  } catch {
    return null;
  }
}

async function servirEstatico(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(raiz, 'public', 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    enviarJson(res, 500, { erro: 'public/index.html nao encontrado' });
  }
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const rota = `${req.method} ${url.pathname}`;

    switch (rota) {
      case 'GET /':
      case 'GET /index.html':
        return await servirEstatico(res);

      case 'GET /saude':
        return enviarJson(res, 200, { ok: true, ...infoApp });

      case 'POST /api/mensagem': {
        const r = await handleMensagem(await lerCorpo(req));
        return enviarJson(res, r.status, r.corpo);
      }
      case 'GET /api/estoque': {
        const r = await handleListarEstoque();
        return enviarJson(res, r.status, r.corpo);
      }
      case 'POST /api/estoque': {
        const token = req.headers['x-admin-token'];
        const r = await handleAlterarEstoque(
          await lerCorpo(req),
          Array.isArray(token) ? token[0] : token,
        );
        return enviarJson(res, r.status, r.corpo);
      }
      case 'GET /api/indicadores': {
        const r = await handleIndicadores();
        return enviarJson(res, r.status, r.corpo);
      }
      case 'GET /webhook': {
        const v = handleWebhookVerify(
          url.searchParams.get('hub.mode'),
          url.searchParams.get('hub.verify_token'),
          url.searchParams.get('hub.challenge'),
        );
        res.writeHead(v.status, { 'Content-Type': 'text/plain' });
        return res.end(v.texto);
      }
      case 'POST /webhook': {
        const corpo = await lerCorpo(req);
        res.writeHead(200);
        res.end('EVENT_RECEIVED'); // responde <5s; processa depois
        void handleWebhookMensagem(corpo);
        return;
      }
      case 'POST /api/twilio': {
        const bruto = await lerBruto(req);
        const corpo: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(bruto)) corpo[k] = v;
        const r = await handleTwilioInbound(corpo);
        res.writeHead(r.status, { 'Content-Type': 'text/xml; charset=utf-8' });
        return res.end(r.xml);
      }
      default:
        return enviarJson(res, 404, { erro: 'rota nao encontrada', rota });
    }
  } catch (e) {
    enviarJson(res, 500, { erro: (e as Error).message });
  }
});

servidor.listen(config.porta, () => {
  console.log(`\n  Assistente da Farmácia Municipal`);
  console.log(`  Simulador:   http://localhost:${config.porta}`);
  console.log(`  Modo: ${infoApp.modo} | Repo: ${infoApp.repositorio} | Sessão: ${infoApp.sessao}`);
  console.log(`  IA: ${infoApp.ia} | Edição: ${infoApp.edicaoProtegida ? 'protegida por token' : 'aberta'}\n`);
});
