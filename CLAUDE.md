# CLAUDE.md — Assistente Virtual Inteligente da Farmácia Municipal

> Documento de contexto do projeto. Coloque este arquivo na raiz do repositório: o Claude Code o
> lê automaticamente no início de cada sessão.

---

## 1. O que é este projeto

Assistente virtual que responde, via WhatsApp, se um medicamento **consta como disponível** no
estoque da Farmácia Municipal. Nasceu de um Termo de Referência do programa "Aperfeiçoando a
Gestão Pública", cujo problema declarado é o deslocamento desnecessário do cidadão até a farmácia
e a sobrecarga dos servidores com consultas por telefone e balcão.

**O canal é exclusivamente informativo.** Não reserva medicamento, não orienta sobre uso e não
substitui profissional de saúde.

### Estado atual

| Item | Situação |
|---|---|
| Termo de Referência | Aprovado, define objetivos e produto esperado |
| Base de dados fictícia | Pronta — 48 medicamentos, 134 sinônimos, 3 unidades |
| Schema Supabase | Pronto — `01_schema_supabase.sql` |
| Seed de dados | Pronto — `02_seed_dados_ficticios.sql` |
| Fluxo de conversa e regras | Pronto — `fluxo_conversa_assistente_farmacia.md` |
| Aplicação | **A construir — este é o trabalho** |
| Número WhatsApp homologado | Pendente, trâmite em paralelo (2 a 4 semanas) |

**Os dados de estoque são fictícios.** Nenhum quantitativo representa a posição real de qualquer
farmácia. Toda interface deve exibir aviso visível de dados simulados enquanto for demonstração.

---

## 2. Regra de ouro da arquitetura

> **A IA nunca decide se o medicamento existe ou está disponível.**
> Ela apenas interpreta a mensagem e redige a resposta a partir do registro devolvido pelo banco.
> Consulta sem resultado → resposta padrão fixa, **sem chamar o modelo de linguagem**.

Esta regra é o requisito central do TR e não pode ser flexibilizada por conveniência de
implementação. Qualquer refatoração que permita ao modelo afirmar disponibilidade sem um registro
correspondente quebra o projeto.

Consequências práticas:

- O modelo recebe no prompt **apenas** o registro retornado pela função `buscar_medicamento` e as
  regras de redação. Nunca recebe a base inteira, nunca é consultado "de memória".
- Se `data.length === 0`, o fluxo desvia para a mensagem padrão antes de qualquer chamada de API.
- Se a chamada ao modelo falhar, a aplicação responde com um texto determinístico montado a partir
  do registro, não com um pedido de tentar de novo.

---

## 3. Arquitetura

```
Cidadão (WhatsApp)
      │
      ▼
WhatsApp Cloud API (Meta)  ──webhook POST──►  Backend
                                                │
                                                ├─► Supabase RPC buscar_medicamento(termo)
                                                │      └─ 3 níveis: exato → princípio ativo → aproximado
                                                │
                                                ├─► [se vazio] mensagem padrão, SEM IA
                                                │
                                                ├─► [se 1 registro] IA redige a resposta
                                                │
                                                ├─► [se ambíguo] pergunta de desambiguação, SEM IA
                                                │
                                                └─► insert em consultas_log (anônimo)
      ▲                                           │
      └────── envio da resposta ──────────────────┘
```

### Stack

- **Banco**: Supabase (PostgreSQL), região South America (São Paulo)
- **Backend**: Node.js + TypeScript. Webhook HTTP.
- **IA**: API Anthropic, modelo Claude, apenas para redação da resposta
- **Canal**: WhatsApp Cloud API (Meta). Simulador web para a fase de demonstração.

O backend é obrigatório para o WhatsApp: a Meta exige um endpoint público para o webhook, e as
chaves (`service_role`, token da Meta, chave da Anthropic) não podem ficar no navegador.

---

## 4. Banco de dados

