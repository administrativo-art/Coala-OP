# Plano consolidado de conciliação financeira e integração Stone — v6

**Status:** contrato consolidado para implementação incremental

**Competência inicial do backfill:** agosto de 2026

**Unidades canônicas encontradas no sistema:** Shopping do Automóvel, Tirirical e João Paulo. O vínculo técnico será sempre por `kioskId`. “Whopping” aparece somente nas versões anteriores deste plano e permanece como possível alias de negócio; não será criado um quarto cadastro nem usado como chave sem confirmação explícita.

**Fuso operacional:** `America/Belem`

**Premissa de reaproveitamento:** fechamento de caixa, sangrias, suprimentos, contagem física, malotes/lotes de depósito, depósitos, cobrança no Inter, obrigações financeiras, vínculos de pagamentos, solicitações bancárias, lançamentos financeiros, conciliação de extratos e a tela de fluxo de caixa já existem e permanecem como capacidades oficiais. Este plano não cria módulos, coleções ou fluxos paralelos; apenas evolui e integra os contratos existentes à conciliação de receitas e à Stone.

**Fontes de verdade:** o código e os documentos de rollout descrevem o contrato atualmente implementado. Planos anteriores permanecem como histórico e contexto, mas não autorizam reimplementar capacidades já existentes. Esta v6 substitui as versões v3, v4 e v5 deste plano como referência de execução.

## 1. Objetivo

Construir uma trilha financeira auditável que conecte:

1. vendas e formas de pagamento do PDV Legal;
2. vendas aprovadas no painel de Vendas da Stone;
3. resultados dos módulos existentes de fechamento de caixa e contagem física;
4. sangrias, suprimentos, malotes/lotes e depósitos já registrados pelo sistema;
5. agenda de recebíveis da Stone;
6. liquidações realizadas na conta Stone;
7. transferências da conta Stone para o Banco Inter;
8. obrigações, solicitações, agendamentos e pagamentos já registrados;
9. DRE por competência e fluxo de caixa previsto/realizado.

O resultado deve permitir consultar cada unidade isoladamente e o consolidado das três unidades, sem misturar venda, recebimento e movimentação interna.

## 2. Visões financeiras e fontes

| Informação | Fonte primária | Data usada | Destino |
|---|---|---|---|
| Receita pelo PDV | PDV Legal | data da venda | DRE — critério PDV Legal |
| Receita conciliada | PDV + Stone Vendas + caixa classificado | data da venda | DRE — critério Receita conciliada |
| Taxa Stone/MDR | Stone | competência da venda | DRE, em conta própria |
| Taxa de antecipação | Stone, quando comprovada | data do evento de antecipação | DRE, em conta própria |
| Recebível líquido previsto | Agenda Stone | data prevista de liquidação | Fluxo de caixa previsto |
| Recebimento líquido realizado | Liquidação/extrato Stone | data efetiva | Fluxo de caixa realizado |
| Saída prevista | `financialObligations` + despesa/previsão vigente | data de vencimento ou programação | Fluxo de caixa previsto |
| Saída agendada | `bankPaymentRequests` + vínculo da obrigação | data agendada confirmada | Fluxo de caixa previsto |
| Saída realizada | `transactions` + `obligationPaymentLinks` | data efetiva | Fluxo de caixa realizado |
| Sangria | Módulo existente de fechamento/PDV | data da movimentação | Transferência interna; sem DRE |
| Perda de caixa | Fechamento + classificação aprovada | competência do fechamento | Despesa operacional |
| Depósito de numerário | Módulo existente de depósitos + extrato bancário | data efetiva | Transferência interna; sem DRE |

Regra central:

```text
venda != recebível != recebimento != saldo da gaveta
previsão != despesa real != solicitação != agendamento != pagamento
```

### 2.1 Matriz de contratos canônicos

| Domínio | Fonte/contrato canônico | Estado | Não deve ser usado como substituto |
|---|---|---|---|
| Venda e pagamento PDV | PDV Legal + projeção `pdvPaymentFacts` | projeção nova | fechamento físico ou extrato bancário |
| Venda Stone | `stoneSaleTransactions` | novo | liquidação ou crédito bancário |
| Conciliação de vendas | `salesReconciliationCases` | novo | alteração do PDV ou da Stone |
| Fechamento e numerário | `cashClosures`, `cashCountingSessions`, `cashDepositBatches` | existente/publicado | cópia dentro da conciliação de receitas |
| Movimento bancário efetivo | `transactions` + `bankStatementEvents` | existente | `stoneSettlements`, solicitação ou pagamento informado duplicado |
| Obrigação e saldo a pagar | `financialObligations` | existente | soma independente de previsão, despesa e pagamento |
| Vínculo de pagamento | `obligationPaymentLinks` + `paymentAdjustments` | existente | nova coleção `expensePaymentLinks` |
| Processo bancário de saída | `bankPaymentRequests` | existente; rollout Inter condicionado | autorização bancária ou evidência de liquidação |
| Recebível e liquidação Stone | `stoneReceivables` + `stoneSettlements` | novo | transação bancária duplicada |
| Receita mensal | `revenueMonthlySummaries` | novo e reconstruível | agregação de transações na DRE |
| Previsão de caixa | serviço de composição limitado a 91 dias | novo e reconstruível | segundo livro-caixa persistente |

### 2.2 Mapeamento inicial de unidades

Preflight somente leitura executado em 15/09/2026 no banco principal:

| Unidade canônica | `kioskId` | Filial PDV | Cadastro central |
|---|---|---|---|
| Shopping do Automóvel | `EzISBSwIv3mIH4mRXPGT` | `39033` | `kPRLQ14F7XpzSLUFXGyO` |
| Tirirical | `tirirical` | `17343` | `pvLHa7BtW826JmhMkTJA` |
| João Paulo | `joao-paulo` | `17344` | `WRyOCQrPPQIn4wJJTXaQ` |

Não foi encontrado cadastro chamado “Whopping” em `kiosks`, `dp_units` ou `resultCenters`. Até decisão de negócio em contrário, toda integração da terceira unidade apontará para o `kioskId` de Shopping do Automóvel e exibirá o nome canônico atual.

## 3. Decisões de negócio já estabelecidas

