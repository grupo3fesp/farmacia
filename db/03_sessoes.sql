-- =====================================================================
-- Estado de sessao persistente (para hospedagem serverless / multi-instancia)
-- Necessario na Vercel: a memoria local nao e compartilhada entre invocacoes.
-- Rode este arquivo no SQL Editor DEPOIS do schema e do seed.
-- Acesso somente pela service_role (backend). RLS bloqueia anon por completo.
-- =====================================================================

-- Estado conversacional por sessao (desambiguacao pendente + boas-vindas).
create table if not exists public.sessoes (
  sessao_hash text primary key,
  aguardando  text,                              -- 'desambiguacao' | null
  opcoes      jsonb not null default '[]'::jsonb, -- registros oferecidos (sem dado pessoal)
  ja_saudou   boolean not null default false,
  expira_em   timestamptz not null
);

comment on table public.sessoes is
  'Estado de sessao do assistente. Sem dado pessoal: so codigos de medicamento e expiracao.';

create index if not exists idx_sessoes_expira on public.sessoes (expira_em);

-- Deduplicacao de mensagens (idempotencia do webhook).
create table if not exists public.mensagens_vistas (
  id_mensagem text primary key,
  expira_em   timestamptz not null
);

create index if not exists idx_mensagens_vistas_expira on public.mensagens_vistas (expira_em);

-- Limpeza de expirados. Pode ser chamada por pg_cron ou pelo backend.
create or replace function public.limpar_sessoes_expiradas()
returns void
language sql
as $$
  delete from public.sessoes        where expira_em < now();
  delete from public.mensagens_vistas where expira_em < now();
$$;

-- RLS: nenhuma politica para anon => anon nao le nem escreve. A service_role,
-- usada apenas no backend, ignora a RLS.
alter table public.sessoes          enable row level security;
alter table public.mensagens_vistas enable row level security;
