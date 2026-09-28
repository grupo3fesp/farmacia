# Manual de Instalação e Replicação
### Assistente Virtual da Farmácia Municipal

Este manual ensina a **instalar a solução do zero** e **adaptá-la à realidade do seu órgão**: suas unidades, seu catálogo de medicamentos e seu estoque. Ao final você terá:

- um **site público** com o simulador de conversa (estilo WhatsApp) e o painel de estoque ao vivo;
- um **banco de dados** com o seu catálogo e o estoque de cada unidade;
- respostas em **linguagem natural** redigidas por IA gratuita;
- a **integração com o WhatsApp** pronta para ativar quando o órgão concluir a verificação na Meta.

> **Tempo estimado:** cerca de 1 hora para a instalação com dados de exemplo, mais o tempo de preparar as planilhas do seu órgão.
> **Custo:** zero nos planos gratuitos (veja a [seção 2](#2-o-que-você-precisa)).

---

## Sumário

1. [Como a solução funciona](#1-como-a-solução-funciona)
2. [O que você precisa](#2-o-que-você-precisa)
3. [Teste rápido no seu computador (5 minutos, sem contas)](#3-teste-rápido-no-seu-computador-5-minutos-sem-contas)
4. [Passo 1: copiar o projeto](#4-passo-1-copiar-o-projeto)
5. [Passo 2: criar o banco no Supabase](#5-passo-2-criar-o-banco-no-supabase)
6. [Passo 3: obter a chave de IA (Google Gemini)](#6-passo-3-obter-a-chave-de-ia-google-gemini)
7. [Passo 4: configurar e testar localmente](#7-passo-4-configurar-e-testar-localmente)
8. [Passo 5: publicar na internet (Vercel)](#8-passo-5-publicar-na-internet-vercel)
9. [Passo 6: adaptar para o seu órgão](#9-passo-6-adaptar-para-o-seu-órgão)
10. [Passo 7 (opcional): ativar o WhatsApp](#10-passo-7-opcional-ativar-o-whatsapp)
11. [Segurança e LGPD](#11-segurança-e-lgpd)
12. [Regras que não devem ser alteradas](#12-regras-que-não-devem-ser-alteradas)
13. [Manutenção do dia a dia](#13-manutenção-do-dia-a-dia)
14. [Solução de problemas](#14-solução-de-problemas)

---

## 1. Como a solução funciona

```
 Cidadão  ──►  WhatsApp ou Simulador web
                        │
                        ▼
              Servidor (Vercel)  ── api/mensagem  (simulador)
                        │         ── api/webhook   (WhatsApp)
                        ▼
  ┌──────────── ENTENDIMENTO (sem IA, previsível) ────────────┐
  │ 1. Normaliza o texto (minúsculas, sem acento)              │
  │ 2. Detecta a intenção (saudação, dúvida clínica, consulta) │
  │ 3. Busca no banco em 4 níveis (sinônimo, princípio ativo,  │
  │    semelhança por trigramas, prefixo)                      │
  │ 4. Decide: responder, perguntar qual opção, recusar ou     │
  │    informar que não encontrou                              │
  └────────────────────────────────────────────────────────────┘
                        │
                        ▼
              Banco de dados (Supabase): catálogo + estoque por unidade
                        │
                        ▼
  ┌──────────── REDAÇÃO (IA) ─────────────────────────────────┐
  │ O Gemini recebe SÓ o registro do banco e escreve a        │
  │ resposta. Se a IA falhar, entra um texto padrão.          │
  └────────────────────────────────────────────────────────────┘
```

**Princípio central:** a IA **nunca decide** se um medicamento existe ou está disponível. Quem decide é o banco de dados. A IA apenas redige a frase. Se a busca não encontra nada, a resposta é uma mensagem fixa e a IA nem é chamada.

**Tecnologias:** TypeScript sobre Node.js, PostgreSQL (Supabase), Google Gemini, hospedagem serverless na Vercel. Mais detalhes em [`CLAUDE.md`](../CLAUDE.md).

---

## 2. O que você precisa

### No computador
| Item | Para quê | Onde obter |
|---|---|---|
| **Node.js 22 ou superior** (recomendado 24) | Rodar o sistema | [nodejs.org](https://nodejs.org) (versão LTS) |
| **Git** | Copiar e versionar o projeto | [git-scm.com](https://git-scm.com) |
| Editor de texto (ex.: VS Code) | Editar configurações | [code.visualstudio.com](https://code.visualstudio.com) |

### Contas (todas com plano gratuito)
| Conta | Para quê |
|---|---|
| **GitHub** | Guardar a sua cópia do código |
| **Supabase** | Banco de dados |
| **Vercel** | Publicar o site (entre com a conta do GitHub) |
| **Google AI Studio** | Chave da IA Gemini (use uma conta Google) |
| Meta for Developers | Só se for ativar o WhatsApp ([seção 10](#10-passo-7-opcional-ativar-o-whatsapp)) |

> **Sobre os planos gratuitos:** servem bem para piloto e demonstração. Pontos de atenção para uso institucional contínuo:
> - no Supabase gratuito, projetos **sem uso por alguns dias podem ser pausados**. Basta reativá-los no painel;
> - o plano gratuito da Vercel (Hobby) é voltado a uso não comercial. Para produção oficial, confira os termos e avalie o plano pago;
> - o Gemini gratuito tem limite de requisições por minuto. Se estourar, o sistema responde com o texto padrão, sem falhar.

---

## 3. Teste rápido no seu computador (5 minutos, sem contas)

Antes de criar qualquer conta, veja a solução funcionando **offline**, com dados fictícios embutidos:

```bash
git clone https://github.com/grupo3fesp/farmacia.git
cd farmacia
npm start
```

Abra <http://localhost:3000>. Converse no simulador (ex.: `dipirona`, `metiformina 850`, `acido`) e altere o estoque no painel lateral para ver a resposta mudar.

> Nesse modo não é preciso `npm install` nem banco: o Node 24 executa o TypeScript direto. As respostas saem do texto padrão, sem IA.

Para rodar os testes automatizados:

```bash
npm install
npm test
```

---

## 4. Passo 1: copiar o projeto

Cada órgão precisa da **sua própria cópia** do código, porque é dela que a Vercel publica o site e é nela que você vai personalizar os textos.

1. Entre em <https://github.com/grupo3fesp/farmacia>.
2. Clique em **Fork** e crie a cópia na sua conta ou na organização do seu órgão.
3. Clone a **sua** cópia:
   ```bash
   git clone https://github.com/SEU-USUARIO/farmacia.git
   cd farmacia
   npm install
   ```

---

## 5. Passo 2: criar o banco no Supabase

### 5.1 Criar o projeto
1. Acesse <https://supabase.com/dashboard> → **New project**.
2. Dê um nome (ex.: `farmacia-municipal`), crie uma **senha forte do banco** e guarde-a.
3. Região: **South America (São Paulo)**.
4. Aguarde 1 a 2 minutos até o projeto ficar pronto.

### 5.2 Criar as tabelas e carregar os dados de exemplo
1. No menu lateral, abra **SQL Editor** → **New query**.
2. Abra o arquivo [`db/00_setup_completo.sql`](../db/00_setup_completo.sql) no seu editor, **copie todo o conteúdo** e cole no SQL Editor.
3. Clique em **Run**. Deve aparecer *Success*.

Esse arquivo cria tudo de uma vez: tabelas, busca inteligente, regras de segurança, indicadores, controle de sessão e uma base **fictícia** de exemplo (3 unidades, 48 medicamentos, 178 sinônimos).

> ⚠️ **Atenção:** o `00_setup_completo.sql` **apaga e recria** as unidades, o catálogo, o estoque e os sinônimos. Rode-o só na instalação. Depois disso, altere os dados como explicado na [seção 9](#9-passo-6-adaptar-para-o-seu-órgão).

**Conferência:** em **Table Editor**, as tabelas `unidades`, `medicamentos`, `estoques`, `sinonimos`, `consultas_log`, `sessoes` e `mensagens_vistas` devem aparecer. Para testar a busca, rode no SQL Editor:

```sql
select * from buscar_medicamento('zitromax');
```

Deve retornar a **Azitromicina**.

### 5.3 Copiar as chaves de acesso
Em **Project Settings → API Keys** (em alguns painéis: *Data API*), copie:

| O que copiar | Vai para a variável |
|---|---|
| **Project URL** (`https://xxxx.supabase.co`) | `SUPABASE_URL` |
| Chave **pública** (`anon` / *publishable*) | `SUPABASE_ANON_KEY` |
| Chave **secreta** (`service_role` / *secret*) | `SUPABASE_SERVICE_ROLE_KEY` |

> Se o painel mostrar uma aba **Legacy API keys**, as chaves `anon` e `service_role` (começam com `eyJ...`) são as que este projeto usou e testou.
> 🔒 A chave **secreta** dá acesso total ao banco. Ela fica **somente** no `.env` e nas variáveis da Vercel. Nunca a coloque no código, em planilhas ou em mensagens.

---

## 6. Passo 3: obter a chave de IA (Google Gemini)

1. Acesse <https://aistudio.google.com/app/apikey> com uma conta Google.
2. Clique em **Create API key** e copie a chave.

Use o modelo **`gemini-flash-lite-latest`**, que já vem como padrão: responde em cerca de 1 segundo. Evite os modelos "flash" com raciocínio ativado, que levam mais de 10 segundos e podem estourar o tempo limite do servidor.

> **Sem chave nenhuma, o sistema funciona do mesmo jeito**, com respostas em texto padrão. A IA só deixa a redação mais natural.
> Também é possível usar o Claude, da Anthropic (pago): `IA_PROVEDOR=anthropic` e `ANTHROPIC_API_KEY`.

---

## 7. Passo 4: configurar e testar localmente

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```
   (No Windows sem Git Bash: copie e renomeie o arquivo pelo Explorer.)

2. Abra o `.env` e preencha:

   | Variável | Valor |
   |---|---|
   | `MODO` | `demonstracao` (mostra o aviso de dados fictícios) ou `piloto` (com dados reais) |
   | `REPOSITORIO` | `supabase` |
   | `SESSAO` | `supabase` |
   | `SUPABASE_URL` | Project URL |
   | `SUPABASE_ANON_KEY` | chave pública |
   | `SUPABASE_SERVICE_ROLE_KEY` | chave secreta |
   | `IA_PROVEDOR` | `gemini` |
   | `GEMINI_API_KEY` | sua chave do Gemini |
   | `GEMINI_MODELO` | `gemini-flash-lite-latest` |
   | `SAL_SESSAO` | um texto aleatório longo (veja abaixo) |
   | `ADMIN_TOKEN` | uma senha para editar o estoque pelo painel (veja abaixo) |

   Para gerar valores aleatórios seguros para `SAL_SESSAO` e `ADMIN_TOKEN`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

3. Rode e teste:
   ```bash
   npm start
   ```
   Abra <http://localhost:3000>. Agora a busca consulta o **seu banco** e a resposta é redigida pela IA. No SQL Editor, `select * from consultas_log order by criado_em desc;` mostra o registro anônimo das consultas.

> O arquivo `.env` **não vai para o GitHub**: ele está no `.gitignore`. Nunca remova essa proteção.

---

## 8. Passo 5: publicar na internet (Vercel)

1. Acesse <https://vercel.com/new> e entre com o GitHub.
2. **Importe** a sua cópia do repositório `farmacia`.
3. Em **Framework Preset**, escolha **Other**. Deixe os demais campos como estão.
4. Antes de publicar, ou logo depois em **Settings → Environments → Production** (em alguns painéis: *Environment Variables*), cadastre **as mesmas variáveis do `.env`**:
   `MODO`, `REPOSITORIO`, `SESSAO`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `IA_PROVEDOR`, `GEMINI_API_KEY`, `GEMINI_MODELO`, `SAL_SESSAO`, `ADMIN_TOKEN`.
5. Clique em **Deploy**.
6. **Importante:** sempre que incluir ou alterar uma variável, vá em **Deployments → ⋯ (no deploy mais recente) → Redeploy**. Sem isso, a alteração não vale.
7. Para o site ficar aberto ao público: **Settings → Deployment Protection** → desative a *Vercel Authentication*.

### Checklist de validação
- [ ] O site abre no endereço da Vercel.
- [ ] `zitromax` retorna a Azitromicina com a situação por unidade.
- [ ] O horário de "última atualização" aparece no **horário de Brasília**.
- [ ] No painel de estoque, com o `ADMIN_TOKEN`, você zera um item, repete a pergunta e a resposta muda.
- [ ] Novas linhas aparecem em `consultas_log` no Supabase.

> Se o site responder com os dados fictícios do exemplo **mesmo depois** de você carregar os seus, as variáveis não foram aplicadas: faça o **Redeploy** (item 6).

---

## 9. Passo 6: adaptar para o seu órgão

Este é o passo que transforma o protótipo na solução do **seu** município. A base tem 4 tabelas de dados:

| Tabela | O que guarda | Modelo |
|---|---|---|
| `unidades` | Farmácias e UBS: nome, endereço, horário, telefone | [`docs/modelos/unidades.csv`](modelos/unidades.csv) |
| `medicamentos` | Catálogo: um registro por **apresentação** | [`docs/modelos/medicamentos.csv`](modelos/medicamentos.csv) |
| `estoques` | Quantidade de **cada** medicamento em **cada** unidade | [`docs/modelos/estoques.csv`](modelos/estoques.csv) |
| `sinonimos` | Nomes comerciais, apelidos e erros comuns | [`docs/modelos/sinonimos.csv`](modelos/sinonimos.csv) |

### 9.1 Preparar as planilhas

**`unidades`**
- `id`: código curto e único (ex.: `UN-01`). É o que liga a unidade ao estoque.
- `nome`: aparece na resposta ao cidadão (ex.: "Farmácia da UBS Centro").

**`medicamentos`** (um registro por apresentação: comprimido e gotas são registros diferentes)
- `codigo`: único (ex.: `MED-001`). Pode usar o código do seu sistema de estoque.
- `principio_ativo`: nome oficial (ex.: `Dipirona sódica`). Apresentações do mesmo remédio devem ter **exatamente o mesmo** princípio ativo.
- `apresentacao`: dose e embalagem (ex.: `500 mg/mL solução oral 10 mL`).
- `forma_farmaceutica`: ex. `Comprimido`, `Solução oral`, `Suspensão oral`, `Creme dermatológico`, `Solução injetável`.
- `componente`, `unidade_medida`, `tipo_receita`: informativos (ex.: `Básico`, `Frasco`, `Receita simples`).

**`estoques`**
- Cadastre **todos** os medicamentos em **todas** as unidades. Onde a unidade não tem o item, use `estoque_atual = 0`: o cidadão verá "em falta" naquela unidade, em vez de a unidade sumir da resposta.
- `estoque_minimo`: abaixo dele (ou igual), a resposta diz "estoque baixo". Acima, "disponível". Zero, "em falta". O banco calcula isso sozinho.

**`sinonimos`** (é o que faz a busca "entender" o cidadão)
- `codigo` + `termo`. A coluna `termo_norm` é recalculada pelo banco (minúsculas e sem acento); no modelo ela só repete o termo.
- **Regra de ouro para a desambiguação:** um termo **genérico** (nome do remédio ou marca, sem citar forma) deve ser cadastrado em **todas** as apresentações daquele remédio. Assim, `dipirona` leva o sistema a perguntar "comprimido ou gotas?" em vez de escolher sozinho.
- Um termo **específico** (que cita a forma) vai **só** na apresentação certa: `dipirona gotas`, `dipirona xarope`, `dipirona crianca` → só na solução oral.
- Inclua **termos populares de forma**: `xarope`, `pomada`, `bombinha`, `injecao`, `gotas`. Por exemplo, `paracetamol xarope` na solução oral e `salbutamol bombinha` no aerossol.
- Inclua **erros de digitação graves** que você conheça. Erros leves (`metiformina`, `omeprasol`) o sistema já reconhece sozinho por semelhança; os muito distantes (`jazepam` para Diazepam) precisam ser cadastrados.

> **Dica sobre CSV:** o importador do Supabase espera **vírgula** como separador e codificação **UTF-8**. O Excel em português costuma salvar com ponto e vírgula. Prefira o **Google Planilhas** (Arquivo → Fazer download → CSV) ou o LibreOffice (separador: vírgula).
> A planilha [`docs/base_ficticia_farmacia_municipal.xlsx`](base_ficticia_farmacia_municipal.xlsx) é a versão inicial da base fictícia, anterior ao estoque por unidade. Serve de referência para preencher o catálogo e os sinônimos.

### 9.2 Apagar os dados fictícios
No **SQL Editor**, rode:

```sql
truncate table public.estoques, public.sinonimos, public.medicamentos, public.unidades
  restart identity cascade;
truncate table public.consultas_log restart identity;
```

### 9.3 Importar as suas planilhas
Em **Table Editor**, abra cada tabela → **Insert → Import data from CSV**, **nesta ordem** (uma tabela depende da anterior):

1. `unidades`
2. `medicamentos`
3. `estoques`
4. `sinonimos`

Depois, teste no SQL Editor com termos do seu catálogo:

```sql
select * from buscar_medicamento('nome de um remédio seu');
select * from estoque_medicamento('MED-001');
```

### 9.4 Personalizar textos e identidade
| O quê | Onde |
|---|---|
| Mensagens fixas: boas-vindas, encaminhamento a atendente, "não localizei" | [`src/dominio/mensagens.ts`](../src/dominio/mensagens.ts) |
| Instruções de estilo para a IA | constante `SISTEMA` em [`src/dominio/redacao-ia.ts`](../src/dominio/redacao-ia.ts) |
| Título e cabeçalho do simulador | [`public/index.html`](../public/index.html) |
| Aviso de "dados fictícios" | `MODO=piloto` desliga o aviso (use só com dados reais) |

Depois de alterar qualquer arquivo em `src/`, gere as funções do servidor e envie para o GitHub. A Vercel publica sozinha:

```bash
npm test
npm run build
git add -A
git commit -m "Personaliza textos para o municipio X"
git push
```

> ⚠️ Os arquivos `api/*.js` são **gerados** pelo `npm run build` e **precisam ser enviados** junto: a Vercel usa esses arquivos diretamente. Esquecer o build é a causa mais comum de "mudei o código e nada aconteceu".

### 9.5 Manter o estoque atualizado
- **Manual:** pelo painel "Estoque (ao vivo)" do site, com o `ADMIN_TOKEN`, ou editando a tabela `estoques` no Supabase.
- **Automático (recomendado para produção):** o sistema de estoque do órgão pode atualizar a tabela `estoques` periodicamente pela API do Supabase, usando a chave secreta **no servidor do órgão**. A data da última atualização é registrada automaticamente e aparece na resposta ao cidadão.

---

## 10. Passo 7 (opcional): ativar o WhatsApp

O código do canal está **pronto e testado** (`/api/webhook`). Ativar o WhatsApp é trabalho de configuração na Meta, e o ponto decisivo é **institucional**, não técnico.

> 🇧🇷 **Leia antes de começar:** a Meta **só permite enviar mensagens para números brasileiros depois que a empresa passa pela Verificação de Negócio** (*Business Verification*). Sem ela, o sistema **recebe** as mensagens, mas as respostas falham com o erro **130497** (*"Business account is restricted from messaging users in this country"*). A verificação exige **documentos oficiais do órgão (CNPJ)** e leva alguns dias. Planeje-a com antecedência, em nome do órgão.

### 10.1 Configuração na Meta
1. <https://developers.facebook.com/apps> → **Criar app** → caso de uso **"Conectar-se com clientes pelo WhatsApp"** → crie ou vincule um **portfólio empresarial** do órgão.
2. Em **WhatsApp → Configuração da API (Etapa 1)**: anote o **Phone Number ID** e o **WhatsApp Business Account ID** (WABA). Clique em **Gerar token** e cadastre os números de teste (até 5) no campo **Destinatário**.
3. Na Vercel, cadastre e faça **Redeploy**:
   - `WHATSAPP_PHONE_NUMBER_ID` = Phone Number ID
   - `WHATSAPP_TOKEN` = token de acesso
   - `WHATSAPP_VERIFY_TOKEN` = uma senha que você inventar
4. Em **Configuração dos webhooks (Etapa 2)**:
   - URL de callback: `https://SEU-SITE.vercel.app/api/webhook`
   - Token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`
   - **Verificar e salvar**, e confira se o campo **`messages`** está como **Assinado**.

### 10.2 Armadilhas que encontramos (e como resolver)
| Sintoma | Causa | Solução |
|---|---|---|
| O webhook verifica, mas as mensagens reais **nunca chegam** ao sistema | O **seu app não está assinado na conta do WhatsApp (WABA)**: o painel às vezes deixa assinado só um app interno da Meta ("WA DevX Webhook Events") | Assine pela API (comando abaixo) |
| A API aceita o envio (`accepted`), mas nada chega | A conta está bloqueada para envio | Consulte o `health_status` (comando abaixo) e leia os erros |
| Erro **141006** no `health_status` | Falta **método de pagamento** na conta do WhatsApp | Cadastre um cartão no WhatsApp Manager → Faturamento |
| Erro **131000** | Perfil empresarial incompleto | Preencha razão social, país e site em business.facebook.com/settings → Informações da empresa |
| Erro **130497** / **141010** | Empresa **não verificada** (obrigatório para o Brasil) | Faça a Verificação de Negócio com o CNPJ do órgão |
| Erro **#131030** "not in allowed list" | No modo de teste, o número não está na lista de destinatários. Com números brasileiros, a Meta pode usar o formato **sem o 9º dígito** | Confira o número cadastrado. Com número oficial e empresa verificada, essa lista deixa de existir |
| Funciona hoje e para amanhã | O token gerado na tela dura **24 horas** | Crie um **token permanente** (abaixo) |

**Assinar o app na conta do WhatsApp** (troque `WABA_ID` e `TOKEN`):
```bash
curl -X POST "https://graph.facebook.com/v21.0/WABA_ID/subscribed_apps" -H "Authorization: Bearer TOKEN"
```
Confirme com o mesmo endereço usando `GET`: o nome do **seu** app deve aparecer na lista.

**Ver se o número pode enviar** (troque `PHONE_NUMBER_ID` e `TOKEN`):
```bash
curl "https://graph.facebook.com/v21.0/PHONE_NUMBER_ID?fields=health_status" -H "Authorization: Bearer TOKEN"
```
`can_send_message` precisa estar `AVAILABLE` ou `LIMITED`. Se estiver `BLOCKED`, os erros listados dizem o motivo.

**Token permanente:** business.facebook.com/settings → **Usuários do sistema** → Adicionar (Administrador) → **Atribuir ativos** (o app e a conta do WhatsApp, com controle total) → **Gerar token** → marque `whatsapp_business_messaging` e `whatsapp_business_management` → expiração **Nunca**. Coloque esse token em `WHATSAPP_TOKEN` e faça Redeploy.

> **Custos:** o sistema nunca inicia conversas, só responde ao cidadão. Até setembro de 2026 essas respostas eram gratuitas. Fontes do mercado indicam que a Meta passaria a cobrá-las a partir de **01/10/2026**, com valores de centavos por mensagem no Brasil. Confira a tabela vigente na aba de faturamento do WhatsApp Manager antes de decidir.
> Para testes sem conta Meta, há um roteiro com o Twilio em [`docs/05_whatsapp_twilio.md`](05_whatsapp_twilio.md).

---

## 11. Segurança e LGPD

- [ ] **Chave secreta do Supabase** e **token do WhatsApp** só no `.env` e na Vercel: nunca no código, no GitHub ou em conversas.
- [ ] O `.env` continua no `.gitignore`.
- [ ] `ADMIN_TOKEN` definido em produção, para que ninguém de fora edite o estoque.
- [ ] `SAL_SESSAO` forte, definido uma vez: o número do cidadão **nunca é gravado**. O sistema guarda só um código embaralhado (hash) derivado dele. Se o sal for trocado, os registros antigos e novos de um mesmo cidadão deixam de ser associáveis.
- [ ] A IA recebe **apenas o registro do medicamento e o estoque**. O texto e o número do cidadão **não são enviados** a ela.
- [ ] O `consultas_log` é anônimo: termo pesquisado, medicamento encontrado e situação. Serve para os indicadores do piloto.
- [ ] Use `MODO=demonstracao` enquanto houver dados fictícios. O aviso evita que alguém confie em quantidades de exemplo.
- [ ] O canal é **informativo**: não reserva, não prescreve, não orienta uso. Dúvidas clínicas são recusadas e encaminhadas a um profissional.

---

## 12. Regras que não devem ser alteradas

Ao personalizar, preserve estas garantias. Elas são o que torna a solução segura para um serviço de saúde:

1. **A IA nunca decide disponibilidade.** Ela só redige a partir do que o banco retornou.
2. **Busca vazia gera mensagem fixa**, sem chamar a IA.
3. **Sempre existe um texto padrão de reserva**: se a IA falhar ou demorar, a resposta sai do mesmo jeito.
4. **Termo ambíguo leva a uma pergunta ao cidadão**; o sistema não escolhe uma opção sozinho.
5. **Dúvida clínica é recusada** e encaminhada a um profissional.
6. **O estado de cada conversa é isolado por cidadão** (hash do remetente). Nunca guarde dados de conversa em variáveis globais.

Os testes automatizados (`npm test`) verificam várias dessas regras. Rode-os antes de cada publicação.

---

## 13. Manutenção do dia a dia

| Situação | O que fazer |
|---|---|
| Alterou código em `src/` ou `functions-src/` | `npm test` → `npm run build` → commit **incluindo `api/*.js`** → push |
| Alterou variável de ambiente na Vercel | **Redeploy** |
| Cidadãos usam um nome que o sistema não reconhece | Adicione o termo na tabela `sinonimos` (vale na hora, sem publicar de novo) |
| Novo medicamento no catálogo | Inclua em `medicamentos`, depois em `estoques` (todas as unidades) e em `sinonimos` |
| Nova unidade | Inclua em `unidades` e crie as linhas de `estoques` dela para todos os medicamentos |
| Alterou arquivos `db/*.sql` (desenvolvedores) | `npm run seed` (atualiza o modo offline) e `npm run setup-sql` (atualiza o `00_setup_completo.sql`) |
| Consultar os indicadores | SQL Editor: `select * from vw_indicadores;` e `select * from vw_mais_consultados;` |

---

## 14. Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Na Vercel: `ERR_MODULE_NOT_FOUND ... .ts` | As funções não foram geradas | `npm run build` e envie os `api/*.js` |
| Vercel: *"functions pattern doesn't match"* | Os `api/*.js` não estão no repositório | Rode o build e faça commit dos `api/*.js` |
| O site mostra os dados fictícios mesmo configurado | Variáveis sem Redeploy, ou `REPOSITORIO` ≠ `supabase` | Confira as variáveis e faça **Redeploy** |
| Editei o estoque e a resposta não mudou | `REPOSITORIO` ou `SESSAO` não estão como `supabase` | Ajuste as duas variáveis e faça Redeploy |
| Edição de estoque dá "token inválido" | `ADMIN_TOKEN` diferente do digitado no painel | Cole no painel exatamente o valor cadastrado na Vercel |
| Resposta demora mais de 10 s ou vem em texto padrão | Modelo Gemini lento (com raciocínio) ou limite gratuito atingido | Use `gemini-flash-lite-latest` |
| "Não localizei" para um remédio que existe | Falta sinônimo, ou o nome está muito diferente do cadastrado | Cadastre o termo em `sinonimos` |
| O sistema escolhe uma apresentação em vez de perguntar | O termo genérico não está em **todas** as apresentações | Cadastre o termo genérico em todas (seção 9.1) |
| Uma unidade não aparece na resposta | Falta a linha em `estoques` para ela | Crie a linha com `estoque_atual = 0` se não houver o item |
| Projeto do Supabase não responde | Plano gratuito pausado por inatividade | Reative no painel do Supabase |
| WhatsApp não responde | Veja a [seção 10.2](#102-armadilhas-que-encontramos-e-como-resolver) | |

---

### Estrutura do projeto (referência rápida)

```
db/                  scripts do banco (00_setup_completo.sql = instalação em um passo)
docs/                manuais e modelos de planilha (docs/modelos/*.csv)
public/index.html    simulador web
functions-src/       fontes das funções do servidor
api/                 funções GERADAS pelo npm run build (enviar ao GitHub)
src/dominio/         regras do atendimento (decisão, busca, sessão, mensagens, IA)
src/dados/           acesso ao banco (Supabase) e modo offline
scripts/             geradores (seed, setup completo, sinônimos)
tests/               testes automatizados (npm test)
```

**Dúvidas?** Consulte o [`CLAUDE.md`](../CLAUDE.md), que tem a documentação técnica completa, ou fale com a equipe do Grupo 3 (FESP), autora do protótipo.
