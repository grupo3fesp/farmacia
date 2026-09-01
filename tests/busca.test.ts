import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RepositorioLocal } from '../src/dados/local.ts';

const repo = new RepositorioLocal();

test('catálogo: 48 medicamentos, cada um com pelo menos uma unidade', async () => {
  const itens = await repo.listarEstoque();
  const codigos = new Set(itens.map((i) => i.codigo));
  assert.equal(codigos.size, 48);
});

test('seed: distribuição de situações por unidade', async () => {
  const itens = await repo.listarEstoque();
  assert.equal(itens.length, 116);
  const cont = itens.reduce<Record<string, number>>((a, m) => {
    a[m.situacao] = (a[m.situacao] ?? 0) + 1;
    return a;
  }, {});
  assert.equal(cont['DISPONIVEL'], 73);
  assert.equal(cont['EM FALTA'], 23);
  assert.equal(cont['ESTOQUE BAIXO'], 20);
});

test('zitromax: reconhece Azitromicina (catálogo) e tem unidade em falta', async () => {
  const r = await repo.buscar('zitromax');
  assert.equal(r[0].codigo, 'MED-008');
  assert.equal(r[0].principio_ativo, 'Azitromicina');
  const est = await repo.estoquePorCodigo('MED-008');
  assert.ok(est.some((e) => e.situacao === 'EM FALTA'));
});

test('metiformina → Metformina; bombinha → Salbutamol; omeprasol → Omeprazol', async () => {
  assert.equal((await repo.buscar('metiformina 850'))[0].codigo, 'MED-013');
  assert.equal((await repo.buscar('bombinha'))[0].codigo, 'MED-032');
  assert.equal((await repo.buscar('omeprasol'))[0].codigo, 'MED-026');
});

test('genéricos empatam apresentações (desambiguação por catálogo)', async () => {
  for (const [termo, pares] of [
    ['dipirona', ['MED-001', 'MED-002']],
    ['paracetamol', ['MED-003', 'MED-004']],
    ['amoxicilina', ['MED-006', 'MED-007']],
  ] as const) {
    const r = await repo.buscar(termo);
    const topo = r.filter((x) => x.semelhanca === r[0].semelhanca).map((x) => x.codigo).sort();
    assert.deepEqual(topo, pares, `${termo}`);
  }
});

test('"dipirona gotas" vai direto na solução oral (MED-002)', async () => {
  const r = await repo.buscar('dipirona gotas');
  assert.equal(r[0].codigo, 'MED-002');
  assert.equal(r.filter((x) => x.semelhanca === r[0].semelhanca).length, 1);
});

test('xpto123: retorno vazio', async () => {
  assert.equal((await repo.buscar('xpto123')).length, 0);
});

test('estoque por unidade: dipirona (MED-001) em 3 unidades; alteração ao vivo', async () => {
  const local = new RepositorioLocal();
  let est = await local.estoquePorCodigo('MED-001');
  assert.equal(est.length, 3);
  assert.ok(est.every((e) => e.situacao === 'DISPONIVEL'));

  const ok = await local.alterarEstoque('MED-001', 'UN-01', 0);
  assert.equal(ok, true);
  est = await local.estoquePorCodigo('MED-001');
  const central = est.find((e) => e.unidade_id === 'UN-01');
  assert.equal(central?.situacao, 'EM FALTA');
});

test('alterarEstoque falha para unidade inexistente', async () => {
  const local = new RepositorioLocal();
  assert.equal(await local.alterarEstoque('MED-001', 'UN-99', 10), false);
});
