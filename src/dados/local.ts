// Repositorio local (modelo multiunidade): roda offline a partir de seed.json.
// Reproduz buscar_medicamento (catalogo) e estoque_medicamento (por unidade).

import type {
  RegistroMedicamento,
  EstoqueUnidade,
  Situacao,
  OrigemBusca,
} from '../dominio/tipos.ts';
import { normalizar, similaridade } from '../dominio/texto.ts';
import type { Repositorio, RegistroLog, Indicadores, ItemEstoque } from './repositorio.ts';
import seed from './seed.json' with { type: 'json' };

type Unidade = { id: string; nome: string; endereco: string | null; horario: string | null };
type Catalogo = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  forma_farmaceutica: string | null;
  unidade_medida: string | null;
  tipo_receita: string | null;
};
type EstoqueRow = {
  codigo: string;
  unidade_id: string;
  estoque_atual: number;
  estoque_minimo: number;
  atualizado_em: string;
};
type Sinonimo = { codigo: string; termo_norm: string };

function situacaoDe(atual: number, minimo: number): Situacao {
  if (atual === 0) return 'EM FALTA';
  if (atual <= minimo) return 'ESTOQUE BAIXO';
  return 'DISPONIVEL';
}

/** Timestamp base: hoje as 07h00 local. */
function carimboInicial(): string {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  return d.toISOString();
}

export class RepositorioLocal implements Repositorio {
  private readonly corte: number;
  private readonly unidades = new Map<string, Unidade>();
  private readonly catalogo = new Map<string, Catalogo>();
  private readonly estoques = new Map<string, EstoqueRow>(); // chave: `${codigo}|${unidade_id}`
  private readonly sinonimos: Sinonimo[] = [];
  private readonly log: RegistroLog[] = [];

  constructor() {
    this.corte = seed.corte_similaridade ?? 0.42;
    const carimbo = carimboInicial();
    for (const u of seed.unidades) this.unidades.set(u.id, u as Unidade);
    for (const m of seed.medicamentos) this.catalogo.set(m.codigo, m as Catalogo);
    for (const e of seed.estoques) {
      this.estoques.set(`${e.codigo}|${e.unidade_id}`, {
        codigo: e.codigo,
        unidade_id: e.unidade_id,
        estoque_atual: e.estoque_atual,
        estoque_minimo: e.estoque_minimo,
        atualizado_em: carimbo,
      });
    }
    for (const s of seed.sinonimos) {
      this.sinonimos.push({ codigo: s.codigo, termo_norm: normalizar(s.termo) });
    }
  }

  async buscar(termo: string, limite = 5): Promise<RegistroMedicamento[]> {
    const t = normalizar(termo);
    const prioridade: Record<OrigemBusca, number> = {
      sinonimo_exato: 3,
      principio_ativo: 2,
      aproximado: 1,
    };
    const melhor = new Map<string, { semelhanca: number; origem: OrigemBusca }>();
    const considerar = (codigo: string, origem: OrigemBusca, semelhanca: number) => {
      const atual = melhor.get(codigo);
      if (
        !atual ||
        semelhanca > atual.semelhanca ||
        (semelhanca === atual.semelhanca && prioridade[origem] > prioridade[atual.origem])
      ) {
        melhor.set(codigo, { semelhanca, origem });
      }
    };

    if (t !== '') {
      for (const s of this.sinonimos) if (s.termo_norm === t) considerar(s.codigo, 'sinonimo_exato', 1.0);
      for (const m of this.catalogo.values()) {
        if (normalizar(m.principio_ativo) === t) considerar(m.codigo, 'principio_ativo', 0.95);
      }
      for (const s of this.sinonimos) {
        const sim = similaridade(s.termo_norm, t);
        if (sim > this.corte) considerar(s.codigo, 'aproximado', sim);
      }
      // Nivel 4: prefixo do principio ativo. "acido" -> Ácido fólico E
      // Ácido acetilsalicílico (empatam -> desambiguacao). Evita que um termo
      // parcial ambiguo caia direto num unico medicamento.
      if (t.length >= 3) {
        for (const m of this.catalogo.values()) {
          const pn = normalizar(m.principio_ativo);
          if (pn !== t && pn.startsWith(t)) considerar(m.codigo, 'aproximado', 0.5);
        }
      }
    }

    return [...melhor.entries()]
      .map(([codigo, b]) => {
        const m = this.catalogo.get(codigo)!;
        return {
          codigo: m.codigo,
          principio_ativo: m.principio_ativo,
          apresentacao: m.apresentacao,
          forma_farmaceutica: m.forma_farmaceutica,
          unidade_medida: m.unidade_medida,
          tipo_receita: m.tipo_receita,
          origem: b.origem,
          semelhanca: b.semelhanca,
        } satisfies RegistroMedicamento;
      })
      .sort((a, b) => b.semelhanca - a.semelhanca || a.principio_ativo.localeCompare(b.principio_ativo))
      .slice(0, limite);
  }

