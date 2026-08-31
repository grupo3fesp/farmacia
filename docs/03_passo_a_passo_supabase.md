# Supabase — passo a passo para o protótipo

## 1. Criar o projeto

1. Acesse supabase.com e crie um projeto novo.
2. Nome sugerido: `farmacia-municipal-prototipo`.
3. Região: **South America (São Paulo)** — menor latência e dado em território nacional, o que evita discussão desnecessária sobre transferência internacional já na demonstração.
4. Guarde a senha do banco em local seguro. Ela não é usada pelo protótipo, mas é necessária para acesso direto.

## 2. Criar as tabelas

No painel, abra **SQL Editor → New query**, cole o conteúdo de `01_schema_supabase.sql` e execute.

Isso cria:

| Objeto | Função |
|---|---|
| `unidades` | Farmácias e horários |
| `medicamentos` | Posição de estoque; a coluna `situacao` é calculada pelo banco |
| `sinonimos` | Termos que o cidadão digita → código do medicamento |
| `consultas_log` | Registro anônimo dos atendimentos |
| `buscar_medicamento()` | Função de busca em três níveis |
| `vw_indicadores` | Indicadores do piloto |

## 3. Carregar os dados fictícios

Nova query, cole `02_seed_dados_ficticios.sql` e execute. Devem entrar 3 unidades, 48 medicamentos e 134 sinônimos.

Confira com:

```sql
select situacao, count(*) from public.medicamentos group by situacao;
```

Esperado: 38 disponíveis, 5 com estoque baixo, 5 em falta.

## 4. Testar a busca antes de codificar qualquer tela

```sql
select * from public.buscar_medicamento('novalgina');   -- nome comercial
select * from public.buscar_medicamento('metiformina'); -- erro de digitação
select * from public.buscar_medicamento('bombinha');    -- apelido popular
select * from public.buscar_medicamento('xpto123');     -- deve voltar vazio
```

O último caso é o mais importante: **retorno vazio significa que a aplicação responde com a mensagem padrão e não chama o modelo de linguagem**. É o que impede a IA de inventar disponibilidade.

## 5. Pegar as credenciais

Em **Settings → API**:

- **Project URL** e **anon key** → vão no simulador. Podem ficar visíveis no navegador; a RLS já bloqueia escrita.
- **service_role key** → **nunca** no código do simulador. Só para tarefas administrativas da equipe.

## 6. Conectar o protótipo

Chamada da função pelo cliente JavaScript:

```js
const { data, error } = await supabase
  .rpc('buscar_medicamento', { p_termo: mensagemDoCidadao, p_limite: 5 });

if (error || !data || data.length === 0) {
  responder(MENSAGEM_PADRAO_NAO_ENCONTRADO);   // sem passar pela IA
} else if (data.length > 1 && data[0].semelhanca === data[1].semelhanca) {
  responder(perguntaDeDesambiguacao(data));     // duas apresentações do mesmo item
} else {
  const resposta = await redigirComIA(data[0]); // IA recebe só este registro
  responder(resposta);
}
```

Registro do atendimento:

```js
await supabase.from('consultas_log').insert({
  sessao_hash: hashAnonimo,
  termo_digitado: mensagemDoCidadao,
  codigo_encontrado: data?.[0]?.codigo ?? null,
  situacao_retornada: data?.[0]?.situacao ?? null,
  encaminhado_humano: false
});
```

## 7. Alteração ao vivo na apresentação

Deixe o SQL Editor aberto numa aba. Durante a demonstração:

```sql
update public.medicamentos set estoque_atual = 0 where codigo = 'MED-001';
```

Repita a pergunta "tem dipirona?" no simulador. A resposta muda na hora. Para restaurar:

```sql
update public.medicamentos set estoque_atual = 4820 where codigo = 'MED-001';
```

## 8. Antes de apresentar

- [ ] Os quatro testes do passo 4 rodando
- [ ] Aviso de "dados fictícios" visível na tela do simulador
- [ ] Alteração ao vivo testada e restaurada
- [ ] Vídeo de backup gravado, caso a internet do auditório falhe
- [ ] `service_role key` confirmadamente fora do código

## 9. O que muda no piloto real

| Item | Protótipo | Piloto |
|---|---|---|
| Origem dos dados | Seed manual | Carga periódica do sistema oficial de estoque |
| Escrita na base | Nenhuma | Rotina de sincronização com chave de serviço |
| Log | Sem identificação | Mantido sem identificação, com política de retenção definida |
| Acesso | Chave anon pública | Backend próprio; a chave deixa de ficar no navegador |
| Hospedagem | Plano gratuito | Avaliar plano pago, contrato e cláusulas de tratamento de dados (LGPD) |

Um ponto para o TR: no piloto, a decisão sobre hospedar em serviço externo precisa de posicionamento formal da área de TI e do encarregado de dados do município, mesmo o sistema não tratando dados pessoais do cidadão. Melhor levantar isso agora do que na véspera da implantação.
