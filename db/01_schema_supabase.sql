-- =====================================================================
-- Assistente Virtual Inteligente - Farmacia Municipal
-- Schema Supabase (PostgreSQL) - MODELO MULTIUNIDADE
-- O estoque e por unidade: o mesmo medicamento pode existir em varias
-- farmacias, cada uma com sua quantidade.
-- Executar no SQL Editor, na ordem: este arquivo, depois o seed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensoes
-- ---------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- 2. Tabelas
-- ---------------------------------------------------------------------

create table if not exists public.unidades (
  id        text primary key,
  nome      text not null,
  endereco  text,
  horario   text,
  telefone  text
);

comment on table public.unidades is
  'Unidades dispensadoras (farmacias). No prototipo, dados ficticios.';

-- Catalogo de medicamentos (SEM estoque - o estoque e por unidade).
create table if not exists public.medicamentos (
  codigo             text primary key,
  principio_ativo    text not null,
  apresentacao       text not null,
  forma_farmaceutica text,
  componente         text,
  unidade_medida     text,
  tipo_receita       text
);

comment on table public.medicamentos is
  'Catalogo de medicamentos. O estoque fica na tabela estoques, por unidade.';

-- Estoque por unidade: uma linha por (medicamento, unidade).
create table if not exists public.estoques (
  codigo         text not null references public.medicamentos (codigo) on delete cascade,
  unidade_id     text not null references public.unidades (id),
  estoque_atual  integer not null default 0 check (estoque_atual >= 0),
  estoque_minimo integer not null default 0 check (estoque_minimo >= 0),
  atualizado_em  timestamptz not null default now(),
  -- Situacao derivada do estoque daquela unidade (coluna gerada, nao gravavel).
  situacao text generated always as (
    case
      when estoque_atual = 0                then 'EM FALTA'
      when estoque_atual <= estoque_minimo  then 'ESTOQUE BAIXO'
      else 'DISPONIVEL'
    end
  ) stored,
  primary key (codigo, unidade_id)
);

comment on table public.estoques is
  'Posicao de estoque por unidade. situacao e coluna gerada pelo banco.';

create table if not exists public.sinonimos (
  id         bigint generated always as identity primary key,
  codigo     text not null references public.medicamentos (codigo) on delete cascade,
  termo      text not null,
  termo_norm text not null,
  unique (codigo, termo_norm)
);

comment on table public.sinonimos is
  'Nomes comerciais, apelidos populares e erros de digitacao mapeados ao medicamento.';

create table if not exists public.consultas_log (
  id                    bigint generated always as identity primary key,
  sessao_hash           text,
  termo_digitado        text,
  codigo_encontrado     text,
  situacao_retornada    text,
  encaminhado_humano    boolean not null default false,
  motivo_encaminhamento text,
  criado_em             timestamptz not null default now()
);

comment on table public.consultas_log is
  'Registro anonimo de atendimentos, base dos indicadores (LGPD: sem dado pessoal).';

-- ---------------------------------------------------------------------
-- 3. Indices
-- ---------------------------------------------------------------------
create index if not exists idx_sinonimos_termo_norm
  on public.sinonimos using gin (termo_norm extensions.gin_trgm_ops);
create index if not exists idx_sinonimos_codigo
  on public.sinonimos (codigo);
create index if not exists idx_medicamentos_principio
  on public.medicamentos using gin (principio_ativo extensions.gin_trgm_ops);
create index if not exists idx_estoques_unidade
  on public.estoques (unidade_id);
create index if not exists idx_log_criado_em
  on public.consultas_log (criado_em desc);

-- ---------------------------------------------------------------------
-- 4. Gatilhos
-- ---------------------------------------------------------------------
create or replace function public.fn_normaliza_termo()
returns trigger
language plpgsql
as $$
begin
  new.termo_norm := lower(extensions.unaccent(new.termo));
  return new;
end;
$$;

drop trigger if exists trg_normaliza_termo on public.sinonimos;
create trigger trg_normaliza_termo
  before insert or update of termo on public.sinonimos
  for each row execute function public.fn_normaliza_termo();

-- Carimba data/hora quando o estoque de uma unidade muda.
create or replace function public.fn_carimba_atualizacao()
returns trigger
language plpgsql
as $$
begin
  if new.estoque_atual is distinct from old.estoque_atual
     or new.estoque_minimo is distinct from old.estoque_minimo then
    new.atualizado_em := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_carimba_atualizacao on public.estoques;
create trigger trg_carimba_atualizacao
  before update on public.estoques
  for each row execute function public.fn_carimba_atualizacao();

