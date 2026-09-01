// Gera o NOVO db/02_seed_dados_ficticios.sql (modelo multiunidade) a partir do
// seed atual (src/dados/seed.json). Distribui o estoque de cada medicamento
// entre as 3 unidades, de forma deterministica (reprodutivel), com variedade
// de situacoes (disponivel / baixo / em falta) e cobertura por unidade.
//   node scripts/gerar-multiunidade.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(raiz, 'src', 'dados', 'seed.json'), 'utf8'));

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

/** Estoque nas 3 unidades. TODO medicamento existe em TODAS as unidades; onde
 *  a unidade "nao oferta", o estoque fica 0 (em falta). */
function estoquesDe(m, i) {
  const base = m.estoque_atual;
  const min = m.estoque_minimo;

  // Bairro Novo (UN-02): ~75% ofertam; os demais ficam zerados.
  let e2 = 0;
  if (i % 4 !== 0) {
    if (i % 6 === 0) e2 = 0;
    else if (i % 6 === 3) e2 = Math.round(min * 0.5); // baixo
    else e2 = Math.round(base * 0.55);
  }
  // Vila Esperança (UN-03): ~67% ofertam; os demais ficam zerados.
  let e3 = 0;
  if (i % 3 !== 0) {
    if (i % 5 === 0) e3 = 0;
    else if (i % 5 === 1) e3 = Math.round(min * 0.5); // baixo
    else e3 = Math.round(base * 0.3);
  }

  return [
    ['UN-01', base, min], // Central: valores originais
    ['UN-02', e2, Math.max(1, Math.round(min * 0.6))],
    ['UN-03', e3, Math.max(1, Math.round(min * 0.4))],
  ];
}

const out = [];
out.push('-- Seed da base FICTICIA - MODELO MULTIUNIDADE (estoque por unidade).');
out.push('-- Quantitativos simulados. Gerado por scripts/gerar-multiunidade.mjs.');
out.push('');
out.push('begin;');
out.push('');
out.push('truncate table public.estoques, public.sinonimos, public.medicamentos, public.unidades restart identity cascade;');
out.push('');

// Unidades
out.push('insert into public.unidades (id, nome, endereco, horario, telefone) values');
out.push(
  seed.unidades
    .map((u) => `  (${q(u.id)}, ${q(u.nome)}, ${q(u.endereco)}, ${q(u.horario)}, ${q(u.telefone)})`)
    .join(',\n') + ';',
);
out.push('');

// Catalogo de medicamentos (sem estoque)
out.push(
  'insert into public.medicamentos (codigo, principio_ativo, apresentacao, forma_farmaceutica, componente, unidade_medida, tipo_receita) values',
);
out.push(
  seed.medicamentos
    .map(
      (m) =>
        `  (${q(m.codigo)}, ${q(m.principio_ativo)}, ${q(m.apresentacao)}, ${q(m.forma_farmaceutica)}, ${q(m.componente)}, ${q(m.unidade_medida)}, ${q(m.tipo_receita)})`,
    )
    .join(',\n') + ';',
);
out.push('');

// Base (UN-01) a partir do seed atual (tabela estoques).
const baseUN01 = new Map(
  (seed.estoques ?? []).filter((e) => e.unidade_id === 'UN-01').map((e) => [e.codigo, e]),
);
// Estoques por unidade (todas as 3, sempre)
const linhasEstoque = [];
seed.medicamentos.forEach((m, idx) => {
  const base = baseUN01.get(m.codigo) ?? { estoque_atual: 0, estoque_minimo: 0 };
  for (const [uni, est, min] of estoquesDe(base, idx + 1)) {
    linhasEstoque.push(`  (${q(m.codigo)}, ${q(uni)}, ${est}, ${min})`);
  }
});
out.push('insert into public.estoques (codigo, unidade_id, estoque_atual, estoque_minimo) values');
out.push(linhasEstoque.join(',\n') + ';');
out.push('');

// Sinonimos
out.push('insert into public.sinonimos (codigo, termo, termo_norm) values');
out.push(
  seed.sinonimos.map((s) => `  (${q(s.codigo)}, ${q(s.termo)}, ${q(s.termo)})`).join(',\n') +
    '\non conflict (codigo, termo_norm) do nothing;',
);
out.push('');
out.push('commit;');
out.push('');

writeFileSync(join(raiz, 'db', '02_seed_dados_ficticios.sql'), out.join('\n'), 'utf8');

// Resumo
const porUni = {};
linhasEstoque.forEach(() => {});
console.log(
  `seed multiunidade gerado: ${seed.unidades.length} unidades, ${seed.medicamentos.length} medicamentos, ${linhasEstoque.length} linhas de estoque, ${seed.sinonimos.length} sinonimos`,
);
