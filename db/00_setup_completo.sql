-- =====================================================================
-- SETUP COMPLETO — Assistente Virtual da Farmácia Municipal (protótipo)
-- Gerado de 01_schema_supabase.sql + 02_seed_dados_ficticios.sql
-- Cole tudo no SQL Editor do Supabase e clique em RUN (executa de uma vez).
-- =====================================================================

-- =====================================================================
-- Assistente Virtual Inteligente - Farmacia Municipal
-- Programa Aperfeicoando a Gestao Publica
-- Schema Supabase (PostgreSQL) para o prototipo
-- Executar no SQL Editor do Supabase, na ordem: este arquivo, depois o seed.
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
  'Unidades dispensadoras. No prototipo, dados ficticios.';

create table if not exists public.medicamentos (
  codigo             text primary key,
  principio_ativo    text not null,
  apresentacao       text not null,
  forma_farmaceutica text,
  componente         text,
  unidade_medida     text,
  estoque_atual      integer not null default 0 check (estoque_atual >= 0),
  estoque_minimo     integer not null default 0 check (estoque_minimo >= 0),
  tipo_receita       text,
  unidade_id         text references public.unidades (id),
  atualizado_em      timestamptz not null default now(),
  -- A situacao e derivada do estoque: nao pode ser gravada a mao,
  -- o que impede divergencia entre o numero e a resposta ao cidadao.
  situacao text generated always as (
    case
      when estoque_atual = 0                then 'EM FALTA'
      when estoque_atual <= estoque_minimo  then 'ESTOQUE BAIXO'
      else 'DISPONIVEL'
    end
  ) stored
);

comment on table public.medicamentos is
  'Posicao de estoque. No prototipo, quantitativos ficticios para demonstracao.';

create table if not exists public.sinonimos (
  id         bigint generated always as identity primary key,
  codigo     text not null references public.medicamentos (codigo) on delete cascade,
  termo      text not null,
  termo_norm text not null,
  unique (codigo, termo_norm)
);

comment on table public.sinonimos is
  'Nomes comerciais, apelidos populares e erros de digitacao mapeados ao medicamento.';

-- Log de consultas: sem qualquer dado pessoal ou de saude do cidadao.
-- O identificador da sessao deve chegar aqui ja anonimizado (hash).
create table if not exists public.consultas_log (
  id                   bigint generated always as identity primary key,
  sessao_hash          text,
  termo_digitado       text,
  codigo_encontrado    text,
  situacao_retornada   text,
  encaminhado_humano   boolean not null default false,
  motivo_encaminhamento text,
  criado_em            timestamptz not null default now()
);

comment on table public.consultas_log is
  'Registro anonimo de atendimentos, base dos indicadores do piloto (LGPD: sem dado pessoal).';

-- ---------------------------------------------------------------------
-- 3. Indices
-- ---------------------------------------------------------------------
create index if not exists idx_sinonimos_termo_norm
  on public.sinonimos using gin (termo_norm extensions.gin_trgm_ops);

create index if not exists idx_sinonimos_codigo
  on public.sinonimos (codigo);

create index if not exists idx_medicamentos_principio
  on public.medicamentos using gin (principio_ativo extensions.gin_trgm_ops);

create index if not exists idx_log_criado_em
  on public.consultas_log (criado_em desc);

-- ---------------------------------------------------------------------
-- 4. Gatilhos
-- ---------------------------------------------------------------------

-- Normaliza o termo automaticamente (minusculas, sem acento).
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

-- Carimba a data e hora sempre que o estoque muda.
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

drop trigger if exists trg_carimba_atualizacao on public.medicamentos;
create trigger trg_carimba_atualizacao
  before update on public.medicamentos
  for each row execute function public.fn_carimba_atualizacao();