-- ---------------------------------------------------------------------
-- 5. Busca (nivel de catalogo, SEM estoque)
--    Tres niveis: sinonimo exato -> principio ativo -> aproximado.
--    Retorna um registro por medicamento (codigo). O estoque por unidade
--    vem depois, por estoque_medicamento(codigo).
-- ---------------------------------------------------------------------
create or replace function public.buscar_medicamento(
  p_termo text,
  p_limite integer default 5
)
returns table (
  codigo             text,
  principio_ativo    text,
  apresentacao       text,
  forma_farmaceutica text,
  unidade_medida     text,
  tipo_receita       text,
  origem             text,
  semelhanca         real
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with entrada as (
    select lower(extensions.unaccent(coalesce(p_termo, ''))) as t
  ),
  -- Medicamentos cujo principio ativo COMECA com o termo (prefixo).
  prefixos as (
    select m.codigo, m.principio_ativo as pa
      from public.medicamentos m, entrada e
     where length(e.t) >= 3
       and starts_with(lower(extensions.unaccent(m.principio_ativo)), e.t)
       and lower(extensions.unaccent(m.principio_ativo)) <> e.t
  ),
  achados as (
    select s.codigo, 'sinonimo_exato'::text as origem, 1.0::real as semelhanca
      from public.sinonimos s, entrada e
     where s.termo_norm = e.t
    union all
    select m.codigo, 'principio_ativo'::text, 0.95::real
      from public.medicamentos m, entrada e
     where lower(extensions.unaccent(m.principio_ativo)) = e.t
    union all
    select s.codigo, 'aproximado'::text, similarity(s.termo_norm, e.t)
      from public.sinonimos s, entrada e
     where e.t <> '' and similarity(s.termo_norm, e.t) > 0.42
    union all
    -- Nivel 4: prefixo do principio ativo. Se casa 2+ principios distintos
    -- ("insulina", "acido"), eleva a 1.0 para empatar -> desambiguacao; senao 0.5.
    select p.codigo, 'aproximado'::text,
           (case when (select count(distinct pa) from prefixos) >= 2 then 1.0 else 0.5 end)::real
      from prefixos p
  ),
  melhor as (
    select a.codigo, max(a.semelhanca) as semelhanca,
           (array_agg(a.origem order by a.semelhanca desc))[1] as origem
      from achados a
     group by a.codigo
  )
  select m.codigo, m.principio_ativo, m.apresentacao, m.forma_farmaceutica,
         m.unidade_medida, m.tipo_receita, b.origem, b.semelhanca
    from melhor b
    join public.medicamentos m on m.codigo = b.codigo
   order by b.semelhanca desc, m.principio_ativo
   limit p_limite;
$$;

comment on function public.buscar_medicamento is
  'Busca no catalogo. O estoque por unidade vem de estoque_medicamento(codigo).';

-- Estoque de um medicamento em todas as unidades que o possuem.
create or replace function public.estoque_medicamento(p_codigo text)
returns table (
  unidade_id     text,
  unidade_nome   text,
  endereco       text,
  horario        text,
  estoque_atual  integer,
  estoque_minimo integer,
  situacao       text,
  atualizado_em  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select e.unidade_id, u.nome, u.endereco, u.horario,
         e.estoque_atual, e.estoque_minimo, e.situacao, e.atualizado_em
    from public.estoques e
    join public.unidades u on u.id = e.unidade_id
   where e.codigo = p_codigo
   order by u.nome;
$$;

comment on function public.estoque_medicamento is
  'Estoque de um medicamento por unidade. A IA redige a partir do que isto devolve.';

-- ---------------------------------------------------------------------
-- 6. Indicadores do piloto
-- ---------------------------------------------------------------------
create or replace view public.vw_indicadores as
select
  count(*)                                                          as consultas_totais,
  count(*) filter (where codigo_encontrado is not null)             as termos_reconhecidos,
  round(100.0 * count(*) filter (where codigo_encontrado is not null)
        / nullif(count(*), 0), 1)                                   as taxa_reconhecimento_pct,
  count(*) filter (where encaminhado_humano)                        as encaminhamentos_humanos,
  round(100.0 * count(*) filter (where not encaminhado_humano)
        / nullif(count(*), 0), 1)                                   as taxa_resolucao_automatica_pct,
  count(*) filter (where situacao_retornada = 'EM FALTA')           as consultas_itens_em_falta
from public.consultas_log;

create or replace view public.vw_mais_consultados as
select codigo_encontrado as codigo, count(*) as consultas
  from public.consultas_log
 where codigo_encontrado is not null
 group by codigo_encontrado
 order by consultas desc;

-- ---------------------------------------------------------------------
-- 7. Seguranca (RLS)
-- ---------------------------------------------------------------------
alter table public.medicamentos  enable row level security;
alter table public.estoques      enable row level security;
alter table public.sinonimos     enable row level security;
alter table public.unidades      enable row level security;
alter table public.consultas_log enable row level security;

drop policy if exists p_medicamentos_leitura on public.medicamentos;
create policy p_medicamentos_leitura on public.medicamentos
  for select to anon, authenticated using (true);

drop policy if exists p_estoques_leitura on public.estoques;
create policy p_estoques_leitura on public.estoques
  for select to anon, authenticated using (true);

drop policy if exists p_sinonimos_leitura on public.sinonimos;
create policy p_sinonimos_leitura on public.sinonimos
  for select to anon, authenticated using (true);

drop policy if exists p_unidades_leitura on public.unidades;
create policy p_unidades_leitura on public.unidades
  for select to anon, authenticated using (true);

drop policy if exists p_log_insercao on public.consultas_log;
create policy p_log_insercao on public.consultas_log
  for insert to anon, authenticated with check (true);
-- Escrita em estoques so pela service_role (backend); anon nao tem policy de escrita.
