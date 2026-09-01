import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Atendimento } from '../src/dominio/atendimento.ts';
import { GerenciadorSessao } from '../src/dominio/sessao.ts';
import { RepositorioLocal } from '../src/dados/local.ts';

function novo(): Atendimento {
  return new Atendimento(new RepositorioLocal(), new GerenciadorSessao('teste-multi'));
}
const ultima = (m: string[]) => m[m.length - 1];

test('dois medicamentos numa mensagem → pede um por vez', async () => {
  const at = novo();
  const r = await at.processar({ remetente: 'A', texto: 'dipirona e amoxicilina', idMensagem: 'a1' });
  const msg = ultima(r.mensagens);
  assert.match(msg, /mais de um medicamento/);
  assert.match(msg, /Dipirona sódica/);
  assert.match(msg, /Amoxicilina/);
});

test('"dipirona, paracetamol" também pede um por vez', async () => {
  const at = novo();
  const r = await at.processar({ remetente: 'B', texto: 'dipirona, paracetamol', idMensagem: 'b1' });
  assert.match(ultima(r.mensagens), /mais de um medicamento/);
});

test('um medicamento genérico → desambiguação, não "um por vez"', async () => {
  const at = novo();
  const r = await at.processar({ remetente: 'C', texto: 'dipirona', idMensagem: 'c1' });
  assert.match(ultima(r.mensagens), /mais de uma opção/);
  assert.doesNotMatch(ultima(r.mensagens), /mais de um medicamento/);
});

test('nome único com "+" não vira "um por vez"', async () => {
  const at = novo();
  const r = await at.processar({
    remetente: 'D',
    texto: 'sulfametoxazol + trimetoprima',
    idMensagem: 'd1',
  });
  assert.doesNotMatch(ultima(r.mensagens), /mais de um medicamento/);
});
