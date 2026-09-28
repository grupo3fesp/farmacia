// Gera db/00_setup_completo.sql = 05 (limpeza) + 01 (schema) + 02 (seed) + 03 (sessoes).
// Um unico arquivo para colar no SQL Editor do Supabase numa instalacao nova.
// Rode sempre que alterar qualquer um dos quatro:
//   npm run setup-sql
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const db = join(dirname(fileURLToPath(import.meta.url)), '..', 'db');
const partes = [
  '05_migracao_multiunidade.sql',
  '01_schema_supabase.sql',
  '02_seed_dados_ficticios.sql',
  '03_sessoes.sql',
];

const cabecalho = [
  '-- =====================================================================',
  '-- SETUP COMPLETO - Assistente Virtual da Farmacia Municipal',
  '-- GERADO por scripts/gerar-setup-completo.mjs (npm run setup-sql).',
  '-- NAO editar a mao: edite os arquivos de origem e gere de novo.',
  '-- Cole TUDO no SQL Editor do Supabase e clique em RUN.',
  `-- Conteudo: ${partes.join(' + ')}`,
  '-- =====================================================================',
  '',
].join('\n');

const corpo = partes
  .map((p) => `-- >>>>> ${p}\n\n${readFileSync(join(db, p), 'utf8').trim()}\n`)
  .join('\n');

writeFileSync(join(db, '00_setup_completo.sql'), cabecalho + corpo, 'utf8');
console.log(`db/00_setup_completo.sql gerado a partir de: ${partes.join(', ')}`);