Executar no SQL Editor do Supabase, nesta ordem: `01_schema_supabase.sql`, depois
`02_seed_dados_ficticios.sql`.

### Tabelas

| Tabela | Conteúdo |
|---|---|
| `unidades` | Farmácias, endereços e horários |
| `medicamentos` | Posição de estoque. `situacao` é **coluna gerada**, calculada pelo banco |
| `sinonimos` | Termos digitados pelo cidadão → código do medicamento |
| `consultas_log` | Registro anônimo dos atendimentos, base dos indicadores |

`medicamentos.situacao` é derivada e não pode ser gravada:

```
estoque_atual = 0                     → 'EM FALTA'
estoque_atual <= estoque_minimo       → 'ESTOQUE BAIXO'
caso contrário                        → 'DISPONIVEL'
```

Isso impede divergência entre o número em estoque e a resposta dada ao cidadão.

### Função de busca

```sql
select * from public.buscar_medicamento(p_termo text, p_limite integer default 5);
```

Retorna: `codigo, principio_ativo, apresentacao, forma_farmaceutica, unidade_medida,
estoque_atual, situacao, tipo_receita, unidade_nome, atualizado_em, origem, semelhanca`.

**Três níveis de correspondência**, sempre nesta ordem de prioridade:

| Nível | `origem` | `semelhanca` | Como funciona |
|---|---|---|---|
| 1 | `sinonimo_exato` | 1.0 | Igualdade no dicionário de sinônimos, após normalizar (minúsculas, sem acento). Cobre nomes comerciais ("novalgina"), apelidos populares ("bombinha", "remédio de pressão") e variações de escrita |
| 2 | `principio_ativo` | 0.95 | Igualdade com o princípio ativo cadastrado |
| 3 | `aproximado` | similaridade real | Trigramas (`pg_trgm`), corte em 0.42. Tolera erro de digitação: "metiformina" → Metformina, "amoxilina" → Amoxicilina, "omeprasol" → Omeprazol |

Resultados ordenados por `semelhanca` decrescente. A normalização de acentos usa `unaccent`; o
gatilho `trg_normaliza_termo` mantém `sinonimos.termo_norm` sempre coerente.

**Ajuste do corte de 0.42:** abaixar aumenta falsos positivos (o assistente afirma ter algo que o
cidadão não pediu), subir aumenta falsos negativos (encaminhamento humano desnecessário). Falso
positivo é mais grave aqui — leva o cidadão a se deslocar à toa, que é exatamente o problema que o
projeto quer resolver. Na dúvida, prefira o corte mais alto.

### Segurança (RLS)

- Leitura liberada para `anon` em `medicamentos`, `sinonimos`, `unidades`
- Escrita bloqueada; a única permitida é `insert` em `consultas_log`
- `consultas_log` não é legível pela chave `anon`
- **`service_role` nunca vai para o cliente.** Só no backend, via variável de ambiente

---

## 5. Lógica de decisão do backend

Pseudocódigo do caminho crítico. **Respeitar a ordem dos desvios.**

```ts
const resultados = await supabase.rpc('buscar_medicamento', {
  p_termo: mensagem, p_limite: 5
});

// 1. Falha técnica → texto fixo, sem IA
if (resultados.error) return responder(MSG.FALHA_CONSULTA);

// 2. Nada encontrado → texto fixo, sem IA. NUNCA perguntar ao modelo.
if (!resultados.data?.length) {
  await registrarLog({ termo: mensagem, codigo: null, encaminhado: true,
                       motivo: 'termo_nao_reconhecido' });
  return responder(MSG.TERMO_NAO_RECONHECIDO);
}

// 3. Mesmo princípio ativo em apresentações diferentes → desambiguar, sem IA
const empatados = resultados.data.filter(r => r.semelhanca === resultados.data[0].semelhanca);
if (empatados.length > 1) return responder(montarDesambiguacao(empatados));

// 4. Registro único → IA redige, recebendo SÓ este registro
const registro = resultados.data[0];
const texto = await redigirComIA(registro).catch(() => montarRespostaDeterministica(registro));
await registrarLog({ termo: mensagem, codigo: registro.codigo,
                     situacao: registro.situacao, encaminhado: false });
return responder(texto);
```

