-- =====================================================================
-- MIGRAÇÃO MULTIUNIDADE - COMPLETA (cole tudo no SQL Editor e RUN)
-- Remove o modelo antigo e recria com estoque por unidade + seed.
-- =====================================================================

-- =====================================================================
-- Migracao para o MODELO MULTIUNIDADE (estoque por unidade).
-- Remove o modelo antigo (dados ficticios) para recriar do zero.
-- Rode ESTE arquivo primeiro; depois 01_schema_supabase.sql e
-- 02_seed_dados_ficticios.sql (novos).
-- unidades, consultas_log, sessoes e mensagens_vistas sao preservadas.
-- =====================================================================
drop view     if exists public.vw_mais_consultados;
drop view     if exists public.vw_indicadores;
drop function if exists public.buscar_medicamento(text, integer);
drop function if exists public.estoque_medicamento(text);
drop table    if exists public.estoques  cascade;
drop table    if exists public.sinonimos cascade;
drop table    if exists public.medicamentos cascade;

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

-- Seed da base FICTICIA - MODELO MULTIUNIDADE (estoque por unidade).
-- Quantitativos simulados. Gerado por scripts/gerar-multiunidade.mjs.

begin;

truncate table public.estoques, public.sinonimos, public.medicamentos, public.unidades restart identity cascade;

insert into public.unidades (id, nome, endereco, horario, telefone) values
  ('UN-01', 'Farmácia Municipal Central', 'Rua das Flores, 100 - Centro', 'Segunda a sexta, 7h às 17h', '(00) 0000-0001'),
  ('UN-02', 'Farmácia da UBS Bairro Novo', 'Av. Principal, 500 - Bairro Novo', 'Segunda a sexta, 7h às 16h', '(00) 0000-0002'),
  ('UN-03', 'Farmácia da UBS Vila Esperança', 'Rua São João, 25 - Vila Esperança', 'Segunda a sexta, 8h às 16h', '(00) 0000-0003');