-- ---------------------------------------------------------------------
-- 5. Funcao de busca
--    Estrategia em tres niveis: termo exato -> principio ativo -> aproximado.
--    Se nada for encontrado, retorna vazio e a aplicacao responde com a
--    mensagem padrao, SEM acionar o modelo de linguagem.
-- ---------------------------------------------------------------------
create or replace function public.buscar_medicamento(
  p_termo text,
  p_limite integer default 5
)
returns table (
  codigo          text,
  principio_ativo text,
  apresentacao    text,
  forma_farmaceutica text,
  unidade_medida  text,
  estoque_atual   integer,
  situacao        text,
  tipo_receita    text,
  unidade_nome    text,
  atualizado_em   timestamptz,
  origem          text,
  semelhanca      real
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
    -- Nivel 1: correspondencia exata no dicionario de sinonimos
    select s.codigo, 'sinonimo_exato'::text as origem, 1.0::real as semelhanca
      from public.sinonimos s, entrada e
     where s.termo_norm = e.t

    union all

    -- Nivel 2: o proprio principio ativo
    select m.codigo, 'principio_ativo'::text, 0.95::real
      from public.medicamentos m, entrada e
     where lower(extensions.unaccent(m.principio_ativo)) = e.t

    union all

    -- Nivel 3: aproximado, tolera erro de digitacao
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
         m.unidade_medida, m.estoque_atual, m.situacao, m.tipo_receita,
         u.nome, m.atualizado_em, b.origem, b.semelhanca
    from melhor b
    join public.medicamentos m on m.codigo = b.codigo
    left join public.unidades u on u.id = m.unidade_id
   order by b.semelhanca desc, m.principio_ativo
   limit p_limite;
$$;

comment on function public.buscar_medicamento is
  'Busca usada pelo assistente. A IA redige a resposta apenas a partir do que esta funcao retorna.';

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
select codigo_encontrado as codigo,
       count(*)          as consultas
  from public.consultas_log
 where codigo_encontrado is not null
 group by codigo_encontrado
 order by consultas desc;

-- ---------------------------------------------------------------------
-- 7. Seguranca (RLS)
--    O prototipo consulta com a chave anon, exposta no navegador.
--    Por isso: leitura liberada, escrita bloqueada. A unica escrita
--    permitida e a insercao no log anonimo de consultas.
--    A chave service_role NUNCA deve ficar no codigo do simulador.
-- ---------------------------------------------------------------------
alter table public.medicamentos  enable row level security;
alter table public.sinonimos     enable row level security;
alter table public.unidades      enable row level security;
alter table public.consultas_log enable row level security;

drop policy if exists p_medicamentos_leitura on public.medicamentos;
create policy p_medicamentos_leitura on public.medicamentos
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

-- Log nao e legivel pela chave anon: so pelo painel do Supabase
-- ou por uma chave de servico da equipe.

-- ---------------------------------------------------------------------
-- 8. Consultas uteis na apresentacao
-- ---------------------------------------------------------------------
-- select * from public.buscar_medicamento('novalgina');
-- select * from public.buscar_medicamento('metiformina');   -- erro de digitacao
-- select * from public.buscar_medicamento('bombinha');
-- update public.medicamentos set estoque_atual = 0 where codigo = 'MED-001';  -- demo ao vivo
-- select * from public.vw_indicadores;

-- =====================================================================
-- SEED (dados fictícios)
-- =====================================================================

-- Seed da base FICTICIA do prototipo - Assistente Virtual da Farmacia Municipal
-- Quantitativos simulados. Nao representam estoque real de nenhuma farmacia.

begin;

truncate table public.sinonimos, public.medicamentos, public.unidades restart identity cascade;

insert into public.unidades (id, nome, endereco, horario, telefone) values
  ('UN-01', 'Farmácia Municipal Central', 'Rua das Flores, 100 - Centro', 'Segunda a sexta, 7h às 17h', '(00) 0000-0001'),
  ('UN-02', 'Farmácia da UBS Bairro Novo', 'Av. Principal, 500 - Bairro Novo', 'Segunda a sexta, 7h às 16h', '(00) 0000-0002'),
  ('UN-03', 'Farmácia da UBS Vila Esperança', 'Rua São João, 25 - Vila Esperança', 'Segunda a sexta, 8h às 16h', '(00) 0000-0003');

insert into public.medicamentos (codigo, principio_ativo, apresentacao, forma_farmaceutica, componente, unidade_medida, estoque_atual, estoque_minimo, tipo_receita, unidade_id) values
  ('MED-001', 'Dipirona sódica', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 4820, 800, 'Receita simples', 'UN-01'),
  ('MED-002', 'Dipirona sódica', '500 mg/mL solução oral 10 mL', 'Solução oral', 'Básico', 'Frasco', 0, 60, 'Receita simples', 'UN-01'),
  ('MED-003', 'Paracetamol', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 3150, 700, 'Receita simples', 'UN-01'),
  ('MED-004', 'Paracetamol', '200 mg/mL solução oral 15 mL', 'Solução oral', 'Básico', 'Frasco', 42, 50, 'Receita simples', 'UN-01'),
  ('MED-005', 'Ibuprofeno', '300 mg', 'Comprimido', 'Básico', 'Comprimido', 1240, 400, 'Receita simples', 'UN-01'),
  ('MED-006', 'Amoxicilina', '500 mg', 'Cápsula', 'Básico', 'Cápsula', 2600, 600, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-007', 'Amoxicilina', '50 mg/mL pó para suspensão oral 60 mL', 'Suspensão oral', 'Básico', 'Frasco', 18, 30, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-008', 'Azitromicina', '500 mg', 'Comprimido', 'Básico', 'Comprimido', 0, 200, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-009', 'Cefalexina', '500 mg', 'Cápsula', 'Básico', 'Cápsula', 940, 250, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-010', 'Sulfametoxazol + Trimetoprima', '400 mg + 80 mg', 'Comprimido', 'Básico', 'Comprimido', 1180, 300, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-011', 'Metronidazol', '250 mg', 'Comprimido', 'Básico', 'Comprimido', 760, 200, 'Receita de antimicrobiano (2 vias)', 'UN-01'),
  ('MED-012', 'Fluconazol', '150 mg', 'Cápsula', 'Básico', 'Cápsula', 210, 60, 'Receita simples', 'UN-01'),
  ('MED-013', 'Metformina', '850 mg', 'Comprimido', 'Básico', 'Comprimido', 8600, 1500, 'Receita simples', 'UN-01'),
  ('MED-014', 'Glibenclamida', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 3400, 900, 'Receita simples', 'UN-01'),
  ('MED-015', 'Insulina NPH humana', '100 UI/mL frasco 10 mL', 'Suspensão injetável', 'Básico', 'Frasco', 96, 40, 'Receita simples (rede de frio)', 'UN-01'),
  ('MED-016', 'Insulina regular humana', '100 UI/mL frasco 10 mL', 'Solução injetável', 'Básico', 'Frasco', 31, 25, 'Receita simples (rede de frio)', 'UN-01'),
  ('MED-017', 'Losartana potássica', '50 mg', 'Comprimido', 'Básico', 'Comprimido', 12400, 2000, 'Receita simples', 'UN-01'),
  ('MED-018', 'Enalapril maleato', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 5900, 1200, 'Receita simples', 'UN-01'),
  ('MED-019', 'Captopril', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 2100, 800, 'Receita simples', 'UN-01'),
  ('MED-020', 'Hidroclorotiazida', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 7300, 1200, 'Receita simples', 'UN-01'),
  ('MED-021', 'Anlodipino besilato', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 4100, 900, 'Receita simples', 'UN-01'),
  ('MED-022', 'Atenolol', '50 mg', 'Comprimido', 'Básico', 'Comprimido', 880, 900, 'Receita simples', 'UN-01'),
  ('MED-023', 'Propranolol cloridrato', '40 mg', 'Comprimido', 'Básico', 'Comprimido', 2450, 600, 'Receita simples', 'UN-01'),
  ('MED-024', 'Sinvastatina', '20 mg', 'Comprimido', 'Básico', 'Comprimido', 6800, 1500, 'Receita simples', 'UN-01'),
  ('MED-025', 'Ácido acetilsalicílico', '100 mg', 'Comprimido', 'Básico', 'Comprimido', 9200, 1500, 'Receita simples', 'UN-01'),
  ('MED-026', 'Omeprazol', '20 mg', 'Cápsula', 'Básico', 'Cápsula', 5400, 1000, 'Receita simples', 'UN-01'),
  ('MED-027', 'Metoclopramida cloridrato', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 1320, 300, 'Receita simples', 'UN-01'),
  ('MED-028', 'Prednisona', '20 mg', 'Comprimido', 'Básico', 'Comprimido', 640, 200, 'Receita simples', 'UN-01'),
  ('MED-029', 'Prednisolona fosfato sódico', '3 mg/mL solução oral 60 mL', 'Solução oral', 'Básico', 'Frasco', 0, 40, 'Receita simples', 'UN-01'),
  ('MED-030', 'Dexametasona', '0,1% creme 10 g', 'Creme dermatológico', 'Básico', 'Bisnaga', 155, 40, 'Receita simples', 'UN-01'),
  ('MED-031', 'Loratadina', '10 mg', 'Comprimido', 'Básico', 'Comprimido', 2900, 500, 'Receita simples', 'UN-01'),
  ('MED-032', 'Salbutamol sulfato', '100 mcg/dose aerossol', 'Aerossol oral', 'Básico', 'Frasco', 74, 60, 'Receita simples', 'UN-01'),
  ('MED-033', 'Beclometasona dipropionato', '250 mcg/dose aerossol', 'Aerossol oral', 'Básico', 'Frasco', 58, 30, 'Receita simples', 'UN-01'),
  ('MED-034', 'Albendazol', '400 mg', 'Comprimido mastigável', 'Básico', 'Comprimido', 1450, 300, 'Receita simples', 'UN-01'),
  ('MED-035', 'Ivermectina', '6 mg', 'Comprimido', 'Básico', 'Comprimido', 0, 150, 'Receita simples', 'UN-01'),
  ('MED-036', 'Levotiroxina sódica', '50 mcg', 'Comprimido', 'Básico', 'Comprimido', 6100, 1200, 'Receita simples', 'UN-01'),
  ('MED-037', 'Sulfato ferroso', '40 mg de ferro elementar', 'Comprimido', 'Básico', 'Comprimido', 8800, 1500, 'Receita simples', 'UN-01'),
  ('MED-038', 'Ácido fólico', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 5200, 1000, 'Receita simples', 'UN-01'),
  ('MED-039', 'Sais para reidratação oral', 'envelope 27,9 g', 'Pó para solução oral', 'Estratégico', 'Envelope', 620, 200, 'Não exige receita', 'UN-01'),
  ('MED-040', 'Nistatina', '100.000 UI/mL suspensão oral 50 mL', 'Suspensão oral', 'Básico', 'Frasco', 27, 30, 'Receita simples', 'UN-01'),
  ('MED-041', 'Permetrina', '5% loção 60 mL', 'Loção', 'Básico', 'Frasco', 88, 30, 'Receita simples', 'UN-01'),
  ('MED-042', 'Etinilestradiol + Levonorgestrel', '0,03 mg + 0,15 mg', 'Comprimido', 'Básico', 'Cartela', 430, 120, 'Receita simples', 'UN-01'),
  ('MED-043', 'Amitriptilina cloridrato', '25 mg', 'Comprimido', 'Básico', 'Comprimido', 2200, 500, 'Receita de controle especial (C1)', 'UN-01'),
  ('MED-044', 'Fluoxetina cloridrato', '20 mg', 'Cápsula', 'Básico', 'Cápsula', 3600, 800, 'Receita de controle especial (C1)', 'UN-01'),
  ('MED-045', 'Carbamazepina', '200 mg', 'Comprimido', 'Básico', 'Comprimido', 1900, 500, 'Receita de controle especial (C1)', 'UN-01'),
  ('MED-046', 'Clonazepam', '2 mg', 'Comprimido', 'Básico', 'Comprimido', 340, 400, 'Notificação de receita B (azul)', 'UN-01'),
  ('MED-047', 'Diazepam', '5 mg', 'Comprimido', 'Básico', 'Comprimido', 0, 300, 'Notificação de receita B (azul)', 'UN-01'),
  ('MED-048', 'Fenitoína sódica', '100 mg', 'Comprimido', 'Básico', 'Comprimido', 1100, 300, 'Receita de controle especial (C1)', 'UN-01');

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
  ('MED-003', 'paracetamol', 'paracetamol'),
  ('MED-003', 'tylenol', 'tylenol'),
  ('MED-003', 'paracetamol 500', 'paracetamol 500'),
  ('MED-004', 'paracetamol gotas', 'paracetamol gotas'),
  ('MED-004', 'tylenol bebe', 'tylenol bebe'),
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