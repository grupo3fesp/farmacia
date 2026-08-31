// Adaptador do WhatsApp Cloud API (Meta) — fases B e C do projeto.
// O mesmo codigo serve as duas fases; muda so o par (token, phoneNumberId).
// Nao e exercitado no demo offline, mas ja deixa o webhook pronto (secao 8).

import type { CanalMensagem } from './tipos.ts';
import type { MensagemRecebida } from '../dominio/tipos.ts';

type ConfigWhatsApp = {
  token: string;
  phoneNumberId: string;
};

export class CanalWhatsApp implements CanalMensagem {
  private readonly cfg: ConfigWhatsApp;

  constructor(cfg: ConfigWhatsApp) {
    this.cfg = cfg;
  }

  /** Extrai a primeira mensagem de texto do payload do webhook da Meta. */
  receber(payload: unknown): MensagemRecebida | null {
    try {
      const p = payload as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              messages?: Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>;
            };
          }>;
        }>;
      };
      const msg = p.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!msg || msg.type !== 'text' || !msg.text?.body || !msg.from) return null;
      return { remetente: msg.from, texto: msg.text.body, idMensagem: msg.id ?? '' };
    } catch {
      return null;
    }
  }

  /** Envia texto pela Graph API. */
  async enviar(destinatario: string, texto: string): Promise<void> {
    const url = `https://graph.facebook.com/v21.0/${this.cfg.phoneNumberId}/messages`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinatario,
        type: 'text',
        text: { body: texto },
      }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      throw new Error(`Falha ao enviar no WhatsApp (${resp.status}): ${corpo}`);
    }
  }
}