- O painel **Vendas da Stone** deve ser conciliado com `Pix + débito + crédito` do PDV, sempre pelo valor bruto, pela unidade e pela data da venda.
- O painel **Recebimentos da Stone** não é comparado diretamente às vendas do mesmo mês. Parcelamento, prazo, antecipação, taxa, chargeback e calendário de liquidação tornam as bases diferentes.
- O valor líquido depositado pela Stone não substitui a Receita Bruta da DRE.
- Uma divergência nunca altera a receita automaticamente. Ela precisa de evidência, classificação, e, nos casos manuais, usuário e justificativa.
- Falta de caixa confirmada é despesa operacional; não é redução da receita.
- Sangria e suprimento são transferências de numerário; não são receita ou despesa.
- Venda não registrada encontrada na Stone ou no dinheiro físico pode ajustar a receita conciliada, mas não altera silenciosamente o PDV ou a escrituração fiscal.
- O Inter permanece como conta operacional única para pagamentos a terceiros.
- A conta Stone é conta de passagem: recebe as liquidações e transfere recursos ao Inter. Se pagamentos a terceiros passarem a sair da Stone, o modelo de contas e a projeção deverão ser revistos.
- Transferência Stone → Inter e depósito de numerário em conta própria têm efeito zero na DRE e no caixa consolidado, salvo tarifas identificadas separadamente.
- Valores financeiros novos serão processados em centavos inteiros.
- Eventos importados são imutáveis; projeções e resumos podem ser reconstruídos a partir deles.
- Caixa, sangria e depósito não serão reimplementados dentro da conciliação de receitas. A nova interface exibirá seus resultados e abrirá o registro original quando for necessária uma correção.
- A conciliação bancária existente será a única porta para movimentos de extrato. A Stone entrará como nova origem/adaptador, sem um segundo livro-caixa ou uma segunda fila bancária.
- `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments` e `bankPaymentRequests` são os contratos oficiais para acompanhar saídas. A integração Stone e a previsão de caixa não criarão uma segunda identidade de obrigação nem vínculos paralelos.
- No fluxo de caixa, as representações de uma mesma obrigação se substituem na ordem `transação realizada > agendamento bancário > despesa real > previsão`; elas nunca são somadas como saídas independentes.
- O nome exibido de uma unidade não é chave de conciliação. Stonecode, terminal, recebível, fechamento, centro de resultado e projeção devem convergir para IDs canônicos documentados.
- O fluxo de depósito de numerário hoje implementado usa uma cobrança de entrada do Inter. O produto continuará chamando a operação pelo nome operacional adotado, mas o contrato técnico não a confundirá com uma API bancária de depósito físico.
- As contas `Taxas de cartão` e `Taxas de antecipação de recebíveis` já existentes serão reutilizadas. Somente a conta específica para `Quebras e diferenças de caixa` poderá ser criada, após preflight que comprove sua ausência.

## 4. Diagnóstico do sistema atual

### 4.1 Receita da DRE

A DRE atualmente prioriza `cashClosureMonthlySummaries` quando existe fechamento e usa o relatório de vendas apenas como fallback. O resumo do fechamento calcula a receita como:

```text
expectedTotalCents + finalizedDifferenceTotalCents
```

Referências:

- [`src/features/financial/pages/dre-page.tsx`](../src/features/financial/pages/dre-page.tsx)
- [`src/features/financial/cash-closures/summary-counts.ts`](../src/features/financial/cash-closures/summary-counts.ts)

Esse contrato mistura receita com posição física do caixa. Deve ser corrigido antes de a Receita conciliada se tornar uma opção oficial.

### 4.2 Pix e cartões no fechamento

Pix, débito e crédito são hoje marcados como conferidos automaticamente com o próprio valor do PDV. Não existe validação independente com o painel de Vendas da Stone.

Referências:

- [`src/features/financial/cash-closures/channel-normalization.ts`](../src/features/financial/cash-closures/channel-normalization.ts)
- [`src/features/financial/cash-closures/build-cash-closure.ts`](../src/features/financial/cash-closures/build-cash-closure.ts)

### 4.3 Pagamentos do PDV

O parser atual preserva cupom, operador, horário, forma de pagamento e valor, mas não projeta cada pagamento no banco financeiro nem extrai identificadores Stone como NSU, número de autorização ou TID quando existirem no payload bruto.

Referência:

- [`src/features/financial/cash-closures/pdv-coupon-parser.ts`](../src/features/financial/cash-closures/pdv-coupon-parser.ts)

### 4.4 Caixa, sangrias e depósitos existentes

O sistema já captura sangrias e suprimentos vindos do PDV, calcula o saldo esperado da gaveta, registra a contagem física, cria malotes/lotes de depósito, confirma depósitos, registra sua cobrança no Inter e valida a reconciliação entre fechamento, lote, depósito e lançamento financeiro. Esses contratos continuam responsáveis pela movimentação e pela cadeia de evidências do numerário.

O problema remanescente para a DRE é mais restrito: o resumo atual incorpora a diferença final de caixa à receita. A integração nova deve consumir os IDs, totais e estados dos registros existentes e permitir classificar contabilmente a diferença do fechamento, sem recriar sangria, custódia ou depósito.

Referências:

- [`src/features/financial/cash-closures/pdv-cash-movements.ts`](../src/features/financial/cash-closures/pdv-cash-movements.ts)
- [`src/features/financial/cash-closures/build-cash-closure.ts`](../src/features/financial/cash-closures/build-cash-closure.ts)
- [`src/features/financial/cash-closures/repository.server.ts`](../src/features/financial/cash-closures/repository.server.ts)
- [`src/features/financial/cash-deposits/reconciliation.ts`](../src/features/financial/cash-deposits/reconciliation.ts)

### 4.5 Conciliação bancária existente

A sincronização do extrato Inter e a importação OFX/CSV já implementam a conciliação bancária: cursor/overlap, idempotência, sessões de importação, lançamentos bancários, sugestões, vínculo com origem, estados de reconciliação e auditoria. A Stone deve entrar nessa mesma capacidade por um adaptador `stone_api`, após a separação do núcleo hoje específico do Inter.

Somente movimentos efetivos do extrato da conta Stone entram nessa conciliação. Vendas Stone e parcelas a receber pertencem aos domínios próprios de vendas e recebíveis. Uma liquidação Stone será vinculada ao lançamento bancário existente, e não copiada como uma segunda entrada de caixa.

Referência:

- [`src/features/financial/inter-statement-sync.server.ts`](../src/features/financial/inter-statement-sync.server.ts)
- [`src/features/financial/pages/import-page.tsx`](../src/features/financial/pages/import-page.tsx)

### 4.6 Fluxo de caixa existente

O sistema já possui `Financeiro > Fluxo de caixa`, protegido pelas permissões de fluxo financeiro. A tela combina `transactions` e pagamentos realizados com despesas abertas, permitindo filtrar por conta e consultar realizado e previsto.

Hoje, porém:

- o período disponível olha o mês atual e meses anteriores, não as próximas 13 semanas;
- a previsão contém saídas de despesas abertas, mas ainda não contém entradas futuras da agenda Stone;
- o “saldo realizado” é o resultado das entradas menos saídas dentro do período filtrado, iniciado em zero, e não o saldo bancário real no começo da projeção;
- as coleções são carregadas de forma ampla e filtradas no cliente, contrato que não deve ser ampliado com o volume da Stone;
- não existem cobertura da fonte, revisão da previsão, atraso de recebível nem eliminação explícita das transferências entre Stone, Inter e numerário físico na projeção futura.

A implementação deve evoluir essa tela e suas permissões existentes, sem criar outro módulo de fluxo de caixa.

Referências:

- [`src/features/financial/pages/cash-flow-page.tsx`](../src/features/financial/pages/cash-flow-page.tsx)
- [`src/features/financial/lib/cash-flow-analysis.ts`](../src/features/financial/lib/cash-flow-analysis.ts)

### 4.7 Obrigações e pagamentos existentes

O sistema já implementa uma identidade financeira estável e relações N:N entre obrigações, despesas, pagamentos informados e transações bancárias. Os contratos canônicos são `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments` e `bankPaymentRequests`; previsões e documentos reais continuam em `expenses` e são conectados pela obrigação.

A previsão de 13 semanas ainda precisa consumir essa camada explicitamente. Ler `expenses`, `payments` e `transactions` como listas independentes voltaria a somar fases diferentes da mesma obrigação. A composição deve selecionar uma representação vigente por obrigação e manter as demais apenas como histórico e evidência.

Referências:

