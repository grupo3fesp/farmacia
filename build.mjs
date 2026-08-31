// Empacota cada função de functions-src/*.ts em api/<nome>.js autocontido.
// Necessário para a Vercel: em produção o Node não importa `.ts`, então o
// bundle inlina todo o código de src/ (e os SDKs) num único arquivo por função.
// O dev local não usa isto (roda src/index.ts com TypeScript nativo).
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';

const entradas = readdirSync('functions-src').filter((f) => f.endsWith('.ts'));

rmSync('api', { recursive: true, force: true });
mkdirSync('api', { recursive: true });

for (const arquivo of entradas) {
  const nome = arquivo.replace(/\.ts$/, '');
  await build({
    entryPoints: [`functions-src/${arquivo}`],
    outfile: `api/${nome}.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // splitting desligado (padrão): imports dinâmicos são inlinados, gerando um
    // único arquivo por função — nenhum chunk extra dentro de /api.
    logLevel: 'warning',
  });
  console.log(`api/${nome}.js gerado`);
}

console.log('build das funções concluído');
