// Abstracao de canal (CLAUDE.md secao 8). O simulador e o WhatsApp usam a mesma
// logica de negocio; muda apenas o adaptador que traduz payload <-> mensagem.

import type { MensagemRecebida } from '../dominio/tipos.ts';

export interface CanalMensagem {
  /** Extrai a mensagem do payload do canal, ou null se nao houver mensagem util. */
  receber(payload: unknown): MensagemRecebida | null;
  /** Envia um texto ao destinatario pelo canal. */
  enviar(destinatario: string, texto: string): Promise<void>;
}