- [`src/features/financial/obligations/types.ts`](../src/features/financial/obligations/types.ts)
- [`src/features/financial/obligations/service.server.ts`](../src/features/financial/obligations/service.server.ts)
- [`src/features/financial/payment-requests/`](../src/features/financial/payment-requests/)
- [`docs/contrato-contabil-despesas-financeiras.md`](./contrato-contabil-despesas-financeiras.md)

### 4.8 Estado dos planos complementares

- fechamento, contagem física, malotes e depósito por cobrança Inter: implementados e publicados; o documento de rollout prevalece sobre decisões abertas do plano original;
- obrigações, vínculos e ajustes de pagamento: implementados no código; a previsão deve reutilizar esses registros;
- pagamentos Pix de saída pelo Inter: implementação local documentada, com rollout condicionado à homologação e à autorização operacional;
- integração Stone, conciliação de vendas e agenda de recebíveis: ainda planejadas;
- versões v3, v4 e v5 deste plano: substituídas por esta v6.

### 4.9 Preflight do plano de contas

Consulta somente leitura executada em 15/09/2026 examinou 116 contas, sem truncamento:

- `Taxas de cartão` (`ybXT1oSjyqDdtGPOsAti`): ativa, DRE em `despesas_financeiras`;
- `Taxas de antecipação de recebíveis` (`9rYkpoScI5X2HC893bNj`): ativa, DRE em `despesas_financeiras`;
- nenhuma conta com “quebra” ou “diferença” no nome foi encontrada.

Consequência: MDR e antecipação reutilizam as contas existentes. A Fase 2 deverá propor a conta-folha `Quebras e diferenças de caixa`, vinculada a `despesas_operacionais`, com migração e auditoria próprias; a criação não faz parte do preflight nem desta alteração documental.

## 5. Arquitetura-alvo

```text
PDV Legal ───────┐
                 ├─> pagamentos normalizados ─┐
Stone Vendas ────┘                            ├─> conciliação de vendas ─> resumo de receita
                                              │                             ├─> DRE PDV
Fechamentos existentes ─> resumo/classificação ┘                            └─> DRE conciliada

Stone Vendas ─> recebíveis/parcelas ─> agenda líquida ───────────────> fluxo previsto
                         │
                         └─> liquidação ─> transação da conta Stone ─> fluxo realizado
                                                   │
                             núcleo bancário existente + adaptador Stone
                                                   │
                        débito Stone ─> transferência interna ─> crédito Inter

Caixa/contagem/sangria/depósito existentes ─> referências e estados no fechamento mensal

previsão ─> despesa real ─> solicitação/agendamento ─> transação bancária
                    obrigação + vínculos ─> uma única saída vigente

saldo atual + recebíveis + obrigações vigentes ─> previsão diária de 91 dias ─> conta/unidade/consolidado
```

PDV e Financeiro usam bancos distintos. A solução não tentará simular transação atômica entre eles. Os fatos do PDV serão projetados de forma idempotente no banco financeiro, e a conciliação ocorrerá integralmente nesse banco.

O módulo de conciliação de receitas será uma camada de composição e decisão. Ele referencia os registros oficiais de caixa, depósito e extrato por ID; não os replica nem assume sua responsabilidade operacional.

## 6. Modelo de dados proposto

Todos os documentos abaixo pertencem ao banco financeiro.

### 6.1 Configuração

`stoneMerchantMappings/{mappingId}`

- `workspaceId`;
- `kioskId` e `kioskName`;
- CNPJ/Stonecode/estabelecimento;
- conta Stone;
- terminais vinculados;
- referências dos segredos, nunca os segredos;
- status e vigência do mapeamento.

### 6.2 Fatos do PDV

`pdvPaymentFacts/{deterministicId}`

- cupom e índice da forma de pagamento;
- unidade, operador, data e horário;
- canal normalizado;
- valor bruto;
- status do cupom/cancelamento;
- NSU, autorização, TID e terminal, se fornecidos;
- hash da origem e revisão observada.

O ID preferencial será derivado de `kioskId + couponId + paymentIndex`. Uma revisão altera o estado projetado, mas preserva evento e hash de origem.

### 6.3 Stone

`stoneSaleTransactions/{externalTransactionId}`

- Stonecode/estabelecimento/terminal;
- data e horário da venda;
- Pix, débito ou crédito;
- bruto, parcelas, bandeira e status;
- NSU, autorização e demais referências;
- cancelamentos/estornos vinculados;
- unidade atribuída ou status `unmapped`.

`stoneReceivables/{receivableKey}`

- venda e parcela de origem;
- bruto, MDR, antecipação, ajustes e líquido;
- data prevista original e atual;
- data efetiva, quando liquidada;
- estado atual e revisão da fonte.

`stoneReceivables/{receivableKey}/events/{eventId}` preservará cada observação append-only.

`stoneSettlements/{settlementId}`

- data e valor efetivos;
- conta Stone;
- composição conhecida;
- taxas, chargebacks e outros descontos;
- recebíveis vinculados;
- referência do extrato;
- `linkedBankTransactionId`, quando conciliado com o lançamento da conta Stone no módulo bancário existente.

`stoneIngestionRuns/{runId}`

- fonte, Stonecode e data consultada;
- checksum/arquivo vigente/supersedes;
- contagens, limites e cursores;
- status, tentativas e erros sanitizados;
- horários de download e processamento.

### 6.4 Conciliação

`salesReconciliationCases/{caseId}`

- período e unidade;
- IDs do PDV e Stone com cardinalidade N:N;
- tipo da divergência;
- totais e diferença;
- confiança da sugestão;
- status da revisão;
- classificação contábil;
- decisão, justificativa, usuário e datas;
- referência para reversão/reabertura.

`revenueReconciliationPeriods/{workspaceId}_{kioskId}_{yyyyMM}`

- `open`, `partial`, `ready`, `closed`, `reopened` ou `stale`;
- cobertura das fontes por dia;
- contagens conciliadas e pendentes;
- totais PDV, Stone, caixa e ajustes;
- versão do fechamento e hash das fontes.
- referências dos fechamentos e lotes de depósito considerados;
- cobertura e estado dos módulos existentes usados como evidência.

`revenueMonthlySummaries/{workspaceId}_{kioskId}_{yyyyMM}`

- receita total do PDV;
- PDV eletrônico por canal;
- Stone bruto por canal;
- vendas confirmadas somente na Stone;
- pagamentos do PDV classificados como inválidos;
- receita conciliada;
- perdas/sobras de caixa classificadas;
- MDR, antecipação e ajustes;
- líquido previsto e realizado;
- percentual de cobertura e status do período.

A DRE lerá apenas esses resumos, nunca todas as transações.

### 6.5 Integração com caixa e depósitos existentes

Serão reutilizadas as estruturas existentes de `cashClosures`, `cashCountingSessions`, `cashDepositBatches`, seus itens/ajustes, os lançamentos financeiros e os eventos de conciliação. Não será criada `cashCustodyMovements` nem uma segunda representação de sangrias e depósitos sem que uma lacuna concreta seja comprovada na implementação.

O resumo de receitas armazenará somente referências e projeções necessárias à leitura mensal:

- IDs dos fechamentos considerados e sua versão/hash;
- IDs dos lotes de depósito relacionados;
- totais de dinheiro esperado, contado, sangrias e suprimentos vindos do módulo oficial;
- diferença de fechamento e sua classificação contábil;
- ID do efeito financeiro gerado, quando houver;
- cobertura, pendências e data da última sincronização do resumo.

