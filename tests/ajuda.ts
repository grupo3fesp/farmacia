// Utilitarios de teste (modelo multiunidade).
import type {
  RegistroMedicamento,
  EstoqueUnidade,
  OrigemBusca,
  Situacao,
} from '../src/dominio/tipos.ts';

export function registro(over: Partial<RegistroMedicamento> = {}): RegistroMedicamento {
  return {
    codigo: 'MED-000',
    principio_ativo: 'Teste',
    apresentacao: '500 mg',
    forma_farmaceutica: 'Comprimido',
    unidade_medida: 'Comprimido',
    tipo_receita: 'Receita simples',
    origem: 'sinonimo_exato' as OrigemBusca,
    semelhanca: 1.0,
    ...over,
  };
}

export function estoqueUnidade(over: Partial<EstoqueUnidade> = {}): EstoqueUnidade {
  return {
    unidade_id: 'UN-01',
    unidade_nome: 'Farmácia Municipal Central',
    endereco: null,
    horario: null,
    estoque_atual: 100,
    estoque_minimo: 10,
    situacao: 'DISPONIVEL' as Situacao,
    atualizado_em: new Date('2026-08-30T07:00:00').toISOString(),
    ...over,
  };
}
