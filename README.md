# Assistente Virtual — Farmácia Municipal (protótipo)

Assistente informativo que responde se um medicamento **consta como disponível** no
estoque da Farmácia Municipal. Canal exclusivamente informativo: não reserva, não
orienta sobre uso, não substitui profissional de saúde.

> ⚠️ **Dados fictícios.** Nenhum quantitativo representa estoque real.

📘 **Vai instalar ou replicar a solução no seu órgão?** Siga o
[**Manual de Instalação e Replicação**](docs/MANUAL_INSTALACAO.md): contas, banco, IA,
publicação, carga dos seus dados (com modelos de planilha) e ativação do WhatsApp.

O contexto completo do projeto está em [`CLAUDE.md`](CLAUDE.md). Este README é o guia de execução.

## Requisitos

- **Node.js 22+** (testado no 24). Nada mais é preciso para o modo local — o protótipo
  roda offline, sem `npm install` e sem passo de build (Node executa TypeScript nativamente).

## Rodar o simulador (fase A — demonstração)

```bash
npm start
```

Abra <http://localhost:3000>. Você verá:

- Conversas estilo WhatsApp, com botões de atalho para o roteiro da demonstração.
- **+ Nova conversa**: abra vários painéis lado a lado — cada um é uma sessão isolada
  (prova de que não há fila nem vazamento de estado entre cidadãos).
- Painel **Estoque (ao vivo)**: altere o estoque de um item e repita a pergunta — a
  resposta muda na hora. É o que prova que a informação vem da base, não do modelo.
- Painel **Indicadores**: KPIs do piloto calculados a partir do log anônimo da sessão.

## Testes

```bash
npm test
```

Cobrem a lógica de decisão (seção 5 do CLAUDE.md), os casos de aceitação da busca e —
o mais importante — **concorrência**: duas e cinquenta sessões em desambiguação
simultânea, sem troca de conteúdo entre elas, mais deduplicação de mensagens.

## Regenerar o seed local

O `src/dados/seed.json` é **gerado** a partir dos SQL em `db/` — o SQL é a fonte única
de verdade. Após editar os `.sql`:

```bash
npm run seed
```

## Ligar o Supabase (busca no banco real)

1. Crie o projeto no Supabase e rode, no SQL Editor, o arquivo único
   `db/00_setup_completo.sql` (schema + seed fictício + sessões). Detalhes na seção 5 do
   [manual](docs/MANUAL_INSTALACAO.md#5-passo-2-criar-o-banco-no-supabase).
2. `npm install` (baixa `@supabase/supabase-js`).
3. Copie `.env.example` para `.env`, preencha `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` e defina `REPOSITORIO=supabase`.
4. `npm start`. A busca passa a usar a RPC `buscar_medicamento`; a lógica de negócio é a mesma.

## Ligar a redação por IA (opcional)

Sem chave de IA, a resposta é montada por um template determinístico (sempre correto).
Para redação em linguagem natural, defina `IA_PROVEDOR=gemini` e `GEMINI_API_KEY` (Google
AI Studio, tier grátis; modelo padrão `gemini-flash-lite-latest`) ou `IA_PROVEDOR=anthropic`
e `ANTHROPIC_API_KEY`. A IA recebe **apenas** o registro devolvido pelo banco — nunca
decide disponibilidade.

## WhatsApp (fases B e C)

O webhook já está pronto em `GET/POST /webhook` (`src/canais/whatsapp.ts`). A conexão com
o número de teste da Meta e o número oficial está descrita no `CLAUDE.md`, seção 8. É só
credencial: a lógica de negócio não muda.

## Hospedar na Vercel

O app já está estruturado para deploy serverless. Passo a passo completo em
[`docs/04_deploy_vercel.md`](docs/04_deploy_vercel.md). Resumo: rode `db/03_sessoes.sql`,
suba para o GitHub, importe na Vercel e configure as variáveis de ambiente
(incluindo `SESSAO=supabase`, obrigatório em serverless).

## Estrutura

```
public/index.html       simulador (estático; servido localmente e na Vercel)
functions-src/          fontes das funções serverless (mensagem, estoque, indicadores, webhook)
build.mjs               empacota functions-src/*.ts -> api/*.js (esbuild) para a Vercel
src/
├── app.ts              raiz de composição + handlers (usados pelo servidor local E pela Vercel)
├── index.ts            servidor HTTP local (fino; delega ao app.ts)
├── config.ts           configuração e leitura do .env (sem dependência)
├── canais/             abstração de canal (simulador / WhatsApp)
├── dominio/
│   ├── decisao.ts      os quatro desvios da seção 5 — o coração do sistema
│   ├── atendimento.ts  orquestra um atendimento fim a fim
│   ├── sessao.ts       estado por remetente, TTL, dedup, hash anônimo (backend memória)
│   ├── texto.ts        normalização + similaridade estilo pg_trgm
│   ├── mensagens.ts    textos padrão e fallback determinístico
│   └── redacao-ia.ts   chamada da IA com fallback obrigatório
├── dados/
│   ├── repositorio.ts  interface; a lógica não sabe se é local ou Supabase
│   ├── local.ts        roda offline a partir do seed
│   ├── supabase.ts     chama a RPC buscar_medicamento (+ edição via service_role)
│   ├── sessao-supabase.ts  estado de sessão no banco (serverless)
│   ├── cliente-supabase.ts cliente compartilhado (import dinâmico do SDK)
│   └── seed.json       GERADO por scripts/gerar-seed.mjs — não editar à mão
```
