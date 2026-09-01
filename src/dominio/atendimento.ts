// Camada de aplicacao: orquestra um atendimento fim a fim, sem conhecer o canal.
// Recebe uma MensagemRecebida e devolve as mensagens a enviar de volta.
// Ordem: deduplicacao -> sessao/boas-vindas -> desambiguacao pendente ->
// intencao -> busca -> decisao (secao 5) -> [IA] -> log.

import type { MensagemRecebida, Decisao, RegistroMedicamento } from './tipos.ts';
import type { Repositorio, RegistroLog } from '../dados/repositorio.ts';
import { GerenciadorSessao } from './sessao.ts';
import {
  detectarIntencao,
  decidirPorResultados,
  decisaoRecusaClinica,
  decisaoAtendente,
  decisaoSocial,
} from './decisao.ts';
import { redigirComIA } from './redacao-ia.ts';
import { MSG, montarUmPorVez } from './mensagens.ts';
import { normalizar } from './texto.ts';
import { ehDemonstracao } from '../config.ts';

export type ResultadoAtendimento = {
  mensagens: string[];
  ignorada: boolean; // true quando descartada por deduplicacao
};

export class Atendimento {
  private readonly repo: Repositorio;
  private readonly sessao: GerenciadorSessao;

  constructor(repo: Repositorio, sessao: GerenciadorSessao) {
    this.repo = repo;
    this.sessao = sessao;
  }

  async processar(msg: MensagemRecebida): Promise<ResultadoAtendimento> {
    // 0. Idempotencia: descarta reentrega do mesmo message.id.
    if (msg.idMensagem && (await this.sessao.jaProcessada(msg.idMensagem))) {
      return { mensagens: [], ignorada: true };
    }

    const chave = this.sessao.hash(msg.remetente);
    const saida: string[] = [];

    // 1. Boas-vindas na primeira interacao da sessao.
    if (await this.sessao.primeiraInteracao(chave)) {
      saida.push(MSG.BOAS_VINDAS);
      if (ehDemonstracao) saida.push(MSG.AVISO_DEMO);
    }

    // 2. Ha desambiguacao pendente? Tenta resolver com a resposta.
    const estado = await this.sessao.obter(chave);
    if (estado?.aguardando === 'desambiguacao') {
      const escolhido = await this.sessao.resolverDesambiguacao(chave, msg.texto);
      if (escolhido) {
        saida.push(await this.executar({ tipo: 'redigir_ia', registro: escolhido }, msg));
        return { mensagens: saida, ignorada: false };
      }
      // Resposta invalida ("3" para duas opcoes): cai para consulta nova.
    }

    // 3. Intencao antes da busca: atendente e recusa clinica nao vao ao banco.
    const intencao = detectarIntencao(msg.texto);
    if (intencao === 'atendente') {
      saida.push(await this.executar(decisaoAtendente(), msg));
      return { mensagens: saida, ignorada: false };
    }
    if (intencao === 'clinica') {
      saida.push(await this.executar(decisaoRecusaClinica(), msg));
      return { mensagens: saida, ignorada: false };
    }
    if (intencao === 'saudacao' || intencao === 'agradecimento' || intencao === 'despedida') {
      saida.push(await this.executar(decisaoSocial(intencao), msg));
      return { mensagens: saida, ignorada: false };
    }

    // 4. Mais de um medicamento na mesma mensagem? Pedir um por vez.
    const citados = await this.medicamentosCitados(msg.texto);
    if (citados.length >= 2) {
      saida.push(await this.executar({ tipo: 'social', texto: montarUmPorVez() }, msg));
      return { mensagens: saida, ignorada: false };
    }

    // 5. Consulta ao banco + desvios da secao 5.
    let resultados: RegistroMedicamento[] = [];
    let houveErro = false;
    try {
      resultados = await this.repo.buscar(msg.texto, 5);
    } catch {
      houveErro = true;
    }
    const decisao = decidirPorResultados(resultados, houveErro);
    saida.push(await this.executar(decisao, msg));
    return { mensagens: saida, ignorada: false };
  }

  /**
   * Detecta se a mensagem cita mais de um medicamento (separados por "e", ",",
   * "+", "/", "ou"). Retorna os nomes (principio ativo) distintos encontrados;
   * lista com <2 itens significa "consulta normal de um medicamento".
   */
  private async medicamentosCitados(texto: string): Promise<string[]> {
    const partes = normalizar(texto)
      .split(/\s+e\s+|\s*,\s*|\s*\+\s*|\s*\/\s*|\s*;\s*|\s+ou\s+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 3)
      .slice(0, 6);
    if (partes.length < 2) return [];

    const familias = new Map<string, string>(); // principio_ativo -> nome exibido
    for (const parte of partes) {
      try {
        const r = await this.repo.buscar(parte, 1);
        if (r.length) familias.set(r[0].principio_ativo, r[0].principio_ativo);
      } catch {
        // ignora falha numa parte; nao impede o restante
      }
    }
    return [...familias.values()];
  }

  /** Executa uma decisao: produz o texto, ajusta a sessao e grava o log. */
  private async executar(decisao: Decisao, msg: MensagemRecebida): Promise<string> {
    const chave = this.sessao.hash(msg.remetente);
    const base: RegistroLog = {
      sessaoHash: chave,
      termoDigitado: msg.texto,
      codigoEncontrado: null,
      situacaoRetornada: null,
      encaminhadoHumano: false,
      motivoEncaminhamento: null,
    };

    switch (decisao.tipo) {
      case 'texto_fixo': {
        await this.repo.registrarLog({
          ...base,
          encaminhadoHumano: true,
          motivoEncaminhamento: decisao.motivoEncaminhamento ?? null,
        });
        return decisao.texto;
      }
      case 'recusa_clinica': {
        await this.repo.registrarLog({ ...base, motivoEncaminhamento: 'duvida_clinica' });
        return decisao.texto;
      }
      case 'social': {
        // Saudacao/agradecimento/despedida nao e consulta: nao registra no log.
        return decisao.texto;
      }
      case 'desambiguacao': {
        await this.sessao.aguardarDesambiguacao(chave, decisao.opcoes);
        // A pergunta em si nao fecha atendimento; o log vem quando for resolvida.
        return decisao.texto;
      }
      case 'redigir_ia': {
        const r = decisao.registro;
        const texto = await redigirComIA(r);
        await this.repo.registrarLog({
          ...base,
          codigoEncontrado: r.codigo,
          situacaoRetornada: r.situacao,
        });
        return texto;
      }
    }
  }
}
