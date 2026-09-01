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

// Sinonimos: os do seed + termos populares de forma farmaceutica, cadastrados
// na apresentacao CERTA (ex.: "paracetamol xarope" -> a solucao oral, nao o
// comprimido). Assim o cidadao que usa o termo informal cai na forma correta.
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const POPULARES = {
  'Solução oral': ['xarope', 'liquido'],
  'Suspensão oral': ['xarope', 'liquido', 'suspensao'],
  'Creme dermatológico': ['creme', 'pomada'],
  'Loção': ['locao', 'pomada'],
  'Aerossol oral': ['bombinha', 'spray'],
  'Suspensão injetável': ['injecao', 'ampola', 'injetavel'],
  'Solução injetável': ['injecao', 'ampola', 'injetavel'],
  'Comprimido mastigável': ['mastigavel'],
  // Prontos para quando essas formas entrarem na base (hoje nao geram nada):
  Colírio: ['colirio'],
  'Solução oftálmica': ['colirio'],
  'Pomada oftálmica': ['pomada', 'colirio'],
  Supositório: ['supositorio'],
  'Adesivo transdérmico': ['adesivo'],
};
const existentes = new Set(seed.sinonimos.map((s) => s.codigo + '|' + norm(s.termo)));

// --- Propagacao de termos GENERICOS entre apresentacoes da mesma familia ---
// Um sinonimo generico (nome/marca/erro que NAO cita forma) vale para todas as
// apresentacoes do mesmo principio ativo. Ex.: 'amoxilina' (so na capsula) passa
// a valer tambem na suspensao -> "amoxilina" desambigua, nao cai direto na capsula.
// Sinonimos que citam forma (gotas, xarope, crianca...) NAO sao propagados.
const FORMAS = new Set([
  'gotas', 'gota', 'gts', 'xarope', 'liquido', 'liquida', 'comprimido', 'comp', 'suspensao',
  'capsula', 'creme', 'pomada', 'locao', 'bombinha', 'spray', 'injecao', 'ampola', 'mastigavel',
  'solucao', 'frasco', 'crianca', 'infantil', 'bebe', 'adulto', 'sache', 'envelope', 'oral',
  'injetavel', 'sublingual', 'colirio', 'supositorio', 'adesivo', 'po', 'pediatrico', 'pediatrica',
]);
const ehGenerico = (termo) => norm(termo).split(/\s+/).every((w) => !FORMAS.has(w));

const familias = new Map(); // principio_ativo -> Set(codigos)
for (const m of seed.medicamentos) {
  if (!familias.has(m.principio_ativo)) familias.set(m.principio_ativo, new Set());
  familias.get(m.principio_ativo).add(m.codigo);
}
const propagados = [];
for (const codigos of familias.values()) {
  if (codigos.size < 2) continue;
  const genericos = new Set();
  for (const s of seed.sinonimos) {
    if (codigos.has(s.codigo) && ehGenerico(s.termo)) genericos.add(norm(s.termo));
  }
  for (const termo of genericos) {
    for (const codigo of codigos) {
      const chave = `${codigo}|${termo}`;
      if (!existentes.has(chave)) {
        propagados.push({ codigo, termo });
        existentes.add(chave);
      }
    }
  }
}

// --- Termos populares de forma farmaceutica (na apresentacao certa) ---
const populares = [];
for (const m of seed.medicamentos) {
  const pops = POPULARES[m.forma_farmaceutica];
  if (!pops) continue;
  const base = norm(m.principio_ativo).split(' ')[0];
  for (const p of pops) {
    const termo = `${base} ${p}`;
    const chave = `${m.codigo}|${termo}`;
    if (!existentes.has(chave)) {
      populares.push({ codigo: m.codigo, termo });
      existentes.add(chave);
    }
  }
}
// Erros de digitacao "pesados" que caem abaixo do corte de trigramas — casos
// conhecidos, cadastrados explicitamente.
const EXTRAS = [
  ['MED-005', 'biprofeno'], // Ibuprofeno
  ['MED-005', 'ibrufeno'],
  ['MED-008', 'astomicina'], // Azitromicina
  ['MED-018', 'nanapril'], // Enalapril
  ['MED-019', 'capotril'], // Captopril
  ['MED-021', 'andolipino'], // Anlodipino
  ['MED-029', 'predisilona'], // Prednisolona
  ['MED-047', 'jazepam'], // Diazepam
].filter(([c, t]) => !existentes.has(`${c}|${norm(t)}`));

const todosSinonimos = [
  ...seed.sinonimos,
  ...propagados,
  ...populares,
  ...EXTRAS.map(([codigo, termo]) => ({ codigo, termo })),
];

out.push('insert into public.sinonimos (codigo, termo, termo_norm) values');
out.push(
  todosSinonimos.map((s) => `  (${q(s.codigo)}, ${q(s.termo)}, ${q(norm(s.termo))})`).join(',\n') +
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