`montarRespostaDeterministica` é o fallback quando a API da IA falha: monta a frase por template a
partir dos campos do registro. O cidadão recebe a informação correta mesmo com o modelo fora do ar.

---

## 6. Regras de resposta da IA

Estas regras vão no prompt de sistema, junto com o registro retornado pelo banco.

**Obrigatórias**

1. Responder exclusivamente com base no registro fornecido.
2. Nunca afirmar disponibilidade sem registro correspondente.
3. Toda resposta positiva acompanha a ressalva de estoque dinâmico.
4. Informar data e hora da última atualização (`atualizado_em`).
5. Não solicitar CPF, cartão SUS, nome, endereço, dados de receita ou qualquer informação de saúde.
6. Encaminhar para atendimento humano em caso de dúvida, falha ou pedido explícito.

**Proibidas**

7. Diagnosticar, indicar, sugerir substituição, comentar posologia, efeitos ou interações.
8. Reservar, separar ou prometer medicamento.
9. Estimar prazo de reposição sem dado oficial na base.
10. Responder sobre assuntos alheios à disponibilidade e ao funcionamento da farmácia.

### Mensagens padrão

| Chave | Texto |
|---|---|
| `BOAS_VINDAS` | Olá! Sou o assistente virtual da Farmácia Municipal. Informo se um medicamento consta como disponível no estoque. Não realizo reservas e não oriento sobre uso de medicamentos. |
| `RESSALVA_ESTOQUE` | O estoque muda ao longo do dia; esta consulta reflete a última posição registrada e não garante a disponibilidade na retirada. |
| `FALHA_CONSULTA` | Não consegui consultar o estoque neste momento. Tente novamente em alguns minutos ou digite ATENDENTE. |
| `TERMO_NAO_RECONHECIDO` | Não localizei esse medicamento no cadastro da farmácia. Você pode reescrever o nome ou digitar ATENDENTE. |
| `RECUSA_CLINICA` | Não posso orientar sobre uso, dosagem ou combinação de medicamentos. Procure o farmacêutico da unidade ou a equipe da sua UBS. Aqui informo apenas a disponibilidade de medicamentos. |
| `ENCERRAMENTO` | Consulta encerrada. Sempre que precisar, é só enviar o nome do medicamento. |
| `AVISO_DEMO` | ⚠️ Demonstração com dados fictícios. Os quantitativos não correspondem ao estoque real. |

Exemplos completos de diálogo estão em `fluxo_conversa_assistente_farmacia.md`, seção 4.

---

## 7. Concorrência e estado de sessão

O assistente atende vários cidadãos ao mesmo tempo. A consulta em si já é concorrente por
natureza — `buscar_medicamento` é `stable`, só leitura, com índices GIN, e o Postgres atende
centenas de requisições por segundo sem esforço. O risco não está no banco.

### O problema: estado da desambiguação

Quando o assistente pergunta "1 ou 2?", ele precisa lembrar o que perguntou **àquele** cidadão.
Guardar isso em variável de módulo produz o bug clássico: o usuário A responde "2" e recebe a
resposta da pergunta feita ao usuário B.

**Nenhum estado conversacional pode viver fora de uma chave de sessão.**

```ts
type EstadoSessao = {
  aguardando: 'desambiguacao' | null;
  opcoes: RegistroMedicamento[];   // o que foi oferecido
  expiraEm: number;                // epoch ms
};
```

Chave da sessão: hash do remetente (nunca o número em claro — ver seção 12).

