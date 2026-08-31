# Deploy na Vercel

O app foi estruturado para a Vercel (serverless): o simulador é estático em
`public/` e a API são funções serverless. A lógica de negócio é a mesma do
servidor local — os handlers em `src/app.ts` servem os dois.

As funções são empacotadas por um passo de build: `npm run build` (esbuild) lê
`functions-src/*.ts` e gera `api/*.js` autocontidos (todo o `src/` e os SDKs
inlinados). Isso evita o problema de o Node de produção não importar `.ts`. A
Vercel roda esse build automaticamente (definido em `vercel.json`).

## Pré-requisitos (no Supabase, uma vez)

1. Schema + seed rodados (`db/01_schema_supabase.sql`, `db/02_seed_dados_ficticios.sql`).
2. **`db/03_sessoes.sql`** rodado — cria `sessoes` e `mensagens_vistas`. **Obrigatório**
   na Vercel: em serverless a memória não é compartilhada entre invocações, então o
   estado da desambiguação e a deduplicação moram no banco.

## 1. Subir o código para o GitHub

```bash
git add -A
git commit -m "Assistente Farmácia Municipal — pronto para Vercel"
git remote add origin https://github.com/<voce>/<repo>.git
git push -u origin main
```

> O `.env` está no `.gitignore` e **não** é enviado. As chaves vão nas variáveis
> de ambiente da Vercel (passo 3).

## 2. Importar na Vercel

1. [vercel.com/new](https://vercel.com/new) → importe o repositório.
2. Framework Preset: **Other**. O `vercel.json` já define o Build Command
   (`npm run build`), o Output Directory (`public`) e as funções — não precisa
   configurar nada na tela de import.

## 3. Variáveis de ambiente (Project Settings → Environment Variables)

| Variável | Valor | Observação |
|---|---|---|
| `REPOSITORIO` | `supabase` | usa a RPC no banco real |
| `SESSAO` | `supabase` | **obrigatório** em serverless |
| `MODO` | `demonstracao` | mantém o aviso de dados fictícios |
| `SUPABASE_URL` | *sua URL* | |
| `SUPABASE_ANON_KEY` | *sua anon key* | |
| `SUPABASE_SERVICE_ROLE_KEY` | *sua service key* | **secreta** — só no backend, nunca exposta ao navegador |
| `SAL_SESSAO` | *segredo forte* | sal do hash do remetente (LGPD) |
| `ADMIN_TOKEN` | *segredo* | exige token para editar estoque (edição protegida) |
| `ANTHROPIC_API_KEY` | *opcional* | sem ela, resposta por template determinístico |
| `ANTHROPIC_MODELO` | `claude-sonnet-5` | opcional |

As funções da Vercel rodam no servidor: a `service_role` fica só nelas, nunca vai
para o cliente. O simulador manda o `ADMIN_TOKEN` no cabeçalho `x-admin-token` só
quando alguém edita o estoque.

## 4. Deploy e teste

Após o deploy, abra a URL da Vercel e valide:

- Uma consulta (ex.: `zitromax`) responde a partir do banco.
- No painel **Estoque (ao vivo)**, informe o `ADMIN_TOKEN` e altere um item; repita a
  pergunta numa conversa — a resposta muda.
- Abra a URL em dois navegadores/abas: como o estado mora no Supabase, a sessão e a
  deduplicação funcionam mesmo caindo em instâncias diferentes.

## Notas

- **Node**: a Vercel usa a versão de `engines.node` do `package.json` (22.x).
- **WhatsApp** (fases B/C): a função `api/webhook.ts` já está pronta. Configure na Meta
  a URL `https://<seu-projeto>.vercel.app/webhook` e o `WHATSAPP_VERIFY_TOKEN`
  (mais `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` nas variáveis).
- As funções (`api/*.js`) são geradas pelo build e **não** são versionadas
  (`.gitignore`); a Vercel as recria a cada deploy.
