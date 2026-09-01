-- Atualiza a função de busca: adiciona o nível de prefixo do princípio ativo
-- ("acido" -> desambiguação entre os dois Ácidos). Rode no SQL Editor.

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
    union all
    -- Nivel 4: prefixo do principio ativo ("acido" -> os dois "Ácido...").
    select m.codigo, 'aproximado'::text, 0.5::real
      from public.medicamentos m, entrada e
     where length(e.t) >= 3
       and starts_with(lower(extensions.unaccent(m.principio_ativo)), e.t)
       and lower(extensions.unaccent(m.principio_ativo)) <> e.t
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
