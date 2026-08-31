// Funcao serverless (Vercel): webhook do WhatsApp. GET verifica, POST recebe.
// Responde 200 rapido; o processamento assincrono roda no mesmo invocation
// (em serverless, o trabalho precisa terminar antes da resposta — por isso
// aguardamos handleWebhookMensagem aqui, ainda dentro do limite de tempo).
import { handleWebhookVerify, handleWebhookMensagem } from '../src/app.ts';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const v = handleWebhookVerify(
      req.query['hub.mode'] ?? null,
      req.query['hub.verify_token'] ?? null,
      req.query['hub.challenge'] ?? null,
    );
    return res.status(v.status).send(v.texto);
  }
  if (req.method === 'POST') {
    const corpo = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    await handleWebhookMensagem(corpo);
    return res.status(200).send('EVENT_RECEIVED');
  }
  res.status(405).json({ erro: 'Método não permitido' });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
