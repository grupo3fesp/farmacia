// Funcao serverless (Vercel): POST /api/mensagem. Delega ao handler compartilhado.
import { handleMensagem } from '../src/app.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });
  const corpo = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const r = await handleMensagem(corpo);
  res.status(r.status).json(r.corpo);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
