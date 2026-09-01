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
