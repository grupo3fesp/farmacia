# WhatsApp via Twilio Sandbox (sem conta de desenvolvedor Meta)

O adaptador Twilio já está no código e no ar. O webhook responde em **TwiML**, então
**não precisa de token/credencial de saída** — a resposta vai no corpo da requisição.

- **Webhook (Callback URL):** `https://grupo3fesp.vercel.app/api/twilio`  (método **POST**)

## Passo a passo

1. **Criar conta Twilio** (trial grátis): [twilio.com/try-twilio](https://www.twilio.com/try-twilio).
   Exige e-mail + verificação de telefone (sistema próprio, independente da Meta).

2. No **Console** do Twilio: **Messaging → Try it out → Send a WhatsApp message**.
   Isso abre o **WhatsApp Sandbox**, que mostra:
   - um número de sandbox (ex.: `+1 415 523 8886`);
   - um código de entrada, tipo `join <duas-palavras>`.

3. **Cada testador** envia, do próprio WhatsApp, a mensagem **`join <duas-palavras>`**
   para o número do sandbox. Isso o conecta ao sandbox (até ~72h de inatividade).

4. Na aba **Sandbox settings**, em **"When a message comes in"**, cole:
   - URL: `https://grupo3fesp.vercel.app/api/twilio`
   - Método: **POST** → **Save**.

5. **Testar:** um testador envia `tem dipirona?` para o número do sandbox → o assistente
   responde no WhatsApp. 🎉

## Observações

- **Sem variáveis de ambiente** para o fluxo TwiML — nada a configurar na Vercel.
- O aviso de "dados fictícios" aparece nas respostas (`MODO=demonstracao`).
- O sandbox é um número **compartilhado** do Twilio e exige o `join` — serve para
  testes/demonstração da equipe, não para o cidadão final.
- **Produção (número próprio):** o Twilio exige aprovar um *WhatsApp Sender* (WABA),
  equivalente à homologação. O **mesmo webhook** `/api/twilio` continua valendo — muda
  só o número. Como alternativa, o Cloud API da Meta (`/api/webhook`) também já está
  pronto, quando a conta Meta destravar.
- **Segurança:** para deixar público por mais tempo, dá para validar a assinatura
  `X-Twilio-Signature` do Twilio no webhook (peça que eu implemento).
