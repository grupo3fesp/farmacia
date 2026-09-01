// Funcao serverless (Vercel): webhook do Twilio WhatsApp. POST recebe a mensagem
// (form-urlencoded) e responde em TwiML. Configure esta URL no Sandbox do Twilio
// em "When a message comes in": https://<seu-dominio>/api/twilio
import { handleTwilioInbound } from '../src/app.ts';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    // Acesso pelo navegador: so um aviso; o Twilio usa POST.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('Webhook do Twilio ativo. Configure esta URL (POST) no Sandbox.');
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const corpo = normalizarCorpo(req.body);
  const r = await handleTwilioInbound(corpo);
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(r.status).send(r.xml);
}

/** O corpo do Twilio e application/x-www-form-urlencoded. A Vercel costuma
 *  entregar como objeto; se vier string, parseamos. */
function normalizarCorpo(body: unknown): Record<string, string> {
  if (body && typeof body === 'object') return body as Record<string, string>;
  if (typeof body === 'string') {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(body)) out[k] = v;
    return out;
  }
  return {};
}
