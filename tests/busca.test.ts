import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RepositorioLocal } from '../src/dados/local.ts';

const repo = new RepositorioLocal();

test('seed: contagem de situações confere com o passo a passo', async () => {
  const itens = await repo.listarEstoque();
  assert.equal(itens.length, 48);
  const cont = itens.reduce<Record<string, number>>((a, m) => {
    a[m.situacao] = (a[m.situacao] ?? 0) + 1;
    return a;
  }, {});
  assert.equal(cont['DISPONIVEL'], 38);
  assert.equal(cont['ESTOQUE BAIXO'], 5);
  assert.equal(cont['EM FALTA'], 5);
});

test('dipirona genérica: duas apresentações empatadas (dispara desambiguação)', async () => {
  const r = await repo.buscar('dipirona');
  const topo = r.filter((x) => x.semelhanca === r[0].semelhanca);
  assert.equal(topo.length, 2, 'deveria empatar comprimido + solução oral');
  const codigos = topo.map((x) => x.codigo).sort();
  assert.deepEqual(codigos, ['MED-001', 'MED-002']);
  assert.ok(topo.every((x) => x.principio_ativo === 'Dipirona sódica'));
});

test('paracetamol e amoxicilina genéricos também empatam', async () => {
  for (const [termo, pares] of [
    ['paracetamol', ['MED-003', 'MED-004']],
    ['amoxicilina', ['MED-006', 'MED-007']],
  ] as const) {
    const r = await repo.buscar(termo);
    const topo = r.filter((x) => x.semelhanca === r[0].semelhanca).map((x) => x.codigo).sort();
    assert.deepEqual(topo, pares, `${termo} deveria empatar ${pares.join(' e ')}`);
  }
});

test('zitromax: reconhece Azitromicina e informa EM FALTA', async () => {
  const r = await repo.buscar('zitromax');
  assert.equal(r[0].codigo, 'MED-008');
  assert.equal(r[0].principio_ativo, 'Azitromicina');
  assert.equal(r[0].situacao, 'EM FALTA');
});

test('metiformina: reconhece Metformina', async () => {
  const r = await repo.buscar('metiformina 850');
  assert.equal(r[0].codigo, 'MED-013');
  assert.equal(r[0].principio_ativo, 'Metformina');
});

test('bombinha: reconhece Salbutamol', async () => {
  const r = await repo.buscar('bombinha');
  assert.equal(r[0].codigo, 'MED-032');
  assert.equal(r[0].principio_ativo, 'Salbutamol sulfato');
});

test('omeprasol: tolera erro de digitação', async () => {
  const r = await repo.buscar('omeprasol');
  assert.equal(r[0].codigo, 'MED-026');
  assert.equal(r[0].principio_ativo, 'Omeprazol');
});

test('paracetamol gotas: estoque baixo', async () => {
  const r = await repo.buscar('paracetamol gotas');
  assert.equal(r[0].codigo, 'MED-004');
  assert.equal(r[0].situacao, 'ESTOQUE BAIXO');
});

test('xpto123: retorno vazio (aciona mensagem padrão, sem IA)', async () => {
  const r = await repo.buscar('xpto123');
  assert.equal(r.length, 0);
});

test('"dipirona pra criança" roteia para a solução oral (MED-002)', async () => {
  const r = await repo.buscar('dipirona pra criança');
  assert.equal(r[0].codigo, 'MED-002');
  assert.equal(r[0].forma_farmaceutica, 'Solução oral');
});

test('"dipirona gotas" vai direto na solução oral (MED-002), sem desambiguar', async () => {
  const r = await repo.buscar('dipirona gotas');
  assert.equal(r[0].codigo, 'MED-002');
  const topo = r.filter((x) => x.semelhanca === r[0].semelhanca);
  assert.equal(topo.length, 1);
});

test('alteração ao vivo: zerar MED-001 muda a situação', async () => {
  const local = new RepositorioLocal();
  let r = await local.buscar('dipirona');
  assert.equal(r[0].situacao, 'DISPONIVEL');
  local.alterarEstoque('MED-001', 0);
  r = await local.buscar('dipirona');
  assert.equal(r[0].situacao, 'EM FALTA');
});