insert into public.medicamentos (codigo, principio_ativo, apresentacao, forma_farmaceutica, componente, unidade_medida, tipo_receita) values
  ('MED-001', 'Dipirona sódica', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-002', 'Dipirona sódica', '500 mg/mL solução oral 10 mL', 'Solução oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-003', 'Paracetamol', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-004', 'Paracetamol', '200 mg/mL solução oral 15 mL', 'Solução oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-005', 'Ibuprofeno', '300 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-006', 'Amoxicilina', '500 mg', 'Cápsula', 'Básico', 'Cápsula', 'Receita de antimicrobiano (2 vias)'),
  ('MED-007', 'Amoxicilina', '50 mg/mL pó para suspensão oral 60 mL', 'Suspensão oral', 'Básico', 'Frasco', 'Receita de antimicrobiano (2 vias)'),
  ('MED-008', 'Azitromicina', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de antimicrobiano (2 vias)'),
  ('MED-009', 'Cefalexina', '500 mg', 'Cápsula', 'Básico', 'Cápsula', 'Receita de antimicrobiano (2 vias)'),
  ('MED-010', 'Sulfametoxazol + Trimetoprima', '400 mg + 80 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de antimicrobiano (2 vias)'),
  ('MED-011', 'Metronidazol', '250 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de antimicrobiano (2 vias)'),
  ('MED-012', 'Fluconazol', '150 mg', 'Cápsula', 'Básico', 'Cápsula', 'Receita simples'),
  ('MED-013', 'Metformina', '850 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-014', 'Glibenclamida', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-015', 'Insulina NPH humana', '100 UI/mL frasco 10 mL', 'Suspensão injetável', 'Básico', 'Frasco', 'Receita simples (rede de frio)'),
  ('MED-016', 'Insulina regular humana', '100 UI/mL frasco 10 mL', 'Solução injetável', 'Básico', 'Frasco', 'Receita simples (rede de frio)'),
  ('MED-017', 'Losartana potássica', '50 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-018', 'Enalapril maleato', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-019', 'Captopril', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-020', 'Hidroclorotiazida', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-021', 'Anlodipino besilato', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-022', 'Atenolol', '50 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-023', 'Propranolol cloridrato', '40 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-024', 'Sinvastatina', '20 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-025', 'Ácido acetilsalicílico', '100 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-026', 'Omeprazol', '20 mg', 'Cápsula', 'Básico', 'Cápsula', 'Receita simples'),
  ('MED-027', 'Metoclopramida cloridrato', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-028', 'Prednisona', '20 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-029', 'Prednisolona fosfato sódico', '3 mg/mL solução oral 60 mL', 'Solução oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-030', 'Dexametasona', '0,1% creme 10 g', 'Creme dermatológico', 'Básico', 'Bisnaga', 'Receita simples'),
  ('MED-031', 'Loratadina', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-032', 'Salbutamol sulfato', '100 mcg/dose aerossol', 'Aerossol oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-033', 'Beclometasona dipropionato', '250 mcg/dose aerossol', 'Aerossol oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-034', 'Albendazol', '400 mg', 'Comprimido mastigável', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-035', 'Ivermectina', '6 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-036', 'Levotiroxina sódica', '50 mcg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-037', 'Sulfato ferroso', '40 mg de ferro elementar', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-038', 'Ácido fólico', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita simples'),
  ('MED-039', 'Sais para reidratação oral', 'envelope 27,9 g', 'Pó para solução oral', 'Estratégico', 'Envelope', 'Não exige receita'),
  ('MED-040', 'Nistatina', '100.000 UI/mL suspensão oral 50 mL', 'Suspensão oral', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-041', 'Permetrina', '5% loção 60 mL', 'Loção', 'Básico', 'Frasco', 'Receita simples'),
  ('MED-042', 'Etinilestradiol + Levonorgestrel', '0,03 mg + 0,15 mg', 'Comprimido', 'Básico', 'Cartela', 'Receita simples'),
  ('MED-043', 'Amitriptilina cloridrato', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de controle especial (C1)'),
  ('MED-044', 'Fluoxetina cloridrato', '20 mg', 'Cápsula', 'Básico', 'Cápsula', 'Receita de controle especial (C1)'),
  ('MED-045', 'Carbamazepina', '200 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de controle especial (C1)'),
  ('MED-046', 'Clonazepam', '2 mg', 'Comprimido', 'Básico', 'Comprimido', 'Notificação de receita B (azul)'),
  ('MED-047', 'Diazepam', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 'Notificação de receita B (azul)'),
  ('MED-048', 'Fenitoína sódica', '100 mg', 'Comprimido', 'Básico', 'Comprimido', 'Receita de controle especial (C1)');

insert into public.estoques (codigo, unidade_id, estoque_atual, estoque_minimo) values
  ('MED-001', 'UN-01', 4820, 800),
  ('MED-001', 'UN-02', 2651, 480),
  ('MED-001', 'UN-03', 400, 320),
  ('MED-002', 'UN-01', 0, 60),
  ('MED-002', 'UN-02', 0, 36),
  ('MED-002', 'UN-03', 0, 24),
  ('MED-003', 'UN-01', 3150, 700),
  ('MED-003', 'UN-02', 350, 420),
  ('MED-004', 'UN-01', 42, 50),
  ('MED-004', 'UN-03', 13, 20),
  ('MED-005', 'UN-01', 1240, 400),
  ('MED-005', 'UN-02', 682, 240),
  ('MED-005', 'UN-03', 0, 160),
  ('MED-006', 'UN-01', 2600, 600),
  ('MED-006', 'UN-02', 0, 360),
  ('MED-007', 'UN-01', 18, 30),
  ('MED-007', 'UN-02', 10, 18),
  ('MED-007', 'UN-03', 5, 12),
  ('MED-008', 'UN-01', 0, 200),
  ('MED-008', 'UN-03', 0, 80),
  ('MED-009', 'UN-01', 940, 250),
  ('MED-009', 'UN-02', 125, 150),
  ('MED-010', 'UN-01', 1180, 300),
  ('MED-010', 'UN-02', 649, 180),
  ('MED-010', 'UN-03', 0, 120),
  ('MED-011', 'UN-01', 760, 200),
  ('MED-011', 'UN-02', 418, 120),
  ('MED-011', 'UN-03', 100, 80),
  ('MED-012', 'UN-01', 210, 60),
  ('MED-013', 'UN-01', 8600, 1500),
  ('MED-013', 'UN-02', 4730, 900),
  ('MED-013', 'UN-03', 2580, 600),
  ('MED-014', 'UN-01', 3400, 900),
  ('MED-014', 'UN-02', 1870, 540),
  ('MED-014', 'UN-03', 1020, 360),
  ('MED-015', 'UN-01', 96, 40),
  ('MED-015', 'UN-02', 20, 24),
  ('MED-016', 'UN-01', 31, 25),
  ('MED-016', 'UN-03', 13, 10),
  ('MED-017', 'UN-01', 12400, 2000),
  ('MED-017', 'UN-02', 6820, 1200),
  ('MED-017', 'UN-03', 3720, 800),
  ('MED-018', 'UN-01', 5900, 1200),
  ('MED-018', 'UN-02', 0, 720),
  ('MED-019', 'UN-01', 2100, 800),
  ('MED-019', 'UN-02', 1155, 480),
  ('MED-019', 'UN-03', 630, 320),
  ('MED-020', 'UN-01', 7300, 1200),
  ('MED-020', 'UN-03', 0, 480),
  ('MED-021', 'UN-01', 4100, 900),
  ('MED-021', 'UN-02', 450, 540),
  ('MED-022', 'UN-01', 880, 900),
  ('MED-022', 'UN-02', 484, 540),
  ('MED-022', 'UN-03', 264, 360),
  ('MED-023', 'UN-01', 2450, 600),
  ('MED-023', 'UN-02', 1348, 360),
  ('MED-023', 'UN-03', 735, 240),
  ('MED-024', 'UN-01', 6800, 1500),
  ('MED-025', 'UN-01', 9200, 1500),
  ('MED-025', 'UN-02', 5060, 900),
  ('MED-025', 'UN-03', 0, 600),
  ('MED-026', 'UN-01', 5400, 1000),
  ('MED-026', 'UN-02', 2970, 600),
  ('MED-026', 'UN-03', 500, 400),
  ('MED-027', 'UN-01', 1320, 300),
  ('MED-027', 'UN-02', 150, 180),
  ('MED-028', 'UN-01', 640, 200),
  ('MED-028', 'UN-03', 192, 80),
  ('MED-029', 'UN-01', 0, 40),
  ('MED-029', 'UN-02', 0, 24),
  ('MED-029', 'UN-03', 0, 16),
  ('MED-030', 'UN-01', 155, 40),
  ('MED-030', 'UN-02', 0, 24),
  ('MED-031', 'UN-01', 2900, 500),
  ('MED-031', 'UN-02', 1595, 300),
  ('MED-031', 'UN-03', 250, 200),
  ('MED-032', 'UN-01', 74, 60),
  ('MED-032', 'UN-03', 22, 24),
  ('MED-033', 'UN-01', 58, 30),
  ('MED-033', 'UN-02', 15, 18),
  ('MED-034', 'UN-01', 1450, 300),
  ('MED-034', 'UN-02', 798, 180),
  ('MED-034', 'UN-03', 435, 120),
  ('MED-035', 'UN-01', 0, 150),
  ('MED-035', 'UN-02', 0, 90),
  ('MED-035', 'UN-03', 0, 60),
  ('MED-036', 'UN-01', 6100, 1200),
  ('MED-037', 'UN-01', 8800, 1500),
  ('MED-037', 'UN-02', 4840, 900),
  ('MED-037', 'UN-03', 2640, 600),
  ('MED-038', 'UN-01', 5200, 1000),
  ('MED-038', 'UN-02', 2860, 600),
  ('MED-038', 'UN-03', 1560, 400),
  ('MED-039', 'UN-01', 620, 200),
  ('MED-039', 'UN-02', 100, 120),
  ('MED-040', 'UN-01', 27, 30),
  ('MED-040', 'UN-03', 0, 12),
  ('MED-041', 'UN-01', 88, 30),
  ('MED-041', 'UN-02', 48, 18),
  ('MED-041', 'UN-03', 15, 12),
  ('MED-042', 'UN-01', 430, 120),
  ('MED-042', 'UN-02', 0, 72),
  ('MED-043', 'UN-01', 2200, 500),
  ('MED-043', 'UN-02', 1210, 300),
  ('MED-043', 'UN-03', 660, 200),
  ('MED-044', 'UN-01', 3600, 800),
  ('MED-044', 'UN-03', 1080, 320),
  ('MED-045', 'UN-01', 1900, 500),
  ('MED-045', 'UN-02', 250, 300),
  ('MED-046', 'UN-01', 340, 400),
  ('MED-046', 'UN-02', 187, 240),
  ('MED-046', 'UN-03', 200, 160),
  ('MED-047', 'UN-01', 0, 300),
  ('MED-047', 'UN-02', 0, 180),
  ('MED-047', 'UN-03', 0, 120),
  ('MED-048', 'UN-01', 1100, 300);

insert into public.sinonimos (codigo, termo, termo_norm) values
  ('MED-001', 'dipirona', 'dipirona'),
  ('MED-001', 'novalgina', 'novalgina'),
  ('MED-001', 'anador', 'anador'),
  ('MED-001', 'dipirona sodica', 'dipirona sodica'),
  ('MED-001', 'dipirona comprimido', 'dipirona comprimido'),
  ('MED-001', 'dipirona 500', 'dipirona 500'),
  ('MED-002', 'dipirona gotas', 'dipirona gotas'),
  ('MED-002', 'novalgina gotas', 'novalgina gotas'),
  ('MED-002', 'dipirona liquida', 'dipirona liquida'),
  ('MED-002', 'dipirona crianca', 'dipirona crianca'),
  ('MED-002', 'dipirona infantil', 'dipirona infantil'),
  ('MED-002', 'dipirona bebe', 'dipirona bebe'),
  ('MED-002', 'dipirona', 'dipirona'),
  ('MED-002', 'novalgina', 'novalgina'),
  ('MED-003', 'paracetamol', 'paracetamol'),
  ('MED-003', 'tylenol', 'tylenol'),
  ('MED-003', 'paracetamol 500', 'paracetamol 500'),
  ('MED-004', 'paracetamol gotas', 'paracetamol gotas'),
  ('MED-004', 'tylenol bebe', 'tylenol bebe'),
  ('MED-004', 'paracetamol', 'paracetamol'),
  ('MED-004', 'tylenol', 'tylenol'),
  ('MED-005', 'ibuprofeno', 'ibuprofeno'),
  ('MED-005', 'alivium', 'alivium'),
  ('MED-005', 'advil', 'advil'),
  ('MED-005', 'ibuprofeno 300', 'ibuprofeno 300'),
  ('MED-006', 'amoxicilina', 'amoxicilina'),
  ('MED-006', 'amoxilina', 'amoxilina'),
  ('MED-006', 'amoxil', 'amoxil'),
  ('MED-007', 'amoxicilina suspensao', 'amoxicilina suspensao'),
  ('MED-007', 'amoxicilina infantil', 'amoxicilina infantil'),
  ('MED-007', 'amoxicilina xarope', 'amoxicilina xarope'),
  ('MED-007', 'amoxicilina', 'amoxicilina'),
  ('MED-007', 'amoxil', 'amoxil'),
  ('MED-008', 'azitromicina', 'azitromicina'),
  ('MED-008', 'zitromax', 'zitromax'),
  ('MED-008', 'azitromicina 500', 'azitromicina 500'),
  ('MED-009', 'cefalexina', 'cefalexina'),
  ('MED-009', 'keflex', 'keflex'),
  ('MED-010', 'bactrim', 'bactrim'),
  ('MED-010', 'sulfametoxazol', 'sulfametoxazol'),
  ('MED-010', 'sulfa', 'sulfa'),
  ('MED-010', 'smz tmp', 'smz tmp'),
  ('MED-011', 'metronidazol', 'metronidazol'),
  ('MED-011', 'flagyl', 'flagyl'),
  ('MED-012', 'fluconazol', 'fluconazol'),
  ('MED-012', 'zoltec', 'zoltec'),
  ('MED-013', 'metformina', 'metformina'),
  ('MED-013', 'glifage', 'glifage'),
  ('MED-013', 'metiformina', 'metiformina'),
  ('MED-013', 'remedio de diabetes', 'remedio de diabetes'),
  ('MED-014', 'glibenclamida', 'glibenclamida'),
  ('MED-014', 'daonil', 'daonil'),
  ('MED-015', 'insulina nph', 'insulina nph'),
  ('MED-015', 'insulina', 'insulina'),
  ('MED-015', 'insulina lenta', 'insulina lenta'),
  ('MED-016', 'insulina regular', 'insulina regular'),
  ('MED-016', 'insulina rapida', 'insulina rapida'),
  ('MED-017', 'losartana', 'losartana'),
  ('MED-017', 'losartan', 'losartan'),
  ('MED-017', 'losartana 50', 'losartana 50'),
  ('MED-017', 'remedio de pressao', 'remedio de pressao'),
  ('MED-018', 'enalapril', 'enalapril'),
  ('MED-018', 'renitec', 'renitec'),
  ('MED-019', 'captopril', 'captopril'),
  ('MED-019', 'capoten', 'capoten'),
  ('MED-020', 'hidroclorotiazida', 'hidroclorotiazida'),
  ('MED-020', 'clorana', 'clorana'),
  ('MED-020', 'hidroclorotiazida 25', 'hidroclorotiazida 25'),
  ('MED-021', 'anlodipino', 'anlodipino'),
  ('MED-021', 'amlodipina', 'amlodipina'),
  ('MED-021', 'norvasc', 'norvasc'),
  ('MED-022', 'atenolol', 'atenolol'),
  ('MED-022', 'atenol', 'atenol'),
  ('MED-023', 'propranolol', 'propranolol'),
  ('MED-023', 'inderal', 'inderal'),
  ('MED-024', 'sinvastatina', 'sinvastatina'),
  ('MED-024', 'simvastatina', 'simvastatina'),
  ('MED-024', 'remedio de colesterol', 'remedio de colesterol'),
  ('MED-025', 'aas', 'aas'),
  ('MED-025', 'aspirina', 'aspirina'),
  ('MED-025', 'acido acetilsalicilico', 'acido acetilsalicilico'),
  ('MED-025', 'aas infantil', 'aas infantil'),
  ('MED-026', 'omeprazol', 'omeprazol'),
  ('MED-026', 'omeprasol', 'omeprasol'),
  ('MED-026', 'remedio de gastrite', 'remedio de gastrite'),
  ('MED-027', 'metoclopramida', 'metoclopramida'),
  ('MED-027', 'plasil', 'plasil'),
  ('MED-028', 'prednisona', 'prednisona'),
  ('MED-028', 'meticorten', 'meticorten'),
  ('MED-029', 'prednisolona', 'prednisolona'),
  ('MED-029', 'predsim', 'predsim'),
  ('MED-029', 'corticoide infantil', 'corticoide infantil'),
  ('MED-030', 'dexametasona creme', 'dexametasona creme'),
  ('MED-030', 'pomada de dexametasona', 'pomada de dexametasona'),
  ('MED-031', 'loratadina', 'loratadina'),
  ('MED-031', 'claritin', 'claritin'),
  ('MED-031', 'remedio de alergia', 'remedio de alergia'),
  ('MED-032', 'salbutamol', 'salbutamol'),
  ('MED-032', 'aerolin', 'aerolin'),
  ('MED-032', 'bombinha', 'bombinha'),
  ('MED-033', 'beclometasona', 'beclometasona'),
  ('MED-033', 'clenil', 'clenil'),
  ('MED-034', 'albendazol', 'albendazol'),
  ('MED-034', 'zentel', 'zentel'),
  ('MED-034', 'remedio de verme', 'remedio de verme'),
  ('MED-035', 'ivermectina', 'ivermectina'),
  ('MED-035', 'revectina', 'revectina'),
  ('MED-036', 'levotiroxina', 'levotiroxina'),
  ('MED-036', 'puran t4', 'puran t4'),
  ('MED-036', 'euthyrox', 'euthyrox'),
  ('MED-036', 'remedio de tireoide', 'remedio de tireoide'),
  ('MED-037', 'sulfato ferroso', 'sulfato ferroso'),
  ('MED-037', 'ferro', 'ferro'),
  ('MED-037', 'remedio de anemia', 'remedio de anemia'),
  ('MED-038', 'acido folico', 'acido folico'),
  ('MED-038', 'folico', 'folico'),
  ('MED-039', 'soro de reidratacao', 'soro de reidratacao'),
  ('MED-039', 'sro', 'sro'),
  ('MED-039', 'sal de reidratacao', 'sal de reidratacao'),
  ('MED-040', 'nistatina', 'nistatina'),
  ('MED-040', 'micostatin', 'micostatin'),
  ('MED-041', 'permetrina', 'permetrina'),
  ('MED-041', 'remedio de piolho', 'remedio de piolho'),
  ('MED-041', 'nedax', 'nedax'),
  ('MED-042', 'anticoncepcional', 'anticoncepcional'),
  ('MED-042', 'ciclo 21', 'ciclo 21'),
  ('MED-042', 'microvlar', 'microvlar'),
  ('MED-042', 'pilula', 'pilula'),
  ('MED-043', 'amitriptilina', 'amitriptilina'),
  ('MED-043', 'amytril', 'amytril'),
  ('MED-044', 'fluoxetina', 'fluoxetina'),
  ('MED-044', 'prozac', 'prozac'),
  ('MED-045', 'carbamazepina', 'carbamazepina'),
  ('MED-045', 'tegretol', 'tegretol'),
  ('MED-046', 'clonazepam', 'clonazepam'),
  ('MED-046', 'rivotril', 'rivotril'),
  ('MED-047', 'diazepam', 'diazepam'),
  ('MED-047', 'valium', 'valium'),
  ('MED-048', 'fenitoina', 'fenitoina'),
  ('MED-048', 'hidantal', 'hidantal')
on conflict (codigo, termo_norm) do nothing;

commit;
