// Gera src/dados/seed.json a partir dos arquivos SQL em db/.
// O SQL e a fonte unica de verdade: nunca transcreva os dados a mao.
// Uso: node scripts/gerar-seed.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Extrai o bloco de valores de um `insert into public.<tabela> (...) values <...>;`. */
function blocoValues(sql, tabela) {
  const re = new RegExp(
    `insert\\s+into\\s+public\\.${tabela}\\s*\\([^)]*\\)\\s*values([\\s\\S]*?);`,
    'i',
  );
  const m = sql.match(re);
  if (!m) throw new Error(`INSERT de ${tabela} nao encontrado`);
  // Remove uma eventual clausula "on conflict ..." que fica antes do ';'.
  return m[1].replace(/on\s+conflict[\s\S]*$/i, '');
}

/** Divide o bloco de values em tuplas, respeitando aspas e escapes ''. */
function tuplas(bloco) {
  const linhas = [];
  let i = 0;
  const n = bloco.length;
  while (i < n) {
    if (bloco[i] !== '(') {
      i++;
      continue;
    }
    // Le uma tupla ( ... ) respeitando strings entre aspas simples.
    const campos = [];
    let campo = '';
    let emAspas = false;
    i++; // pula o '('
    for (; i < n; i++) {
      const c = bloco[i];
      if (emAspas) {
        if (c === "'") {
          if (bloco[i + 1] === "'") {
            campo += "'";
            i++;
          } else {
            emAspas = false;
          }
        } else {
          campo += c;
        }
      } else if (c === "'") {
        emAspas = true;
      } else if (c === ',') {
        campos.push(campo.trim());
        campo = '';
      } else if (c === ')') {
        campos.push(campo.trim());
        i++;
        break;
      } else {
        campo += c;
      }
    }
    linhas.push(campos);
  }
  return linhas;
}

const nulo = (v) => (v === 'null' || v === 'NULL' ? null : v);

const schemaSql = readFileSync(join(raiz, 'db', '01_schema_supabase.sql'), 'utf8');
const seedSql = readFileSync(join(raiz, 'db', '02_seed_dados_ficticios.sql'), 'utf8');

const unidades = tuplas(blocoValues(seedSql, 'unidades')).map(
  ([id, nome, endereco, horario, telefone]) => ({
    id,
    nome,
    endereco: nulo(endereco),
    horario: nulo(horario),
    telefone: nulo(telefone),
  }),
);

// Catalogo (modelo multiunidade: sem estoque na tabela medicamentos).
const medicamentos = tuplas(blocoValues(seedSql, 'medicamentos')).map((c) => {
  const [codigo, principio_ativo, apresentacao, forma_farmaceutica, componente, unidade_medida, tipo_receita] = c;
  return {
    codigo,
    principio_ativo,
    apresentacao,
    forma_farmaceutica: nulo(forma_farmaceutica),
    componente: nulo(componente),
    unidade_medida: nulo(unidade_medida),
    tipo_receita: nulo(tipo_receita),
  };
});

// Estoque por unidade.
const estoques = tuplas(blocoValues(seedSql, 'estoques')).map((c) => {
  const [codigo, unidade_id, estoque_atual, estoque_minimo] = c;
  return {
    codigo,
    unidade_id,
    estoque_atual: Number(estoque_atual),
    estoque_minimo: Number(estoque_minimo),
  };
});

const sinonimos = tuplas(blocoValues(seedSql, 'sinonimos')).map(([codigo, termo]) => ({
  codigo,
  termo,
}));

// Confere o corte de similaridade declarado no schema, so para registro.
const corte = schemaSql.match(/similarity\([^)]*\)\s*>\s*([\d.]+)/i)?.[1] ?? '0.42';

const seed = {
  _origem: 'gerado por scripts/gerar-seed.mjs a partir de db/*.sql — nao editar a mao',
  corte_similaridade: Number(corte),
  unidades,
  medicamentos,
  estoques,
  sinonimos,
};

const destino = join(raiz, 'src', 'dados', 'seed.json');
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, JSON.stringify(seed, null, 2) + '\n', 'utf8');

const contagem = estoques.reduce(
  (acc, e) => {
    const s =
      e.estoque_atual === 0
        ? 'EM FALTA'
        : e.estoque_atual <= e.estoque_minimo
          ? 'ESTOQUE BAIXO'
          : 'DISPONIVEL';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  },
  {},
);

console.log(
  `seed.json gerado: ${unidades.length} unidades, ${medicamentos.length} medicamentos, ${estoques.length} linhas de estoque, ${sinonimos.length} sinonimos`,
);
console.log('situacao (por linha de estoque):', contagem, '| corte:', seed.corte_similaridade);
