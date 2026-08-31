// Funcao serverless (Vercel): GET lista o estoque, POST altera (gate por token).
import { handleListarEstoque, handleAlterarEstoque } from '../src/app.ts';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    const r = await handleListarEstoque();
    return res.status(r.status).json(r.corpo);
  }
  if (req.method === 'POST') {
    const token = req.headers['x-admin-token'];
    const corpo = typeof req.body === 'string' ? safeParse(req.body) : req.body;
    const r = await handleAlterarEstoque(corpo, Array.isArray(token) ? token[0] : token);
    return res.status(r.status).json(r.corpo);
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