  async estoquePorCodigo(codigo: string): Promise<EstoqueUnidade[]> {
    return [...this.estoques.values()]
      .filter((e) => e.codigo === codigo)
      .map((e) => {
        const u = this.unidades.get(e.unidade_id);
        return {
          unidade_id: e.unidade_id,
          unidade_nome: u?.nome ?? e.unidade_id,
          endereco: u?.endereco ?? null,
          horario: u?.horario ?? null,
          estoque_atual: e.estoque_atual,
          estoque_minimo: e.estoque_minimo,
          situacao: situacaoDe(e.estoque_atual, e.estoque_minimo),
          atualizado_em: e.atualizado_em,
        } satisfies EstoqueUnidade;
      })
      .sort((a, b) => a.unidade_nome.localeCompare(b.unidade_nome, 'pt-BR'));
  }

  async registrarLog(registro: RegistroLog): Promise<void> {
    this.log.push(registro);
  }

  async indicadores(): Promise<Indicadores> {
    const total = this.log.length;
    const reconhecidos = this.log.filter((l) => l.codigoEncontrado != null).length;
    const encaminhados = this.log.filter((l) => l.encaminhadoHumano).length;
    const emFalta = this.log.filter((l) => l.situacaoRetornada === 'EM FALTA').length;
    const pct = (n: number) => (total === 0 ? 0 : Math.round((1000 * n) / total) / 10);
    return {
      consultas_totais: total,
      termos_reconhecidos: reconhecidos,
      taxa_reconhecimento_pct: pct(reconhecidos),
      encaminhamentos_humanos: encaminhados,
      taxa_resolucao_automatica_pct: pct(total - encaminhados),
      consultas_itens_em_falta: emFalta,
    };
  }

  async listarEstoque(): Promise<ItemEstoque[]> {
    return [...this.estoques.values()]
      .map((e) => {
        const m = this.catalogo.get(e.codigo)!;
        return {
          codigo: e.codigo,
          principio_ativo: m.principio_ativo,
          apresentacao: m.apresentacao,
          unidade_id: e.unidade_id,
          unidade_nome: this.unidades.get(e.unidade_id)?.nome ?? e.unidade_id,
          estoque_atual: e.estoque_atual,
          estoque_minimo: e.estoque_minimo,
          situacao: situacaoDe(e.estoque_atual, e.estoque_minimo) as string,
        } satisfies ItemEstoque;
      })
      .sort(
        (a, b) =>
          a.principio_ativo.localeCompare(b.principio_ativo, 'pt-BR') ||
          a.apresentacao.localeCompare(b.apresentacao, 'pt-BR') ||
          a.unidade_nome.localeCompare(b.unidade_nome, 'pt-BR'),
      );
  }

  async alterarEstoque(codigo: string, unidadeId: string, estoqueAtual: number): Promise<boolean> {
    const chave = `${codigo}|${unidadeId}`;
    const e = this.estoques.get(chave);
    if (!e || !Number.isInteger(estoqueAtual) || estoqueAtual < 0) return false;
    if (e.estoque_atual !== estoqueAtual) {
      e.estoque_atual = estoqueAtual;
      e.atualizado_em = new Date().toISOString();
    }
    return true;
  }
}
