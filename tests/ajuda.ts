// Utilitarios de teste.
import type { RegistroMedicamento, Situacao, OrigemBusca } from '../src/dominio/tipos.ts';

export function registro(over: Partial<RegistroMedicamento> = {}): RegistroMedicamento {
  return {
    codigo: 'MED-000',
    principio_ativo: 'Teste',
    apresentacao: '500 mg',
    forma_farmaceutica: 'Comprimido',
    unidade_medida: 'Comprimido',
    estoque_atual: 100,
    situacao: 'DISPONIVEL' as Situacao,
    tipo_receita: 'Receita simples',
    unidade_nome: 'Farmácia Municipal Central',
    atualizado_em: new Date('2026-08-30T07:00:00').toISOString(),
    origem: 'sinonimo_exato' as OrigemBusca,
    semelhanca: 1.0,
    ...over,
  };
}