Correções operacionais continuarão nas telas de origem. A conciliação de receitas pode abrir o registro correspondente, mas não editar em paralelo o fechamento, a sangria ou o depósito.

### 6.6 Integração com a conciliação bancária existente

Permanecem canônicas as estruturas atuais de contas bancárias, `transactions`, sessões de importação e `bankStatementEvents`. O trabalho novo será:

- extrair do sincronizador Inter um núcleo neutro de ingestão e conciliação;
- manter `inter_api` e acrescentar `stone_api` como origens explícitas;
- mapear a conta Stone como conta bancária própria;
- vincular `stoneSettlements` ao lançamento bancário correspondente por ID;
- identificar o par débito Stone/crédito Inter como transferência interna;
- impedir que liquidação, lançamento Stone e crédito Inter sejam somados como três entradas distintas.

### 6.7 Modelo de leitura do fluxo de caixa

O fluxo de caixa continuará usando como registros canônicos `bankAccounts`, `transactions`, `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments`, `bankPaymentRequests`, `expenses`, `stoneReceivables`, `stoneSettlements` e os registros existentes de fechamento e depósito. `payments` só participa por meio do vínculo com uma obrigação ou transação; não é somado como uma terceira representação independente. Não será criado outro livro financeiro.

Um serviço no servidor comporá uma janela limitada de 91 dias corridos, incluindo a data de referência. Cada item retornado terá, no mínimo:

- `sourceType` e `sourceId`, para abrir o registro canônico;
- conta financeira e unidade de origem/rateio, quando aplicável;
- entrada ou saída e valor em centavos;
- data prevista original, data prevista atual e data realizada;
- `scheduled`, `unprogrammed`, `overdue`, `realized`, `cancelled` ou `replaced`;
- grupo de transferência interna, quando houver;
- revisão/hash da fonte e horário da última atualização.

O serviço produzirá totais diários e semanais sem copiar transações contábeis. Se o preflight comprovar que a composição em tempo de consulta é cara, poderão ser materializados resumos diários reconstruíveis; essa otimização não se torna fonte oficial e só será criada após medição do volume.

O saldo inicial de cada conta deve vir do último saldo confirmado pela conciliação ou pelo provedor, com data e horário de referência. Se ele não estiver disponível, a projeção será marcada como incompleta; o sistema nunca presumirá saldo inicial zero.

Cada resposta do fluxo incluirá `generatedAt`, data de corte, saldo inicial e sua referência, corte de cada fonte e percentual de cobertura. Isso permite distinguir uma projeção atualizada de outra incompleta ou desatualizada.

### 6.8 Integração com obrigações e pagamentos existentes

Cada saída projetada terá `obligationId` como identidade principal e, quando existirem, referências para `expenseId`, `paymentRequestId`, `paymentId`, `obligationPaymentLinkId` e `bankTransactionId`.

A composição obedecerá às seguintes regras:

- `financialObligations` informa valor principal, saldo e estado consolidado;
- uma previsão conciliada com despesa real deixa de produzir item de caixa próprio;
- uma solicitação sem data bancária não substitui a data da despesa;
- um agendamento confirmado substitui data e valor previstos pelo saldo efetivamente agendado;
- pagamentos parciais mantêm apenas o saldo remanescente na previsão;
- uma transação bancária conciliada substitui o montante correspondente pelo realizado;
- juros, multa, desconto e abatimento vêm de `paymentAdjustments` e não são inferidos de uma diferença residual;
- uma obrigação pode aparecer em várias contas/centros por rateio gerencial, mas continua produzindo uma única saída bancária por pagamento efetivo.

Não será criada `expensePaymentLinks`: o contrato implementado e canônico é `obligationPaymentLinks`.

## 7. Contratos de conciliação

### 7.1 PDV × painel de Vendas Stone

Comparação correta:

```text
PDV: Pix + débito + crédito, bruto, na data da venda
Stone: vendas aprovadas, bruto, na data da venda
```

Prioridade dos identificadores:

1. ID Stone gravado pelo PDV;
2. NSU + autorização + terminal;
3. cupom + valor + canal;
4. valor + canal + unidade + janela curta de horário;
5. sem chave única: sugestão manual, nunca pareamento automático.

O motor deverá suportar pagamento dividido e relações 1:1, 1:N e N:1.

Estados de caso:

- `matched_auto`;
- `matched_reviewed`;
- `pdv_only`;
- `stone_only`;
- `amount_mismatch`;
- `status_mismatch`;
- `unit_unmapped`;
- `ambiguous`;
- `resolved_adjustment`;
- `ignored_with_reason`.

Classificações e efeitos:

| Classificação | Receita conciliada | Ação adicional |
|---|---:|---|
| Venda válida nas duas fontes | mantém | nenhuma |
| Venda Stone não registrada no PDV | aumenta | alerta de regularização fiscal/operacional |
| Pagamento PDV comprovadamente inválido | reduz | registrar motivo e evidência |
| Venda de outra adquirente | mantém | encaminhar ao conector correto |
| Unidade Stone incorreta | transfere entre unidades | consolidado não muda |
| Diferença temporal | move a referência do caso | não altera valor |
| Cancelamento/estorno confirmado | reduz conforme política de competência | preservar evento original |

### 7.2 Caixa físico

```text
saldo final contado = fundo/suprimentos + vendas líquidas em dinheiro - sangrias
```

A diferença não é automaticamente receita ou despesa. Ela nasce como `pending_classification` e pode ser resolvida como:

- perda operacional de caixa;
- venda não registrada;
- suprimento/sangria incorreto;
- valor a receber do responsável;
- sobra sem origem identificada;
- erro de contagem;
- erro de integração.

Uma falta classificada como perda deve gerar efeito em `despesas_operacionais`, na conta `Quebras e diferenças de caixa`. Se a perda já representa dinheiro ausente, ela não deve criar uma obrigação bancária a pagar.

A classificação será uma decisão auditável vinculada ao fechamento existente. Ela não recalcula nem substitui a contagem física, e qualquer correção dos valores de origem continuará no módulo de fechamento de caixa.

### 7.3 Sangrias

Uma sangria normal nunca afeta a DRE. Ela só muda a localização do ativo:

```text
gaveta -> cofre/numerário em trânsito -> lote de depósito -> conta bancária
```

Sangria destinada diretamente ao pagamento de fornecedor exige despesa e baixa próprias. Sangria sem destino comprovado fica pendente no fluxo existente; somente após apuração pode virar perda.

A conciliação de receitas apenas lê os totais e estados já calculados e oferece navegação para os registros de origem. Ela não cria uma nova sangria, não altera sua destinação e não gera novo efeito na DRE.

### 7.4 Recebíveis e liquidações

```text
venda bruta
- MDR
- taxa de antecipação comprovada
+/- chargebacks e ajustes
= recebível líquido
```

Bruto e MDR pertencem à competência da venda. A taxa de antecipação pertence à competência do evento de antecipação. O recebível previsto e a liquidação pertencem às respectivas datas de caixa.

O lote Stone explica como vendas formaram o saldo na conta Stone. Ele não será ligado diretamente ao crédito no Inter porque uma transferência pode reunir vários lotes, saldo antigo ou apenas parte do valor.

Os vínculos financeiros seguem duas etapas distintas:

```text
recebíveis Stone -> liquidação Stone -> crédito no extrato da conta Stone
débito no extrato Stone -> transferência interna -> crédito no extrato Inter
```