| Fase | Onde guardar |
|---|---|
| Demonstração, uma instância | `Map<string, EstadoSessao>` em memória, TTL de 5 minutos, limpeza periódica |
| Piloto, múltiplas instâncias | Tabela `sessoes` no Supabase ou Redis. **Memória local não é compartilhada entre instâncias** e o balanceador não garante que a próxima mensagem caia no mesmo processo |

Regras do estado:

- Expira em 5 minutos. Mensagem que chega depois disso é tratada como consulta nova.
- Uma resposta que não corresponde às opções oferecidas ("3" quando havia duas) cancela a
  desambiguação e vira consulta nova, em vez de repetir a pergunta.
- O estado guarda apenas códigos de medicamento e o momento de expiração. Nunca texto livre do
  cidadão nem qualquer dado pessoal.

### Idempotência

O webhook da Meta reenvia mensagens quando não recebe 200 a tempo. Manter um conjunto dos
`message.id` já processados, com TTL curto, e descartar repetidos antes de qualquer processamento.
Sem isso, o cidadão recebe a mesma resposta duas ou três vezes sob carga.

### Como simular vários usuários

Três níveis, do mais simples ao mais completo:

1. **Demonstração visual** — o simulador com 3 ou 4 painéis de conversa lado a lado, cada um com
   sessão própria. Serve para mostrar ao gestor que não há fila nem interferência entre conversas.
   É o que vai para a apresentação.
2. **Teste de concorrência** — script que dispara N conversas em paralelo com `Promise.all`,
   incluindo pelo menos duas em desambiguação simultânea com escolhas diferentes. Verifica que
   cada uma recebeu a resposta certa. **Este teste é obrigatório**: é o único que pega o
   vazamento de estado entre sessões.
3. **Carga** — k6 ou Artillery, com rampa de usuários e relatório de percentis (p50, p95, p99).
   Só necessário antes do piloto real, não da apresentação.

### Limites reais sob carga

O banco não é o gargalo. Em ordem de probabilidade de estourar primeiro:

| Componente | Limite | Mitigação |
|---|---|---|
| API da Anthropic | Requisições e tokens por minuto | Fila com concorrência limitada; ao receber 429, cair no `montarRespostaDeterministica`, não enfileirar indefinidamente |
| WhatsApp Cloud API | Mensagens por segundo, conforme o tier do número | Fila de envio com taxa controlada |
| Supabase (plano gratuito) | Conexões simultâneas | Usar o **pooler** (porta 6543), nunca conexão direta; cliente único reaproveitado, não um por requisição |

Consequência de desenho: o caminho sem IA (termo não reconhecido, desambiguação, falha) é
determinístico e não consome cota externa. Sob carga, é ele que segura a operação — mais um motivo
para o desvio da seção 5 vir **antes** de qualquer chamada ao modelo.

---

## 8. Integração WhatsApp

O canal evolui em três fases. A mesma lógica de negócio serve às três — só muda o adaptador.

| Fase | Canal | Exige homologação? | Quem consegue usar |
|---|---|---|---|
| A | Simulador web | Não | Qualquer pessoa, no navegador |
| B | **Número de teste da Meta** | Não | Até 5 números cadastrados: a equipe do projeto |
| C | Número oficial da Prefeitura | Sim | Cidadãos |

Construa contra a fase A, valide na B, publique na C. **A fase C não é caminho crítico do
desenvolvimento** — o trâmite corre em paralelo.

### Fase B — número de teste da Meta (WhatsApp real, sem homologação)

Permite que a equipe consulte o protótipo pelo próprio celular. É o que se leva à apresentação
como prova de que funciona em WhatsApp de verdade.

**Distinção fundamental:** o número pessoal entra como **remetente** (o cidadão que pergunta),
nunca como o número do assistente. Transformar um número pessoal no número do bot inutiliza o
WhatsApp daquele aparelho e vincula o canal a uma pessoa física, não à Prefeitura. Não fazer.

Passos:

