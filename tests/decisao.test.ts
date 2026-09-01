import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectarIntencao, decidirPorResultados } from '../src/dominio/decisao.ts';
import { MSG } from '../src/dominio/mensagens.ts';
import { registro } from './ajuda.ts';

test('detectarIntencao: ATENDENTE encaminha', () => {
  assert.equal(detectarIntencao('ATENDENTE'), 'atendente');
  assert.equal(detectarIntencao('quero falar com alguém'), 'atendente');
});

test('detectarIntencao: pergunta clínica é recusada', () => {
  assert.equal(detectarIntencao('posso tomar dipirona com o remédio de pressão?'), 'clinica');
  assert.equal(detectarIntencao('qual a dose de amoxicilina?'), 'clinica');
  assert.equal(detectarIntencao('para que serve o omeprazol?'), 'clinica');
});

test('detectarIntencao: consulta comum não é clínica', () => {
  assert.equal(detectarIntencao('tem dipirona?'), 'consulta');
  assert.equal(detectarIntencao('vocês têm zitromax'), 'consulta');
});

test('detectarIntencao: saudações, agradecimentos e despedidas', () => {
  for (const s of ['olá', 'oi', 'Bom dia', 'boa noite!', 'tudo bem?']) {
    assert.equal(detectarIntencao(s), 'saudacao', `"${s}" deveria ser saudacao`);
  }
  assert.equal(detectarIntencao('obrigado'), 'agradecimento');
  assert.equal(detectarIntencao('valeu!'), 'agradecimento');
  assert.equal(detectarIntencao('tchau'), 'despedida');
  assert.equal(detectarIntencao('até logo'), 'despedida');
});

test('detectarIntencao: saudação junto com remédio ainda é consulta', () => {
  // Só a mensagem puramente social vira saudacao; com medicamento vai à busca.
  assert.equal(detectarIntencao('bom dia, tem dipirona?'), 'consulta');
});

test('decisão 1: falha técnica → texto fixo, sem IA', () => {
  const d = decidirPorResultados([], true);
  assert.equal(d.tipo, 'texto_fixo');
  if (d.tipo === 'texto_fixo') {
    assert.equal(d.texto, MSG.FALHA_CONSULTA);
    assert.equal(d.motivoEncaminhamento, 'falha_consulta');
  }
});

test('decisão 2: nada encontrado → não reconhecido, sem IA', () => {
  const d = decidirPorResultados([], false);
  assert.equal(d.tipo, 'texto_fixo');
  if (d.tipo === 'texto_fixo') {
    assert.equal(d.texto, MSG.TERMO_NAO_RECONHECIDO);
    assert.equal(d.motivoEncaminhamento, 'termo_nao_reconhecido');
  }
});

test('decisão 3: empate no topo → desambiguação, sem IA', () => {
  const a = registro({ codigo: 'MED-001', apresentacao: '500 mg', semelhanca: 0.95, origem: 'principio_ativo' });
  const b = registro({ codigo: 'MED-002', apresentacao: '500 mg/mL', semelhanca: 0.95, origem: 'principio_ativo' });
  const d = decidirPorResultados([a, b], false);
  assert.equal(d.tipo, 'desambiguacao');
  if (d.tipo === 'desambiguacao') {
    assert.equal(d.opcoes.length, 2);
    assert.match(d.texto, /1 –/);
    assert.match(d.texto, /2 –/);
  }
});

test('decisão 4: registro único no topo → redigir com IA', () => {
  const a = registro({ codigo: 'MED-001', semelhanca: 1.0 });
  const b = registro({ codigo: 'MED-002', semelhanca: 0.5 });
  const d = decidirPorResultados([a, b], false);
  assert.equal(d.tipo, 'redigir_ia');
  if (d.tipo === 'redigir_ia') assert.equal(d.registro.codigo, 'MED-001');
});

test('regra de ouro: sem resultado nunca vira redigir_ia', () => {
  for (const houveErro of [true, false]) {
    const d = decidirPorResultados([], houveErro);
    assert.notEqual(d.tipo, 'redigir_ia');
  }
});
