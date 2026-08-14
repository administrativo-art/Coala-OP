# Plano de integração Stone — v2 (reordenado)

**Mudança estrutural desta versão:** a conciliação sai do caminho crítico do fluxo de caixa. Projeção depende da **agenda de recebíveis**; DRE e controle de perdas dependem da **conciliação**. São trilhos distintos, e o primeiro entrega valor antes.

## Decisões já tomadas

- O fluxo deve preservar o valor bruto da venda, o MDR, o valor líquido e os eventos posteriores como informações distintas.
- A liquidação aumenta o saldo da **conta Stone**; não gera crédito automático no Inter.
- **O Inter é a conta operacional única.** Todo pagamento a terceiros sai de lá.
- **A conta Stone é conta de passagem:** entra por liquidação, sai por transferência. Nenhum pagamento a terceiros sai dela. *Se essa premissa deixar de valer, a Fase 4 e o modelo de contas precisam ser revistos.*
- Transferência Stone → Inter é transferência entre contas próprias: sem efeito na DRE nem no caixa consolidado — **salvo se houver tarifa**, a confirmar.
- MDR é classificado em `Financeiro > Taxas de cartão`, na posição `despesas_financeiras` da DRE.
- Taxa de antecipação é classificada em `Financeiro > Taxas de antecipação de recebíveis`, também em `despesas_financeiras`.
- A existência da conta contábil não significa que a API forneça o valor da taxa de antecipação. A origem desse valor precisa ser comprovada pelo spike.
- Recebíveis serão append-only na camada de eventos, com uma projeção do estado atual no documento pai.
- Valores financeiros novos devem ser processados internamente em centavos inteiros.

## Fase 0 — Acesso e contrato da API

Confirmar:

- credenciais e escopo dos três Stonecodes;
- endpoint de autenticação e formato da requisição;
- endpoints e parâmetros para download dos arquivos;
- TTL do token, renovação e possibilidade de cache;
- paginação, limite de datas e rate limits;
- existência de endpoint para arquivos complementares da Registradora;
- existência de endpoint de saldo, extrato e transferências da conta Stone;
- existência de transferência automática programável, como varredura para o Inter;
- existência de tarifa na transferência Stone → Inter;
- identificadores disponíveis tanto na saída da conta Stone quanto no crédito correspondente no Inter;
- forma de distinguir arquivo vazio, indisponível e ainda não processado.

Pronto quando a forma das requisições estiver documentada, sem registrar chaves ou segredos.

## Fase 1 — Spike com XML real

Criar `scripts/stone-conciliacao-test.mjs` com as seguintes características:

- leitura das credenciais em `.env.local`;
- nenhuma gravação em Firestore ou Storage;
- geração e reutilização do token durante a execução;
- download do arquivo de D-1;
- consulta opcional de uma data conhecida com antecipação;
- XML bruto salvo somente em `/tmp`, com acesso restrito;
- geração de `report.json` e `report.md`;
- geração de fixture anonimizada determinística, sem dados reais no repositório.

### As 14 perguntas

1. Existem recebíveis com data de liquidação futura?
2. Quais tipos distintos existem em `FinancialEvents`?
3. Como uma antecipação e seu custo aparecem na API ou no arquivo?
4. Qual campo é uma chave estável em 100% dos registros?
5. PIX aparece no arquivo Stone ou apenas no extrato bancário?
6. Bruto, MDR e líquido vêm separados por transação ou agregados no pagamento? Se agregados, existe quebra por bandeira ou produto?
7. Quais são os limites de paginação, intervalo de datas e chamadas?
8. Qual fuso horário é usado nas datas e como funciona a fronteira do dia?
9. Como diferenciar arquivo vazio de arquivo indisponível?
10. Existe identificador estável do lote de pagamento?
11. Qual é a precisão monetária e como ela será convertida para centavos inteiros?
12. A API permite consultar saldo, extrato e transferências realizadas na conta Stone?
13. Qual referência permite conciliar uma transferência iniciada pelo usuário na Stone com o crédito correspondente no Inter?
14. A liquidação futura vem com granularidade suficiente para agregação semanal, com data e valor líquido por recebível?

### Decisão obrigatória sobre a taxa de antecipação

O spike não deve presumir a existência de um campo como `anticipationFee`. Para uma data em que se saiba que houve antecipação, o relatório deve classificar o resultado em exatamente um destes cenários:

1. `EXPLICIT`: a taxa vem em campo ou evento próprio, com referência estável;
2. `DERIVABLE`: a taxa pode ser calculada de forma inequívoca pela diferença entre o valor originalmente devido, já líquido das demais taxas, e o valor antecipado;
3. `COMPLEMENTARY_FILE`: a informação existe apenas em arquivo ou endpoint complementar da Registradora;
4. `NOT_AVAILABLE`: não existe evidência suficiente para apurar a taxa com segurança.

`DERIVABLE` só é aceito se a derivação fechar para 100% dos registros do dia. Um centavo inexplicado rebaixa a classificação para `NOT_AVAILABLE`. Enquanto essa classificação não estiver comprovada, a integração não deve criar lançamentos automáticos em `Taxas de antecipação de recebíveis`. Diferenças não explicadas também não podem ser classificadas automaticamente como taxa de antecipação.

Cada resposta do relatório deve separar fato observado, evidência no XML, inferência e questão ainda não respondida. O script deve distinguir pelo menos os estados `EMPTY_SUCCESS`, `NOT_AVAILABLE`, `PARSE_ERROR` e `AUTH_ERROR`.

Pronto quando as quatorze respostas estiverem documentadas. A pergunta 4 bloqueia a Fase 2; as perguntas 1 e 14 bloqueiam a Fase 4. A ausência de origem segura para a taxa de antecipação bloqueia somente sua contabilização automática. Se a API não fornecer o extrato ou uma referência estável da transferência, a conciliação Stone para Inter deverá assumir fluxo manual assistido, nunca vínculo automático presumido.

## Fase 2 — Schema baseado no XML

### Arquivos e ingestões

Usar `stoneIngestionRuns/{runId}` para registrar Stonecode, data-fonte, checksum, arquivo vigente, `supersedes`, status, contagens, erros e horários de download e processamento.

O XML deve ser imutável no Storage, sem leitura pelo cliente e com política de retenção definida, pois pode conter PAN truncado e dados de portador:

```text
stone/{stonecode}/{sourceDate}/{sha256}.xml
```

### Recebíveis

```text
receivables/{key}
  estado atual
  lastSourceDate
  lastSourceRevision

receivables/{key}/events/{sourceDate}__{eventHash}
  estado observado no arquivo
  sourceDate
  sourceChecksum
  ingestedAt
```

A subcoleção registra o que cada arquivo afirmou. A projeção do pai deve ser ordenada pela data e revisão do arquivo, nunca por `ingestedAt`.

A chave preferencial é `stonecode + referência estável + parcela`. Um fallback só pode usar campos comprovadamente imutáveis, como data da venda, NSU ou autorização, parcela e adquirente. Valor, MDR e status não podem compor a identidade.

Também serão avaliadas as coleções `stoneEvents`, com chave determinística própria para evitar duplicação de eventos como aluguel de POS, `stoneAccountEntries`, `bankStatementEntries`, `reconciliationLinks` e `internalTransferLinks`, com cardinalidade N:N para transferências parciais e créditos agrupados, além de permissões e regras. A conta Stone deve ser representada como conta financeira própria, preferencialmente no modelo de contas já existente se ele suportar saldo, extrato e transferências sem adaptações frágeis. Índices só serão definidos depois das consultas reais.

## Fase 3 — Client de produção

- cache de token por credencial e Stonecode, com renovação antecipada pelo TTL;
- proteção contra renovações simultâneas;
- XML salvo no Storage antes do parse;
- idempotência por Stonecode, data-fonte e checksum;
- retry com backoff;
- logs sem segredos ou dados financeiros sensíveis.

Pronto quando uma execução para o Tirirical conferir linha a linha com o portal Stone.

## Fase 4 — Fluxo de caixa projetado

Primeiro entregável de valor. Depende da agenda confiável, não da conciliação.

**Projeção principal: o Inter**, porque é onde vencem folha, DAS e fornecedores.

Três saldos separados:

- disponível na Stone;
- disponível no Inter;
- consolidado.

A agenda prevê disponibilidade **na Stone**, não no Inter. A ponte é a política de transferência definida pela Fase 0:

| Cenário | Efeito na projeção |
|---|---|
| Varredura automática diária | Inter derivável diretamente da agenda |
| Transferência agendada | Regra configurada no sistema |
| Manual e discricionária | Programação manual e KPI de vigilância |

Antecipados nunca permanecem em “a receber”. Recebíveis na Registradora seguem a fonte complementar.

KPIs:

- saldo Stone;
- saldo Inter;
- saldo consolidado;
- recebíveis não liquidados;
- valor liquidado aguardando transferência;
- tempo médio entre liquidação e transferência;
- menor saldo projetado por conta e no consolidado.

Pronto quando a projeção de 13 semanas do Inter rodar para o Tirirical e for conferida contra o saldo real por quatro semanas.

> Dado ainda não conciliado. A projeção é útil desde já; os efeitos Stone no DRE só ficam aptos a virar padrão após a Fase 6.

## Fase 5 — Conciliação cruzada

Três estágios independentes:

1. vendas do PDV para transações Stone;
2. transações e parcelas Stone para liquidação e saldo na conta Stone;
3. débito de transferência na Stone para crédito no Inter.

O lote explica como vendas formaram saldo na Stone. Ele não deve ser ligado diretamente ao crédito no Inter, pois o usuário pode transferir vários lotes, valores antigos ou apenas parte do saldo.

O terceiro estágio prioriza uma referência forte compartilhada. Sem ela, valor exato e janela de data podem gerar uma sugestão, mas sempre pendente de confirmação.

| Teste | Tolerância |
|---|---:|
| Líquido previsto versus liquidação na Stone | até R$ 0,05 |
| Débito de transferência versus crédito Inter, condicionado à pergunta 12 | até R$ 0,05 |
| Transações Stone sem venda no PDV | até 2% da contagem |
| Vendas em cartão no PDV sem contrapartida Stone | até 2% da contagem |

Vendas em espécie ficam fora desses testes até os lotes de depósito existirem. Não é necessário distribuir cada transferência entre as vendas de origem.

Pronto quando dez dias consecutivos estiverem dentro das tolerâncias aplicáveis.

## Fase 6 — Contabilização e DRE

```text
Receita bruta                         R$ 100
(-) Taxas de cartão — MDR              R$ 3
Liquidação líquida na conta Stone     R$ 97
```

Com antecipação de R$ 2:

```text
Líquido antes da antecipação          R$ 97
(-) Taxas de antecipação               R$ 2
Liquidação antecipada na Stone        R$ 95
```

Transferência ao Inter, quando não houver tarifa:

```text
Saída Stone                            R$ 95
Entrada Inter                          R$ 95
Efeito no caixa consolidado             R$ 0
Efeito na DRE                            R$ 0
```

Se houver tarifa na transferência, o principal continua sendo transferência interna, enquanto a tarifa deve ser registrada separadamente como despesa financeira e redução real do caixa consolidado.

Bruto e MDR são reconhecidos na competência da liquidação; só o líquido aumenta o saldo Stone. Antecipação só é contabilizada automaticamente se classificada como `EXPLICIT`, `DERIVABLE` ou `COMPLEMENTARY_FILE` com vínculo confiável. Aluguel de POS terá conta própria. Chargeback será estorno de receita se a competência estiver aberta e perda na competência atual se estiver fechada, sem reabrir DRE encerrada.

Pronto quando o antes e depois de um mês fechado forem comparados e aprovados.

## Fase 7 — Automação e backfill

- sincronização diária D-1 com `onSchedule`;
- credenciais no Secret Manager;
- configuração `{ kioskId, stonecode, clientKeyRef, secretKeyRef }`;
- estados separados para arquivo vazio, indisponível e com erro.

O backfill será um job separado, com throttle, retry, marcador de progresso, retomada segura, idempotência e relatório de falhas. A implantação começa pelo Tirirical e só depois avança para João Paulo e demais unidades.

## Fase 8 — Interface

Adicionar ao Financeiro:

- Agenda de recebíveis;
- Eventos Stone;
- saldo e extrato da conta Stone;
- execuções de ingestão;
- conciliação de transferências;
- divergências Stone versus PDV;
- casamentos manuais;
- histórico e estados dos arquivos.

A tela mínima de projeção pode ser entregue junto da Fase 4, sem esperar esta fase.

## Caminho crítico

```text
                                      ┌─> Projeção (valor de caixa)
Acesso -> Spike -> Schema -> Client --┤
                                      └─> Conciliação -> DRE (valor contábil)
```

- As perguntas 1 e 14 liberam a projeção.
- A pergunta 4 libera o schema de recebíveis.
- A pergunta 3 define o tratamento da antecipação.
- A pergunta 10 define a força da conciliação interna da Stone.
- As perguntas 12 e 13 definem se a transferência é conciliada automaticamente ou de forma assistida.
- As perguntas sobre varredura e tarifa definem a ponte Stone → Inter na projeção.