1. Criar um app em `developers.facebook.com` e adicionar o produto WhatsApp. Aceita conta de teste;
   não exige verificação de negócio nem CNPJ nesta fase.
2. Anotar o **Phone number ID** do número de teste fornecido e o token de acesso.
3. Em *API Setup*, adicionar os números da equipe à lista de destinatários — **máximo de 5** —
   e verificar cada um pelo código recebido no WhatsApp.
4. Expor o webhook local com **ngrok** ou **Cloudflare Tunnel**. A Meta exige URL pública com HTTPS.
5. Configurar no painel a URL do webhook e o `WHATSAPP_VERIFY_TOKEN`, e assinar o campo `messages`.
6. Enviar mensagem do celular para o número de teste.

Armadilhas conhecidas desta fase:

- **A lista de 5 destinatários é difícil de alterar depois.** Conferir o formato antes de gravar:
  código do país + DDD + número, sem espaços.
- **O token inicial expira em 24 horas.** Para testes contínuos, gerar token de sistema permanente.
- **Reiniciar o ngrok muda a URL** e o webhook silenciosamente para de funcionar. Usar domínio fixo
  ou reconfigurar a cada sessão. Verificar isso antes da apresentação, não durante.
- **O número de teste não pode ser usado com cidadãos.** Serve apenas para a equipe. O limite de 5
  destinatários é, na prática, uma proteção: impede que a demonstração com dados fictícios vaze
  para um cidadão real por engano.
- Manter `MODO=demonstracao`, para que o aviso de dados fictícios apareça em toda resposta.

### Fase C — pré-requisitos do número oficial (fora do código)

- Número dedicado, sem WhatsApp comum ou Business app ativo. Pode ser fixo (verificação por voz).
- Titularidade da Prefeitura, não de servidor.
- Conta Meta Business verificada com o CNPJ, e nome de exibição aprovado.
- Cloud API da Meta direto ou via provedor (BSP).
- Prazo de 2 a 4 semanas, fora do controle da equipe.

A troca da fase B para a C é só de credenciais e do `MODO`: o código do `CanalWhatsApp` é o mesmo.

### Endpoints

```
GET  /webhook   verificação da Meta: devolver hub.challenge se hub.verify_token conferir
POST /webhook   recebimento de mensagens
```

Regras do webhook: responder **200 em até 5 segundos**, sempre, mesmo em erro interno — a Meta
reenvia em caso de falha e gera duplicidade. Processar de forma assíncrona. Descartar evento cujo
`message.id` já foi visto (deduplicação obrigatória).

### Abstração de canal

Isolar o envio e o recebimento atrás de uma interface, para que o simulador e o WhatsApp usem a
mesma lógica de negócio:

```ts
interface CanalMensagem {
  receber(payload: unknown): { remetente: string; texto: string; idMensagem: string } | null;
  enviar(destinatario: string, texto: string): Promise<void>;
}
```

Implementações: `CanalSimulador` (fase A) e `CanalWhatsApp` (fases B e C — o mesmo código, só
mudam as credenciais).

### Janela de 24 horas

A Meta só permite mensagem livre dentro de 24 horas após a última mensagem do cidadão. Como o
assistente é sempre reativo, isso não afeta o fluxo — mas impede notificação de reposição de
estoque sem template aprovado. Se essa funcionalidade for pedida, ela exige template e tem custo.

---

## 9. Estrutura sugerida do repositório