Assim, a liquidação alimenta o realizado uma única vez e a passagem Stone → Inter não cria nova receita nem nova entrada no caixa consolidado.

### 7.5 Fechamento de período

- Um período pode ser visualizado como parcial, mas só recebe selo `closed` quando todas as fontes esperadas foram carregadas e todos os casos tiveram decisão.
- O consolidado só fecha quando Tirirical, João Paulo e a terceira unidade canônica confirmada na Fase 0 estiverem fechados.
- Uma revisão tardia do PDV ou Stone marca o período `stale`; não altera silenciosamente um mês fechado.
- Reabertura exige permissão, motivo e auditoria.

### 7.6 Previsão do fluxo de caixa

A primeira versão será uma previsão de caixa contratado/conhecido, não uma estimativa estatística de vendas futuras. A janela padrão terá 91 dias corridos, incluindo a data de referência, com consolidação semanal opcional.

```text
saldo final projetado do dia
= saldo inicial confirmado
+ entradas previstas para o dia
- saídas previstas para o dia
```

Fontes e tratamento:

| Evento | Data da previsão | Efeito por conta | Efeito consolidado |
|---|---|---:|---:|
| Recebível líquido Stone | data atual prevista na agenda | entrada na Stone | entrada |
| Outro recebimento financeiro conhecido | data programada | entrada na conta indicada | entrada |
| Despesa aberta/provisionada | vencimento ou pagamento programado | saída da conta indicada | saída |
| Venda em dinheiro já fechada | data do fechamento | realizado no numerário físico | realizado |
| Depósito programado | data confirmada do lote | reduz numerário e aumenta banco | zero |
| Transferência Stone → Inter | data programada/confirmada | reduz Stone e aumenta Inter | zero |
| Liquidação/extrato conciliado | data efetiva | substitui a previsão pelo realizado | realizado uma vez |

Regras:

- A agenda Stone fornece valor líquido e data prevista atuais. MDR e antecipação continuam visíveis na DRE, mas não são novamente subtraídos do líquido no fluxo de caixa.
- Mudança de data ou valor na agenda preserva a previsão original e cria uma nova revisão visível.
- Data vencida sem liquidação muda o item para `overdue`; valor parcialmente liquidado mantém somente o saldo pendente na previsão.
- Liquidação conciliada substitui a parcela prevista pelo realizado e aponta para a transação bancária canônica, sem dupla contagem.
- Dinheiro contado já é disponibilidade realizada. Seu depósito posterior apenas muda a localização do recurso.
- A posição inicial do numerário físico vem dos fechamentos, contagens e lotes ainda não depositados; vendas em dinheiro não são somadas novamente como previsão.
- Depósito ou transferência sem data não será colocado arbitrariamente em um dia: ficará em `unprogrammed` e aparecerá fora do saldo datado.
- Enquanto a política/agenda de transferência Stone → Inter não estiver comprovada, o sistema mostrará “valor na Stone aguardando transferência” e a necessidade de caixa no Inter, mas não inventará uma entrada futura no Inter.
- A projeção não executa transferência, antecipação nem pagamento. Qualquer automação financeira exige regra e autorização próprias.
- O saldo consolidado elimina Stone → Inter, numerário → banco e demais transferências entre contas próprias.

As visões terão significados diferentes:

- **Por conta:** mostra o saldo real e projetado da Stone, do Inter ou do numerário físico.
- **Por unidade:** atribui recebíveis pela unidade/Stonecode da venda e saídas pelos centros/rateios existentes. É uma visão gerencial; não divide artificialmente o saldo de uma conta bancária compartilhada.
- **Consolidado:** mostra a liquidez real do negócio e elimina todas as transferências internas.

Exemplo:

```text
Venda no cartão                         R$ 100,00 de receita na DRE
Recebível líquido para D+2              R$  98,00 de entrada prevista na Stone
Transferência posterior Stone -> Inter  R$  98,00 entre contas; efeito consolidado zero
```

Sem orçamento ou modelo de vendas, os dias posteriores aos recebíveis já contratados podem mostrar poucas entradas. A interface deve informar que isso significa “vendas futuras ainda não estimadas”, e não previsão de faturamento zero.

### 7.7 Precedência das saídas e substituição de evidência

Para cada `obligationId`, o fluxo escolherá a fonte vigente sem apagar a trilha anterior:

```text
transação bancária conciliada
> agendamento bancário confirmado
> despesa real
> previsão
```

- A transação realizada substitui somente o valor liquidado; pagamento parcial preserva o saldo futuro.
- Um agendamento substitui a data prevista apenas quando estiver confirmado pelo banco e vinculado sem ambiguidade.
- Uma solicitação sem agendamento informa o estado operacional, mas não cria uma segunda saída.
- A despesa real substitui a previsão conciliada na mesma competência.
- `paymentAdjustments` explicam juros, multa, desconto e abatimento sem alterar silenciosamente o principal.
- Quando mais de uma obrigação participa do mesmo pagamento, os vínculos repartem o principal, mas o fluxo preserva uma única transação bancária.
- Ausência, ambiguidade ou cobertura parcial permanecem visíveis; o sistema não escolhe pelo primeiro candidato nem presume quitação.

## 8. Plano de implementação

### Fase 0 — Contratos canônicos, escopo e acesso Stone

Antes do acesso ao provedor:

- obter confirmação de negócio para o possível alias “Whopping”; tecnicamente, preservar Shopping do Automóvel e seu `kioskId` já identificado;
- publicar a matriz de fontes canônicas e de representações substituídas;
- inventariar o que está publicado, apenas implementado e ainda planejado;
- registrar esta v6 como plano-mestre e as versões anteriores como substituídas;
- validar que `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments` e `bankPaymentRequests` atendem à composição de saídas sem novas coleções;
- confirmar no plano de contas a reutilização de `Taxas de cartão` e `Taxas de antecipação de recebíveis` e a necessidade da conta `Quebras e diferenças de caixa`.

Confirmar:

- credenciais e escopo dos Stonecodes;
- API/arquivo do painel de Vendas;
- API/arquivo da agenda de recebíveis;
- saldo, extrato e liquidações da conta Stone;
- autenticação, TTL, cache, paginação, intervalo de datas e rate limits;
- webhooks disponíveis e validação de assinatura;
- identificadores de venda, parcela, lote, transferência e terminal;
- campos de bruto, MDR, líquido, antecipação, cancelamento e chargeback;
- disponibilidade de Pix;
- arquivo vazio versus indisponível versus ainda não processado;
- política e tarifa da transferência Stone → Inter.

A documentação pública da Stone Banking exige cadastro, sandbox e homologação. O painel Nova Stone expõe agenda e descontos ao usuário, mas o spike deve comprovar quais desses dados são liberados à aplicação.

Referências externas:

