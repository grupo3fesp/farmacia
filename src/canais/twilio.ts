// Adaptador do Twilio WhatsApp (Sandbox e produção via BSP Twilio).
// Alternativa ao WhatsApp Cloud API da Meta que dispensa conta de desenvolvedor
// Meta. O Twilio entrega a mensagem por POST (form-urlencoded) e aceita a
// resposta via TwiML no corpo da mesma requisicao — sem token de saida.

import type { CanalMensagem } from './tipos.ts';
import type { MensagemRecebida } from '../dominio/tipos.ts';

export class CanalTwilio implements CanalMensagem {
  /** Extrai a mensagem do payload do Twilio (campos From, Body, MessageSid). */
  receber(payload: unknown): MensagemRecebida | null {
    const p = (payload ?? {}) as Record<string, string>;
    const from = p.From ?? p.from;
    const texto = p.Body ?? p.body;
    const id = p.MessageSid ?? p.SmsMessageSid ?? p.SmsSid ?? '';
    if (!from || !texto) return null;
    // 'From' vem como "whatsapp:+55...". Mantemos como chave (sera hasheada).
    return { remetente: from, texto, idMensagem: id };
  }

  /** No fluxo TwiML a resposta vai no corpo do webhook; enviar() nao e usado. */
  async enviar(): Promise<void> {
    throw new Error('CanalTwilio responde via TwiML no webhook; enviar() nao se aplica.');
  }
}

/** Monta a resposta TwiML com uma <Message> por texto. */
export function montarTwiml(mensagens: string[]): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  const corpo = mensagens.map((m) => `<Message>${esc(m)}</Message>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${corpo}</Response>`;
}