```
/
├── CLAUDE.md
├── .env.example
├── db/
│   ├── 01_schema_supabase.sql
│   └── 02_seed_dados_ficticios.sql
├── docs/
│   ├── fluxo_conversa_assistente_farmacia.md
│   ├── passo_a_passo_supabase.md
│   └── base_ficticia_farmacia_municipal.xlsx
├── src/
│   ├── index.ts                 # servidor HTTP e rotas
│   ├── config.ts                # leitura e validação das variáveis de ambiente
│   ├── canais/
│   │   ├── tipos.ts
│   │   ├── simulador.ts
│   │   └── whatsapp.ts
│   ├── dominio/
│   │   ├── busca.ts             # chamada da RPC e classificação do resultado
│   │   ├── decisao.ts           # a lógica da seção 5 — coração do sistema
│   │   ├── mensagens.ts         # textos padrão
│   │   ├── sessao.ts            # estado por remetente, TTL e idempotência
│   │   └── redacao-ia.ts        # prompt e chamada da API, com fallback determinístico
│   ├── dados/
│   │   ├── supabase.ts
│   │   └── log.ts
│   └── web/
│       └── simulador.html       # interface de demonstração
└── tests/
    ├── decisao.test.ts
    └── concorrencia.test.ts     # sessões simultâneas sem vazamento de estado
```

