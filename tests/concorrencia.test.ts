import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Atendimento } from '../src/dominio/atendimento.ts';
import { GerenciadorSessao } from '../src/dominio/sessao.ts';
import type { Repositorio, RegistroLog, Indicadores, ItemEstoque } from '../src/dados/repositorio.ts';
import type { RegistroMedicamento } from '../src/dominio/tipos.ts';
import { registro } from './ajuda.ts';

// Repositorio-stub: o termo "empate" devolve duas apresentacoes com a mesma
// semelhanca (forca a desambiguacao). Isola o que este teste verifica: que o
// estado da desambiguacao nao vaza entre sessoes.
class RepoStub implements Repositorio {
  logs: RegistroLog[] = [];
  async buscar(termo: string): Promise<RegistroMedicamento[]> {
    if (termo.toLowerCase().includes('empate')) {
      return [
        registro({ codigo: 'MED-A', principio_ativo: 'Alfazema', apresentacao: 'comprimido', semelhanca: 0.95, origem: 'principio_ativo' }),
        registro({ codigo: 'MED-B', principio_ativo: 'Betazina', apresentacao: 'solução oral', semelhanca: 0.95, origem: 'principio_ativo' }),
      ];
    }
    return [];
  }
  async registrarLog(r: RegistroLog): Promise<void> {
    this.logs.push(r);
  }
  async indicadores(): Promise<Indicadores> {
    return {
      consultas_totais: this.logs.length,
      termos_reconhecidos: 0,
      taxa_reconhecimento_pct: 0,
      encaminhamentos_humanos: 0,
      taxa_resolucao_automatica_pct: 0,
      consultas_itens_em_falta: 0,
    };
  }
  async listarEstoque(): Promise<ItemEstoque[]> {
    return [];
  }
  async alterarEstoque(): Promise<boolean> {
    return false;
  }
}

function novo() {
  const repo = new RepoStub();
  const at = new Atendimento(repo, new GerenciadorSessao('sal-teste'));
  return { repo, at };
}

const ultima = (ms: string[]) => ms[ms.length - 1];

test('dois cidadãos em desambiguação simultânea, escolhas diferentes', async () => {
  const { at } = novo();

  const pA = at.processar({ remetente: 'A', texto: 'empate', idMensagem: 'a1' });
  const pB = at.processar({ remetente: 'B', texto: 'empate', idMensagem: 'b1' });
  const [rA, rB] = await Promise.all([pA, pB]);
  assert.match(ultima(rA.mensagens), /Qual delas/);
  assert.match(ultima(rB.mensagens), /Qual delas/);

  // A escolhe 1 (Alfazema), B escolhe 2 (Betazina), em paralelo.
  const [aA, aB] = await Promise.all([
    at.processar({ remetente: 'A', texto: '1', idMensagem: 'a2' }),
    at.processar({ remetente: 'B', texto: '2', idMensagem: 'b2' }),
  ]);
  assert.match(ultima(aA.mensagens), /Alfazema/);
  assert.doesNotMatch(ultima(aA.mensagens), /Betazina/);
  assert.match(ultima(aB.mensagens), /Betazina/);
  assert.doesNotMatch(ultima(aB.mensagens), /Alfazema/);
});

test('50 consultas em paralelo, sem troca de conteúdo entre sessões', async () => {
  const { at } = novo();
  const n = 50;

  // Passo 1: todas pedem desambiguação em paralelo.
  await Promise.all(
    Array.from({ length: n }, (_, i) =>
      at.processar({ remetente: `u${i}`, texto: 'empate', idMensagem: `p${i}` }),
    ),
  );

  // Passo 2: cada um responde 1 ou 2, em paralelo. Esperado bate com a escolha.
  const respostas = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      at
        .processar({ remetente: `u${i}`, texto: String((i % 2) + 1), idMensagem: `r${i}` })
        .then((res) => ({ i, texto: ultima(res.mensagens) })),
    ),
  );

  for (const { i, texto } of respostas) {
    const esperado = i % 2 === 0 ? 'Alfazema' : 'Betazina';
    const errado = i % 2 === 0 ? 'Betazina' : 'Alfazema';
    assert.match(texto, new RegExp(esperado), `sessão u${i} deveria conter ${esperado}`);
    assert.doesNotMatch(texto, new RegExp(errado), `sessão u${i} vazou ${errado}`);
  }
});

test('resposta inválida ("3" para duas opções) vira consulta nova', async () => {
  const { at } = novo();
  await at.processar({ remetente: 'C', texto: 'empate', idMensagem: 'c1' });
  const r = await at.processar({ remetente: 'C', texto: '3', idMensagem: 'c2' });
  // "3" não é opção válida: cai para consulta nova; "3" não acha nada → não reconhecido.
  assert.match(ultima(r.mensagens), /Não localizei/);
});

test('deduplicação: mesmo message.id é processado uma vez', async () => {
  const { at } = novo();
  const primeira = await at.processar({ remetente: 'D', texto: 'empate', idMensagem: 'dup' });
  const segunda = await at.processar({ remetente: 'D', texto: 'empate', idMensagem: 'dup' });
  assert.equal(primeira.ignorada, false);
  assert.equal(segunda.ignorada, true);
  assert.equal(segunda.mensagens.length, 0);
});
