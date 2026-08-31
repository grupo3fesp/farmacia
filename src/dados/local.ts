// Repositorio local: roda offline, sem Supabase, a partir de src/dados/seed.json
// (gerado dos SQL por scripts/gerar-seed.mjs). Reproduz fielmente a logica da
// RPC public.buscar_medicamento — os tres niveis, o corte de similaridade, a
// ordenacao e a coluna gerada `situacao`. Serve a fase A (simulador) do projeto.

import type { RegistroMedicamento, Situacao, OrigemBusca } from '../dominio/tipos.ts';
import { normalizar, similaridade } from '../dominio/texto.ts';
import type { Repositorio, RegistroLog, Indicadores, ItemEstoque } from './repositorio.ts';
import seed from './seed.json' with { type: 'json' };

type Unidade = { id: string; nome: string; endereco: string | null; horario: string | null };

type Medicamento = {
  codigo: string;
  principio_ativo: string;
  apresentacao: string;
  forma_farmaceutica: string | null;
  unidade_medida: string | null;
  estoque_atual: number;
  estoque_minimo: number;
  tipo_receita: string | null;
  unidade_id: string | null;
  atualizado_em: string;
};

type Sinonimo = { codigo: string; termo: string; termo_norm: string };

function situacaoDe(estoque_atual: number, estoque_minimo: number): Situacao {
  if (estoque_atual === 0) return 'EM FALTA';
  if (estoque_atual <= estoque_minimo) return 'ESTOQUE BAIXO';
  return 'DISPONIVEL';
}

/** Timestamp base: hoje as 07h00 local, imitando a posicao registrada de manha. */
function carimboInicial(): string {
  const d = new Date();
  d.setHours(7, 0, 0, 0);
  return d.toISOString();
}

export class RepositorioLocal implements Repositorio {
  private readonly corte: number;
  private readonly unidades = new Map<string, Unidade>();
  private readonly medicamentos = new Map<string, Medicamento>();
  private readonly sinonimos: Sinonimo[] = [];
  private readonly log: RegistroLog[] = [];

  constructor() {
    this.corte = seed.corte_similaridade ?? 0.42;
    const carimbo = carimboInicial();
    for (const u of seed.unidades) this.unidades.set(u.id, u as Unidade);
    for (const m of seed.medicamentos) {
      this.medicamentos.set(m.codigo, { ...(m as object as Medicamento), atualizado_em: carimbo });
    }
    for (const s of seed.sinonimos) {
      this.sinonimos.push({ codigo: s.codigo, termo: s.termo, termo_norm: normalizar(s.termo) });
    }
  }

  private montarRegistro(
    m: Medicamento,
    origem: OrigemBusca,
    semelhanca: number,
  ): RegistroMedicamento {
    return {
      codigo: m.codigo,
      principio_ativo: m.principio_ativo,
      apresentacao: m.apresentacao,
      forma_farmaceutica: m.forma_farmaceutica,
      unidade_medida: m.unidade_medida,
      estoque_atual: m.estoque_atual,
      situacao: situacaoDe(m.estoque_atual, m.estoque_minimo),
      tipo_receita: m.tipo_receita,
      unidade_nome: m.unidade_id ? (this.unidades.get(m.unidade_id)?.nome ?? null) : null,
      atualizado_em: m.atualizado_em,
      origem,
      semelhanca,
    };
  }

  async buscar(termo: string, limite = 5): Promise<RegistroMedicamento[]> {
    const t = normalizar(termo);
    // codigo -> melhor { semelhanca, origem }. Origem segue a maior semelhanca,
    // com desempate pela prioridade dos niveis (exato > principio > aproximado).
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
      // Nivel 1: sinonimo exato
      for (const s of this.sinonimos) {
        if (s.termo_norm === t) considerar(s.codigo, 'sinonimo_exato', 1.0);
      }
      // Nivel 2: principio ativo exato
      for (const m of this.medicamentos.values()) {
        if (normalizar(m.principio_ativo) === t) considerar(m.codigo, 'principio_ativo', 0.95);
      }
      // Nivel 3: aproximado por trigramas
      for (const s of this.sinonimos) {
        const sim = similaridade(s.termo_norm, t);
        if (sim > this.corte) considerar(s.codigo, 'aproximado', sim);
      }
    }

    const registros = [...melhor.entries()]
      .map(([codigo, b]) => {
        const m = this.medicamentos.get(codigo)!;
        return this.montarRegistro(m, b.origem, b.semelhanca);
      })
      .sort((a, b) => b.semelhanca - a.semelhanca || a.principio_ativo.localeCompare(b.principio_ativo));

    return registros.slice(0, limite);
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

  // --- Operacoes do painel editor ao vivo ---

  /** Lista o estoque atual, para o painel editor. */
  async listarEstoque(): Promise<ItemEstoque[]> {
    return [...this.medicamentos.values()]
      .map((m) => ({
        codigo: m.codigo,
        principio_ativo: m.principio_ativo,
        apresentacao: m.apresentacao,
        estoque_atual: m.estoque_atual,
        estoque_minimo: m.estoque_minimo,
        situacao: situacaoDe(m.estoque_atual, m.estoque_minimo) as string,
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  /** Altera o estoque de um item ao vivo e recarimba a data (imita o gatilho). */
  async alterarEstoque(codigo: string, estoqueAtual: number): Promise<boolean> {
    const m = this.medicamentos.get(codigo);
    if (!m || !Number.isInteger(estoqueAtual) || estoqueAtual < 0) return false;
    if (m.estoque_atual !== estoqueAtual) {
      m.estoque_atual = estoqueAtual;
      m.atualizado_em = new Date().toISOString();
    }
    return true;
  }
}
