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

/** Distribuicao por unidade a partir do estoque original (UN-01). */
function estoquesDe(m, i) {
  const base = m.estoque_atual;
  const min = m.estoque_minimo;
  const linhas = [['UN-01', base, min]]; // Central: sempre, valores originais

  // Bairro Novo (UN-02): ~75% dos itens.
  if (i % 4 !== 0) {
    let e;
    if (i % 6 === 0) e = 0; // em falta
    else if (i % 6 === 3) e = Math.round(min * 0.5); // estoque baixo
    else e = Math.round(base * 0.55);
    linhas.push(['UN-02', e, Math.max(1, Math.round(min * 0.6))]);
  }
  // Vila Esperança (UN-03): ~67% dos itens.
  if (i % 3 !== 0) {
    let e;
    if (i % 5 === 0) e = 0; // em falta
    else if (i % 5 === 1) e = Math.round(min * 0.5); // estoque baixo
    else e = Math.round(base * 0.3);
    linhas.push(['UN-03', e, Math.max(1, Math.round(min * 0.4))]);
  }
  return linhas;
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

// Estoques por unidade
const linhasEstoque = [];
seed.medicamentos.forEach((m, idx) => {
  for (const [uni, est, min] of estoquesDe(m, idx + 1)) {
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
