# Assistente Virtual — Farmácia Municipal (protótipo)

Assistente informativo que responde se um medicamento **consta como disponível** no
estoque da Farmácia Municipal. Canal exclusivamente informativo: não reserva, não
orienta sobre uso, não substitui profissional de saúde.

> ⚠️ **Dados fictícios.** Nenhum quantitativo representa estoque real.

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

1. Siga [`docs/03_passo_a_passo_supabase.md`](docs/03_passo_a_passo_supabase.md): crie o
   projeto e rode `db/01_schema_supabase.sql` e `db/02_seed_dados_ficticios.sql`.
2. `npm install` (baixa `@supabase/supabase-js`).
3. Copie `.env.example` para `.env`, preencha `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` e defina `REPOSITORIO=supabase`.
4. `npm start`. A busca passa a usar a RPC `buscar_medicamento`; a lógica de negócio é a mesma.

## Ligar a redação por IA (opcional)

Sem `ANTHROPIC_API_KEY`, a resposta é montada por um template determinístico (sempre
correto). Para redação em linguagem natural: `npm install`, preencha `ANTHROPIC_API_KEY`
no `.env` e reinicie. A IA recebe **apenas** o registro devolvido pelo banco — nunca
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
api/                     funções serverless da Vercel (mensagem, estoque, indicadores, webhook)
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