- [Stone Banking API](https://docs.openbank.stone.com.br/docs/guias/stone-open-banking/)
- [Relatórios de vendas e recebimentos](https://ajuda.stone.com.br/recebimentos/como-acessar-os-relat%C3%B3rios-de-venda-e-recebimentos-na-nova-stone)
- [Connect 2.0 e integração do PDV com POS](https://ajuda.stone.com.br/connect-20/connect-20)

**Saída:** matriz canônica aprovada, mapeamento de unidades, contrato de integração documentado e decisão API × importação assistida.

### Fase 1 — Spike com dados reais e anonimizados

Criar um script temporário/read-only para:

- buscar um dia conhecido do Tirirical;
- comparar Vendas, Recebimentos e extrato Stone;
- consultar uma data com cancelamento e outra com antecipação;
- salvar payload bruto apenas em `/tmp`, com permissão restrita;
- gerar relatório sem dados pessoais;
- gerar fixtures determinísticas anonimizadas;
- não escrever no Firestore nem executar movimentações.

Perguntas obrigatórias:

1. Vendas e recebíveis são APIs distintas?
2. Quais status de venda existem e quais contam como aprovados?
3. Qual identificador é estável em 100% das vendas?
4. NSU, autorização e terminal estão disponíveis?
5. O Pix aparece com granularidade de transação?
6. Bruto, MDR e líquido vêm separados?
7. Como parcelamento aparece na agenda?
8. Como antecipação e sua taxa aparecem?
9. Como cancelamento e chargeback são versionados?
10. Qual é o fuso da venda e da liquidação?
11. Existe identificador estável de lote/depósito?
12. A API fornece extrato da conta Stone e referências de transferência?
13. Qual referência aparece também no crédito do Inter?
14. Como distinguir dado vazio, indisponível, incompleto e erro de autenticação?

A taxa de antecipação será classificada como `EXPLICIT`, `DERIVABLE`, `COMPLEMENTARY_FILE` ou `NOT_AVAILABLE`. Nenhuma diferença residual será chamada automaticamente de taxa.

**Saída:** relatório do spike, schemas reais e go/no-go para ingestão.

### Fase 2 — Fundação contábil e correção da receita atual

- separar vendas, posição da gaveta, diferenças e recebimentos;
- retirar `finalizedDifferenceTotalCents` da Receita Bruta automática;
- preservar os módulos atuais de fechamento, sangrias e depósitos com migração compatível;
- reutilizar as contas existentes de taxas e criar somente a conta de perda de caixa cuja ausência for comprovada;
- criar contrato para ajustes de resultado sem obrigação bancária;
- atualizar resumos de fechamento sem misturar sangria/suprimento com receita;
- deixar testes permanentes para essas invariantes.

**Saída:** DRE atual conceitualmente correta, ainda sem depender da Stone.

### Fase 3 — Ingestão normalizada e idempotente

- projetar pagamentos do PDV no banco financeiro;
- implementar autenticação e client Stone no servidor;
- persistir arquivo/payload antes do parse, quando aplicável;
- criar IDs determinísticos e checksum;
- usar retry com backoff e estado observável;
- armazenar eventos imutáveis e projeção atual;
- impedir duplicação em reprocessamento;
- não armazenar PAN, credenciais ou dados desnecessários de portador.

Preferência operacional:

1. webhook/delta, se disponível;
2. sincronização diária D-1;
3. overlap curto e cursor para revisões;
4. nunca reler coleções ou períodos completos em polling.

**Saída:** um dia do Tirirical confere com os painéis Stone e PDV.

### Fase 4 — Motor de conciliação de vendas

- implementar matching determinístico e sugestões;
- suportar pagamentos divididos;
- criar casos de divergência sem alterar origens;
- disponibilizar ações de confirmar, corrigir, classificar e ignorar com motivo;
- recalcular resumo diário/mensal na mesma transação da decisão, quando estiver no mesmo banco;
- marcar mês fechado como `stale` diante de revisão tardia.

**Saída:** dez dias consecutivos do Tirirical com todos os casos classificados e diferença monetária integralmente explicada.

### Fase 5 — Integração com caixa, sangrias e depósitos existentes

- projetar no resumo mensal os IDs, totais, cobertura e estados dos fechamentos existentes;
- consumir sangrias e suprimentos já calculados, sem duplicar movimentos;
- referenciar sessões de contagem e lotes de depósito já existentes;
- introduzir somente a classificação auditável das diferenças de fechamento;
- lançar somente perdas confirmadas em despesa operacional;
- manter valores a receber do responsável fora da despesa até decisão própria;
- abrir a tela de origem para qualquer correção operacional;
- validar que a projeção não altera nem duplica registros dos módulos existentes.

**Saída:** a conciliação de receitas explica o dinheiro usando a trilha já existente e separa as diferenças classificadas da receita, sem construir outro fluxo de caixa físico.

### Fase 6 — Agenda, liquidação e extensão da conciliação bancária

- projetar recebíveis por parcela e data;
- mostrar bruto, taxas e líquido;
- obter o saldo inicial confirmado e sua data de referência para cada conta;
- compor a previsão diária de 91 dias com recebíveis líquidos e obrigações existentes;
- compor cada saída por `obligationId`, aplicando a precedência definida na seção 7.7;
- usar `obligationPaymentLinks` e `paymentAdjustments` para pagamentos parciais, consolidados e encargos;
- tratar `bankPaymentRequests` como estado operacional e agendamento, nunca como nova despesa;
- manter data/valor originais e atuais de cada previsão;
- tratar itens programados, sem data, vencidos, parcialmente liquidados, realizados e cancelados;
- importar liquidações/extrato Stone;
- conciliar recebível previsto com liquidação Stone;
- extrair um núcleo neutro do sincronizador atual sem romper a integração Inter;
- registrar `stone_api` como nova origem da conciliação bancária existente;
- vincular a liquidação Stone a um único lançamento bancário canônico;
- conciliar débito de transferência Stone com crédito Inter;
- criar sugestão por valor/data somente quando não houver referência forte;
- exigir confirmação humana para vínculo ambíguo;
- registrar tarifas e ajustes separadamente;
- não incluir estimativa de vendas futuras sem um cenário/orçamento explícito.

**Saída:** previsão de 13 semanas e realizado conferidos para o Tirirical antes da expansão.

### Fase 7 — Interface operacional

Evoluir a área para `Financeiro > Conciliação`, preservando as telas operacionais existentes e organizando as seguintes visões:

1. `Extratos bancários` — tela existente, agora compatível com contas Inter e Stone;
2. `Vendas PDV × Stone` — nova;
3. `Recebíveis Stone` — nova;
4. `Fechamento mensal` — nova;
5. `Execuções da integração` — nova e restrita a administradores.

Caixa, sangrias e depósitos não formam uma aba paralela. Seus resumos aparecem como evidência no fechamento mensal, com links para as telas existentes de fechamento, contagem e depósito.

Filtros:

- competência/data;
- todas as unidades ou unidade específica;
- canal;
- status;
- tipo de divergência;
- terminal/Stonecode;
- somente itens pendentes.

KPIs:

- PDV eletrônico bruto;
- Stone Vendas bruto;
- diferença explicada e pendente;
- percentual conciliado;
- perdas de caixa;
- recebíveis futuros;
- líquido previsto e realizado;
- saldo Stone, Inter e consolidado;
- valor Stone aguardando transferência.

**Saída:** fluxo completo de revisão e fechamento sem depender de acesso direto ao portal Stone.

### Fase 8 — DRE e fluxo de caixa

Na DRE, adicionar `Critério da receita`:

- `PDV Legal`;
- `Receita conciliada`.

Regras da interface:

- PDV Legal será a base explícita, sem fallback silencioso por unidade;
- Receita conciliada parcial poderá ser visualizada com alerta e cobertura;
- o selo de fechada exige 100% dos casos decididos;
- comparação mostrará PDV, ajustes positivos, ajustes negativos, conciliado e diferença;
- exportação, gráficos e percentuais usarão o critério selecionado;
- taxas Stone e perdas de caixa aparecerão em linhas próprias da DRE;
- sangrias, suprimentos e depósitos continuarão sem efeito na DRE, salvo despesa, tarifa ou perda explicitamente classificada.

No fluxo de caixa:

- evoluir a tela existente, sem criar um segundo módulo;
- preservar a consulta histórica de realizados e acrescentar a visão futura;
- usar horizonte padrão de 91 dias corridos, com visão diária e semanal;
- iniciar cada conta pelo último saldo confirmado e exibir a atualização/cobertura da fonte;
- agenda Stone alimenta entradas previstas;
- `financialObligations` alimenta saídas previstas e preserva uma única representação vigente por obrigação;
- solicitação, agendamento e pagamento substituem a etapa anterior sem duplicar a saída;
- liquidação Stone alimenta realizado na conta Stone;
- o realizado aponta para a transação da conciliação bancária existente, sem duplicá-la;
- transferência Stone → Inter move saldo entre contas;
- consolidado elimina transferências internas;
- atrasos, rejeições, chargebacks e mudanças de previsão permanecem visíveis;
- itens sem data ficam em uma fila separada e não contaminam o saldo datado;
- a visão por unidade mostra atribuição gerencial; saldo bancário real permanece por conta;
- destacar menor saldo projetado, primeiro dia negativo, valor na Stone aguardando transferência e necessidade de recursos no Inter;
- informar claramente que recebíveis contratados não representam uma projeção de vendas ainda não realizadas.

**Saída:** DRE e fluxo de caixa fecham por unidade e no consolidado sem dupla contagem.

### Fase 9 — Backfill e rollout

- criar backfill separado, idempotente, paginado e com dry-run;
- iniciar em agosto de 2026;
- publicar relatório de contagens, totais e divergências antes de gravar;
- rodar em modo sombra, sem alterar a DRE oficial;
- validar Tirirical, depois João Paulo e a terceira unidade após confirmação de seu `kioskId` canônico;
- comparar diariamente com PDV, Vendas Stone, Recebimentos Stone e extrato;
- apenas referenciar fechamentos, sangrias, depósitos e transações bancárias existentes; nunca recriá-los no backfill;
- fechar cada unidade somente após revisão das exceções;
- liberar o consolidado depois das três unidades.

**Saída:** reconciliação histórica e corrente aprovada pelo Financeiro.

## 9. Permissões

Criar permissões específicas, sem ampliar implicitamente as permissões atuais de despesas:

```text
financial.salesReconciliation.view
financial.salesReconciliation.review
financial.salesReconciliation.classify
financial.salesReconciliation.close
financial.salesReconciliation.reopen
financial.stoneIntegration.manage
```

- `financial.reconciliation` continua protegendo a conciliação de extratos e suas ações atuais; a origem `stone_api` não cria uma permissão bancária paralela.
- As permissões atuais de fechamento de caixa e depósitos continuam protegendo a consulta e a correção dos registros de origem.
- `financial.expenses.view` e `financial.expenses.pay` continuam protegendo, respectivamente, a leitura da obrigação e o registro de pagamentos informados.
- `financial.paymentRequests.*` continua protegendo preparação, autorização interna, envio, consulta e comprovante; nenhuma dessas autoridades é concedida pela tela de fluxo de caixa.
- `financial.cashFlow.view` continua protegendo a tela e os resumos projetados; `financial.cashFlow.create` continua restrita aos lançamentos manuais já permitidos.
- `financial.dre` permite consultar os resumos usados pela DRE, mas não os detalhes sensíveis.
- Ter permissão de DRE, fluxo de caixa, caixa, depósito ou conciliação bancária não concede automaticamente acesso aos detalhes de vendas/recebíveis Stone.
- Toda leitura e escrita precisa de autorização no servidor.
- Fechamento, reabertura, classificação contábil e gestão de integração são ações segregadas.
- A previsão não concede permissão para transferir, antecipar, pagar ou movimentar recursos.
- Ocultar botões não substitui controle de acesso.

## 10. Auditoria e observabilidade

- Cada decisão registra anterior, novo, motivo, usuário e horário.
- Correção cria nova revisão; não apaga o evento anterior.
- Jobs recebem `runId`; chamadas recebem `requestId`; falhas inesperadas recebem `eventId`.
- Logs não expõem token, chave, payload financeiro bruto, PAN ou dados do portador.
- Falha externa persiste intenção/estado e pode ser retomada com idempotência.
- Um mês fechado alterado por fonte externa vira `stale` e exige reabertura explícita.

## 11. Firestore e custo

Preflight obrigatório antes de cada fase com queries novas.

Diretrizes:

- DRE: um `revenueMonthlySummary` por unidade/mês. Para seis meses e três unidades, 18 leituras de receita por carregamento.
- Tela de conciliação: consultas por `workspaceId + period + kioskId + status`, paginadas, inicialmente em até 100 casos.
- Fluxo de caixa: consultas no servidor por conta/unidade, data e status, limitadas à janela de 13 semanas; a tela não carregará coleções financeiras completas para filtrar no cliente.
- A implementação deverá substituir o carregamento integral atual de `transactions`, `payments` e `expenses` na tela antes de acrescentar os recebíveis Stone.
- Saídas: consultar obrigações e vínculos por escopo e janela; não executar consultas independentes de despesas, pagamentos e transações para depois deduplicar no cliente.
- Se resumos diários forem materializados, uma carga terá no máximo 91 documentos por escopo consultado; o preflight decidirá entre cálculo limitado e resumo persistido conforme o volume real.
- Jobs: cursor, data-fonte, checksum e overlap curto; nunca scan completo recorrente.
- Históricos fechados ficam fora das filas operacionais.
- Índices são criados somente para queries documentadas.
- Resumo mensal é atualizado por delta ou reconstrução limitada ao período; a DRE não agrega transações brutas.
- O spike deve medir transações/dia por unidade para estimar leituras, escritas, Storage e chamadas mensais antes do rollout.

## 12. Testes

### Unitários

- normalização de canais PDV/Stone;
- datas e fronteira do fuso;
- identidade/idempotência;
- matching 1:1, 1:N e N:1;
- ambiguidade sem auto-match;
- cancelamento, estorno e chargeback;
- bruto, MDR, antecipação e líquido;
- receita PDV × conciliada;
- diferença de caixa e classificação;
- sangria sem efeito na DRE;
- projeção do resumo sem duplicar fechamento, sangria, depósito ou lançamento bancário;
- transferência Stone → Inter sem efeito consolidado;
- saldo inicial ausente gera estado incompleto, nunca saldo zero presumido;
- horizonte de 13 semanas respeita a fronteira diária de `America/Belem`;
- recebível líquido entra na data prevista atual e preserva data/valor originais;
- previsão vencida, parcial, revisada, cancelada e substituída pelo realizado;
- despesas abertas entram pelo saldo pendente e pela data de pagamento/vencimento;
- previsão, despesa real, solicitação, agendamento e transação respeitam a precedência por `obligationId`;
- pagamento parcial substitui somente o valor realizado e preserva o saldo futuro;
- um pagamento consolidado mantém uma transação bancária com alocações para várias obrigações;
- juros, multa, desconto e abatimento vêm de ajustes classificados, nunca de diferença residual inferida;
- depósito e transferência interna alteram contas, mas têm efeito consolidado zero;
- visão por unidade não divide artificialmente saldo de conta compartilhada;
- ausência de estimativa de vendas futuras é sinalizada e não gera entradas inventadas;
- período fechado e revisão tardia.

### Contrato e integração

- schemas dos payloads/arquivos Stone;
- autenticação e sanitização de erros;
- rotas e permissões;
- transações de decisão + auditoria + resumo;
- compatibilidade do núcleo bancário com `inter_api` e `stone_api`;
- vínculo único entre liquidação Stone e lançamento bancário existente;
- composição de saídas por `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments` e `bankPaymentRequests`;
- links para fechamento e depósito originais sem escrita paralela;
- consulta limitada do fluxo de caixa sem leitura integral das coleções;
- saldo por conta e consolidado com a mesma transferência interna;
- Firestore Emulator com dados determinísticos;
- rerun do mesmo arquivo sem duplicação.

### E2E crítico

1. carregar PDV e Stone;
2. abrir divergência;
3. classificar e justificar;
4. fechar unidade/mês;
5. verificar Receita conciliada na DRE;
6. abrir a previsão de 13 semanas e verificar recebível líquido e despesa futura;
7. conferir saldos Stone, Inter, por unidade e consolidado;
8. liquidar e verificar substituição da previsão pelo realizado;
9. transferir Stone → Inter e verificar efeito consolidado zero;
10. reabrir após revisão tardia.
11. substituir uma previsão por despesa real sem duplicar a saída futura;
12. vincular um agendamento bancário à obrigação e substituir a data prevista;
13. liquidar parcialmente e manter somente o saldo remanescente projetado;
14. conciliar a transação bancária final sem somar solicitação, pagamento informado ou agendamento.

Mudanças comuns devem manter `npm run check` verde. Mudanças de rotas, fronteiras server/client ou build devem manter `npm run verify` verde. Regras do Firestore exigem `npm run check:rules`.

## 13. Critérios de aceite do produto

Para cada unidade e competência:

- todo Pix/débito/crédito do PDV está conciliado ou possui decisão explícita;
- toda venda Stone está conciliada ou possui decisão explícita;
- a diferença total PDV × Stone é integralmente explicada;
- toda diferença de caixa está pendente de forma visível ou classificada;
- sangrias, suprimentos, contagens e depósitos exibidos correspondem aos módulos existentes;
- qualquer pendência de sangria ou depósito encaminha o usuário ao registro original;
- perdas de caixa aparecem em despesas operacionais, não na Receita Bruta;
- taxas Stone não ficam escondidas no líquido recebido;
- recebíveis previstos fecham com a agenda Stone;
- liquidações realizadas fecham com o extrato Stone;
- cada liquidação conciliada aponta para um único lançamento bancário canônico;
- transferências Stone → Inter não duplicam entrada no consolidado;
- DRE permite alternar PDV Legal e Receita conciliada;
- fluxo de caixa diferencia previsto e realizado;
- previsão cobre 91 dias corridos a partir de hoje e começa no saldo confirmado de cada conta;
- recebíveis Stone aparecem líquidos na data prevista, sem nova dedução das taxas;
- despesas abertas aparecem pela obrigação pendente e pela data prevista de saída;
- cada obrigação possui no máximo uma representação vigente no saldo projetado;
- pagamentos parciais e consolidados fecham com seus vínculos sem criar novas despesas ou transações;
- previsão liquidada é substituída pelo realizado sem dupla contagem;
- itens vencidos, parciais, revisados e sem data permanecem identificáveis;
- visões por conta, unidade e consolidado respeitam seus significados e eliminam transferências internas;
- a tela informa a data de atualização, a cobertura e a ausência de estimativa para vendas futuras;
- saldo inicial indisponível bloqueia a exibição de um saldo projetado enganoso;
- mês fechado não muda sem reabertura auditada;
- o consolidado só fecha quando Tirirical, João Paulo e a terceira unidade canônica confirmada na Fase 0 fecharem.

## 14. Sequência de entregas e dependências

1. Contratos canônicos, mapeamento de unidades e inventário de estado.
2. Acesso/spike Stone.
3. Correção do contrato atual de receita e diferenças de caixa.
4. Projeção dos pagamentos PDV e ingestão Stone.
5. Conciliação PDV × Stone Vendas.
6. Integração de leitura com fechamento, sangrias e depósitos existentes.
7. Agenda de recebíveis e extensão Stone da conciliação bancária existente.
8. Composição das saídas pela camada de obrigações e pagamentos existente.
9. Interface, seletor de receita na DRE e evolução do fluxo de caixa.
10. Backfill e rollout por unidade.

O seletor de CMV já foi implementado em `feat/dre-cmv-source` (`39d21bf5`). Como o seletor de receita também altera a DRE, sua implementação deverá partir da versão em que esse trabalho já estiver integrado, evitando duas edições concorrentes da mesma página.

## 15. Fora do escopo inicial

- executar pagamentos a terceiros pela conta Stone;
- corrigir automaticamente documentos fiscais no PDV;
- antecipar recebíveis automaticamente;
- transferir Stone → Inter sem regra e autorização operacional definidas;
- aceitar diferença não explicada como taxa;
- considerar um mês conciliado por simples igualdade de totais agregados;
- substituir dados originais do PDV ou Stone por ajustes manuais;
- criar um segundo módulo de fechamento de caixa, sangrias, custódia ou depósitos;
- criar uma conciliação bancária paralela à existente;
- criar uma segunda coleção de obrigações ou `expensePaymentLinks` paralela a `obligationPaymentLinks`;
- copiar liquidações Stone como novas transações quando já houver lançamento bancário canônico;
- prever vendas futuras por média, sazonalidade ou inteligência estatística sem orçamento/cenário aprovado;
- executar automaticamente transferências Stone → Inter, antecipações ou pagamentos a partir da previsão.

## 16. Decisões consolidadas na v6

- Fechamento de caixa, sangrias, suprimentos, contagem, malotes/lotes e depósitos já estão implementados e serão apenas referenciados.
- A conciliação de extratos já existente será generalizada para receber a Stone, mantendo o Inter e as importações atuais.
- A interface não duplicará operações de caixa ou depósito; mostrará resumo, estado e link para a origem.
- O escopo novo concentra-se em `PDV × Stone Vendas`, agenda/liquidação de recebíveis, classificação das divergências, fechamento mensal e critérios de receita da DRE.
- A tela de fluxo de caixa existente será evoluída para uma previsão diária de 13 semanas, iniciada por saldos reais e composta por entradas e saídas conhecidas.
- A primeira versão não estima vendas futuras; separa disponibilidade contratada de cenários comerciais ainda inexistentes.
- Saldos bancários permanecem por conta, enquanto a visão por unidade representa apenas a atribuição gerencial dos movimentos.
- Obrigações e saídas reutilizam `financialObligations`, `obligationPaymentLinks`, `paymentAdjustments` e `bankPaymentRequests`.
- O fluxo aplica a precedência `transação realizada > agendamento confirmado > despesa real > previsão` e preserva somente o saldo ainda não realizado.
- O vínculo de unidade usa IDs canônicos; “Whopping” e “Shopping do Automóvel” precisam de confirmação explícita antes do backfill.
- `Taxas de cartão` e `Taxas de antecipação de recebíveis` serão reutilizadas; não serão criadas contas duplicadas para MDR ou antecipação.
- A cobrança Inter associada ao malote é uma entrada bancária do fluxo de numerário, não uma API de depósito físico nem uma nova receita.
- Esta v6 substitui as versões anteriores como plano de execução; os documentos especializados continuam válidos apenas dentro de suas responsabilidades canônicas.