### Variáveis de ambiente

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # somente backend, nunca no cliente
ANTHROPIC_API_KEY=
WHATSAPP_TOKEN=                 # fase B: token do app de teste | fase C: token de sistema
WHATSAPP_PHONE_NUMBER_ID=       # ID do número (teste ou oficial), diferente do número em si
WHATSAPP_VERIFY_TOKEN=          # string escolhida pela equipe, repetida no painel da Meta
MODO=demonstracao               # demonstracao | piloto — controla o aviso de dados fictícios
```

---

## 10. Ordem de implementação

1. **Banco** — rodar os dois SQL e validar as quatro consultas de teste da seção 11.
2. **Camada de busca** — `busca.ts` chamando a RPC. Testar isoladamente, sem interface.
3. **Lógica de decisão** — `decisao.ts` com os quatro desvios da seção 5. **Escrever os testes
   aqui antes de qualquer interface**; é o único ponto onde um erro produz informação errada ao
   cidadão.
4. **Estado de sessão** — `sessao.ts` com chave por remetente, TTL de 5 minutos e deduplicação
   de mensagens. Testar duas desambiguações simultâneas com escolhas diferentes (seção 7).
5. **Redação por IA** — `redacao-ia.ts`, com fallback determinístico obrigatório.
6. **Simulador web** — interface com cara de WhatsApp, aviso de dados fictícios, painel lateral
   para alterar estoque ao vivo e opção de abrir múltiplos painéis de conversa em paralelo.
7. **Log e indicadores** — `consultas_log` e a view `vw_indicadores`.
8. **Adaptador WhatsApp** — `CanalWhatsApp` + webhook, validado com o **número de teste da Meta**
   (fase B da seção 8). Não depende de homologação.
9. **Número oficial** — só troca de credenciais, quando a homologação sair.

Passos 1 a 7 entregam a demonstração no simulador; o passo 8 a coloca no WhatsApp real da equipe. Estimativa: 1 a 2 semanas.

---

## 11. Critérios de aceitação

Casos que precisam passar antes de qualquer apresentação:

| Entrada | Resultado esperado |
|---|---|
| `tem dipirona?` | Disponível, com ressalva de estoque e data de atualização |
| `zitromax` | Reconhece Azitromicina 500 mg, informa **em falta** |
| `metiformina` | Reconhece Metformina 850 mg via similaridade |
| `bombinha` | Reconhece Salbutamol aerossol |
| `dipirona pra criança` | Pergunta de desambiguação entre comprimido e solução oral |
| `paracetamol gotas` | Informa **estoque baixo**, sugere procurar no mesmo dia |
| `xpto123` | Mensagem padrão de não reconhecido. **Nenhuma chamada à API da IA** |
| `posso tomar dipirona com o remédio de pressão?` | Recusa clínica, encaminha a profissional |
| API da IA fora do ar | Resposta determinística correta, montada por template |
| `update medicamentos set estoque_atual = 0 where codigo = 'MED-001'` e repetir a 1ª pergunta | Resposta muda para **em falta** imediatamente |
| Dois usuários em desambiguação ao mesmo tempo, um responde `1` e outro `2` | Cada um recebe a resposta da **sua** pergunta |
| Mesma mensagem entregue duas vezes pelo webhook | Processada uma só vez |
| Sessão de desambiguação sem resposta por mais de 5 minutos | Expira; a mensagem seguinte é tratada como consulta nova |
| 50 consultas em paralelo | Todas respondidas corretamente, sem troca de conteúdo entre sessões |
| Mensagem enviada do celular da equipe ao número de teste da Meta | Resposta chega no WhatsApp, com o aviso de dados fictícios |

O último caso é o que se demonstra ao gestor: prova que a informação vem da base, não do modelo.

### Roteiro da apresentação (5 minutos)

Consulta bem-sucedida → nome comercial → erro de digitação → **alteração ao vivo do estoque** →
pergunta clínica recusada → painel de indicadores.

Fechamento sugerido: passar o celular ao gestor para ele mesmo perguntar pelo WhatsApp, usando o
número de teste. Costuma valer mais que o restante da apresentação — mas o simulador continua sendo
o principal na tela projetada, por ser mais controlável.

Gravar vídeo de backup. Wi-Fi de auditório falha, e o túnel do ngrok cai junto.

---

## 12. LGPD e governança

- O sistema **não coleta dado pessoal nem dado de saúde**. Não pergunta CPF, cartão SUS, nome ou
  condição clínica, e a IA é instruída a nunca solicitá-los.
- O número de telefone chega do WhatsApp por necessidade técnica do canal. **Nunca gravar em
  claro**: `consultas_log.sessao_hash` recebe hash com sal, e o sal fica em variável de ambiente.
- Definir política de retenção do log antes do piloto. Sugestão: 12 meses, suficiente para os
  indicadores.
- Aviso de finalidade na primeira interação de cada sessão.
- Hospedagem em serviço externo (Supabase) exige posicionamento formal da TI e do encarregado de
  dados do município, mesmo sem dado pessoal. Levantar cedo, não na véspera.

---

## 13. Indicadores do piloto

Calculados por `vw_indicadores` e `vw_mais_consultados`:

consultas realizadas · taxa de resolução automática · taxa de reconhecimento de termo · tempo médio
de resposta · encaminhamentos humanos por motivo · itens mais consultados · consultas sobre itens
em falta (proxy do deslocamento evitado).

Termos que caem em `termo_nao_reconhecido` no log são a principal fonte de melhoria: viram novas
entradas na tabela `sinonimos`. Prever revisão periódica desses registros.

---

## 14. Migração para a base real

O que muda, e o que **não** muda:

| Item | Protótipo | Piloto |
|---|---|---|
| Origem dos dados | Seed fictício | Carga periódica do sistema oficial de estoque |
| Estrutura das tabelas | — | **Mantida**. Só a origem dos dados muda |
| Lógica de busca e decisão | — | **Mantida** |
| Dicionário de sinônimos | 131 termos | Ampliado com Rename, dados abertos da Anvisa e termos coletados no log |
| Canal | Simulador | Número oficial homologado |
| Encaminhamento humano | Simulado | Fila real de atendimento da farmácia |

Manter os nomes de coluna estáveis é o que permite trocar a fonte de dados sem tocar na aplicação.

### Fontes públicas úteis para ampliar o cadastro

- **BNAFAR — Posição de Estoque**, no Portal de Dados Abertos do SUS (verificar disponibilidade;
  o conjunto já apareceu marcado como em manutenção)
- **Rename** — Relação Nacional de Medicamentos Essenciais
- **Anvisa, dados abertos** (`dados.anvisa.gov.br`) — medicamentos regularizados, genéricos,
  similares intercambiáveis, referência e Bulário. Útil para mapear nome comercial → princípio ativo
- **CMED** — lista de preços, se houver necessidade de demonstrar custo
