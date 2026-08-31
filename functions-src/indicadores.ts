// Funcao serverless (Vercel): GET /api/indicadores.
import { handleIndicadores } from '../src/app.ts';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });
  const r = await handleIndicadores();
  res.status(r.status).json(r.corpo);
}
