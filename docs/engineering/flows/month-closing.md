# Fechamento financeiro mensal: tela inicial e fluxos de Despesas, Vendas e Taxas (somente leitura)

**Estado:** traçado. O [plano](../../planos/plano-fechamento-financeiro-mensal.md) registra o escopo do fluxo. Fechar, reabrir, travar a competência e gerar relatório são etapas futuras.

## Escopo e entradas

- Tela inicial **Financeiro › Fechamento do mês** ([`month-closing/page.tsx`](../../../src/app/dashboard/financial/month-closing/page.tsx) → [`MonthClosingPage`](../../../src/features/financial/month-closing/month-closing-page.tsx)) e tela do fluxo [`month-closing/expenses/page.tsx`](../../../src/app/dashboard/financial/month-closing/expenses/page.tsx) → [`ExpensesFlowPage`](../../../src/features/financial/month-closing/expenses-flow-page.tsx). A competência vem de `?month=AAAA-MM`; sem ela, o mês anterior ao atual no fuso `America/Belem`, nunca antes de agosto de 2026 (início da DRE).
- Entrada na barra lateral do Financeiro (“Fechamento do mês”), visível para o administrador padrão ou para quem tem `financial.view` e `financial.monthClosings.view`.
- Os cinco fluxos aparecem na tela inicial. **Despesas, Vendas, Taxas e Recebimento (etapa Pix e cartão)** são calculados; **DRE** aparece como “Ainda não conectado”, sem números (Recebimento é um dos últimos: o crédito a 30 dias só fecha depois). Só Despesas tem tela de detalhe; Vendas e Taxas levam direto à tela de origem, já no mês e no vínculo Stone da pendência. Cada fluxo fica **Conferido sozinho** quando todas as suas conferências estão ok; só o fechamento do mês será manual (etapa futura).
- A análise mostra a situação e leva à tela de origem. Ações como pagar, vincular, cancelar ou ajustar ficam em [Despesas](expenses.md), [Faturas de cartão](card-statements.md) e no extrato. Um item parcelado abre o título de origem com `?competence=&expense=&installment=`.

## Percurso observado

1. A página chama [`useMonthClosing`](../../../src/features/financial/month-closing/use-month-closing.ts), que faz uma leitura `GET /api/financial/month-closing?month=` pelo cliente autenticado compartilhado. Sem polling nem listener; atualiza ao trocar a competência ou por “Tentar de novo”.
2. A rota [`api/financial/month-closing/route.ts`](../../../src/app/api/financial/month-closing/route.ts) usa `secureRoute` (contrato `financial.month-closing.overview`): valida `month` (`AAAA-MM`, de 2026-08 até o mês atual), autentica, exige a permissão (`assertMonthClosingAccess`) e chama [`getMonthClosingOverview`](../../../src/features/financial/month-closing/overview.server.ts).
3. O serviço seleciona `expenses` com competência do título igual ao mês ou `paymentMethod == "installments"`. A consulta usa uma união com a chave de documento, em páginas de 250. Isso inclui títulos legados com parcelas no mês e competência do título em outro período. `cardStatements` é consultada pelo `monthKey`. Os limites são de 1.500 despesas e 60 faturas. Se ultrapassados, a API responde 409 `MONTH_CLOSING_LIMIT_EXCEEDED`.
4. [`evaluateExpensesFlow`](../../../src/features/financial/month-closing/expenses-flow.ts) usa o [contrato central da despesa](../../../src/features/financial/lib/expense-accounting-contract.ts), compartilhado com Despesas. Títulos parcelados avulsos entram pelo vencimento de cada parcela. Cartão entra pelo ciclo da fatura. Estado, baixa e saldo pertencem à parcela relevante. [`expense-display-state`](../../../src/features/financial/lib/expense-display-state.ts) calcula vencidos e saldos.
5. O [contrato de conciliação](../../../src/features/financial/obligations/expense-reconciliation.ts) calcula a situação de pagamento nas duas telas. O backend consulta débitos antigos apenas quando a evidência gravada precisa ser conferida, com limite de 1.500 documentos de transação e leitura adicional para detectar estouro. A resposta contém conferências, pendências ordenadas por atraso e vencimento e totais.

## Regras de classificação (Despesas)

| Conferência | Conferido quando | Observações |
| --- | --- | --- |
| Previsões e rascunhos resolvidos | nenhuma previsão (`provisionType: forecast`) sem valor real e nenhum rascunho | Previsão `reconciled` conta como resolvida. |
| Pagamentos conferidos | título pago com baixa confirmada pela regra compartilhada com Despesas | Reconhece baixa bancária atual, débito antigo vinculado e pagamento em dinheiro baixado pelo caixa. Pagamento informado, sem vínculo, divergente ou com valor real da despesa a conferir fica pendente. Cada parcela usa seu próprio vínculo com um débito válido. Vencido indica saldo aberto após o vencimento. |
| Fatura do cartão | fatura da competência com `status: paid` | Compra no cartão é conferida pela fatura, não como título avulso. Fatura fechada aguarda pagamento (vencida vira pendência que depende de quem opera); aberta pende; compra no cartão sem fatura importada pende. |

Exclusões iguais às da lista de Despesas: `cancelled`, `reconciled` não previsão, `hiddenFromExpensePanel` e `budgetMigration`. O fluxo fica “Conferido” quando previsões, pagamentos e fatura do cartão estão resolvidos. A folha entra como despesa provisionada e a caixa de cobranças é tratada em Cobranças (decisão de 2026-11-21).

## Vendas e Taxas (decisão de 21/11/2026)

Ambos leem `stoneMerchantMappings` (todas as situações, até 100) pela mesma elegibilidade das telas de origem (`resolveFinancialAgentMapping`): vale o vínculo **ativo ou o encerrado que tem data de fim**, um por StoneCode; vínculo por terminal fica de fora ([`stone-bindings.ts`](../../../src/features/financial/month-closing/stone-bindings.ts)). Vendas considera todo vínculo que vigorou em algum dia do mês; Taxas usa o vigente no último dia do mês (ou no último dia publicado), como a tela de Taxas, porque a conferência Stone salva fica ligada a esse vínculo; vínculos concorrentes para o mesmo StoneCode deixam só Taxas indisponível. Unidade sem vínculo vigente não entra; sem nenhum vínculo o fluxo fica **indisponível**, nunca conferido. Se a leitura falhar, só aquele fluxo fica indisponível, com evento de erro (`reportSystemError`), e os demais continuam.

| Fluxo | Conferência | Conferido quando | Fonte |
| --- | --- | --- | --- |
| Vendas | PDV × Stone (cartão e Pix) | todo dia elegível de cada vínculo está **Fechado** na revisão diária e nenhum dia deixou de ser publicado pela Stone; dia sem revisão, com atenção, aguardando fonte ou reaberto por informação tardia pende | `dailySalesReviews` pelo calendário (`listDailySalesReviewCalendar` + `buildSalesReviewMonth`) |
| Taxas | Conferência Stone do mês | conferência salva **depois do fim do mês** e com o mês inteiro publicado (antes disso o dado pode estar incompleto) | `buildFeeReview` (`ready`, `savedAt`) |
| Taxas | Vendas a corrigir / Mudanças de taxa / Outras cobranças | zero em cada categoria em todos os vínculos (venda cobrada exatamente no valor esperado em centavos não conta como “a corrigir”, ver [Vendas e Taxas](stone-sales-review.md)); sem a conferência salva as contagens são desconhecidas e contam como pendentes | `buildFeeReview` (`exceptions`, `changes`, `charges`) |

- O card de Vendas tinha “Caixa fechado”, “PDV × Stone (cartão)” e “Pix” como placeholders. A revisão diária cobre cartão e Pix juntos, então virou uma conferência única. O caixa fechado em dinheiro não é conferido aqui (os depósitos entram em Recebimento). O card de Taxas tinha “Lançamento no mês”: o lançamento mensal foi substituído pelo reconhecimento por data da venda e não há status mensal lido aqui; o reconhecimento da taxa na competência **não é verificado** por este fluxo.
- Itens (dias e contagens por vínculo) só para o administrador padrão, como as telas de origem; quem tem só `financial.monthClosings.view` vê as contagens. Dia ainda não publicado pela Stone não depende da pessoa.
- Atalhos: Vendas → `sales-reconciliation?month=&mapping=&stoneCode=`; Taxas → `stone-receipts?tab=fees&month=&mapping=&stoneCode=`.

## Dados e acesso

| Dado ou coleção | Operação | Fonte | Quem pode ler e onde é verificado |
| --- | --- | --- | --- |
| `expenses` (banco financeiro) | leitura da competência e dos títulos parcelados | `overview.server.ts` | Rota: `financial.view` + `financial.monthClosings.view`; itens (descrição, fornecedor, valor) só com `financial.expenses.view`. |
| `cardStatements` | leitura por competência | `overview.server.ts` | Mesma rota. |
| `transactions` | leitura por vínculo persistido | `expense-reconciliation.server.ts` | O backend usa a evidência no cálculo. A resposta expõe a contagem e, com `financial.expenses.view`, os itens de Despesas. |
| `stoneMerchantMappings` (workspace, até 100), `kiosks`, `dailySalesReviews`, decisões/ocorrências/conferências Stone | leitura | `sales-fees.server.ts` | Rota igual; itens de Vendas e Taxas só administrador padrão (`canViewMonthClosingStoneItems`). |
| Nenhuma | escrita | — | Não há escrita nem auditoria nesta etapa. |

- Permissão nova: `financial.monthClosings` = `{ view, close, reopen }` ([`src/types/index.ts`](../../../src/types/index.ts)), opcional para não quebrar perfis salvos (ausência = negado). Administrador padrão tem tudo. `close` e `reopen` aparecem no perfil mas **não têm efeito** ainda. Perfis existentes que precisem da tela exigem ajuste manual.
- O fechamento é **da empresa inteira**, sem filtro por unidade (a tabela por quiosque ainda não existe). Quem tem a permissão enxerga os totais da empresa; os itens dependem de `financial.expenses.view`.
- Não há dado pessoal novo persistido; as leituras usam coleções já existentes.

## Custo de leitura (Firestore)

Por abertura de tela, até 1.500 despesas, 60 faturas e 1.500 evidências de transações, com uma sentinela por fonte. O volume depende dos títulos do mês e do histórico de títulos parcelados. Cada documento encontrado nos dois filtros da união conta uma vez. Sem listeners, polling ou cache entre telas. **Vendas:** até 31 leituras do calendário por vínculo Stone (cerca de 100 com três quiosques). **Taxas:** por vínculo, até 6 conferências mensais salvas, decisões (≤2.000), ocorrências (≤500) e referências de taxa; estimativa de centenas por vínculo, na ordem de 1.000 a 2.000 leituras por abertura com três quiosques.

## Verificação e limites

- Testes: [`financial-month-closing-expenses-flow`](../../../tests/unit/financial-month-closing-expenses-flow.test.ts) (classificação, vencimento, cartão, dinheiro, datas sem deslocamento de fuso, fonte não conectada, ocultação de itens) e [`financial-month-closing-access-and-month`](../../../tests/unit/financial-month-closing-access-and-month.test.ts) (permissões, fuso, intervalo, apresentação).
- A regressão de parcelas cobre a distribuição entre competências, a baixa individual, o saldo parcial, o vencimento legado à meia-noite UTC e o ciclo de cartão com vencimento no mês seguinte. Validação visual e rota HTTP completa permanecem pendentes.
- Em 21/11/2026, a consulta nova de despesas e o avaliador local foram executados sobre outubro e novembro em leitura. Foram 166 e 95 despesas candidatas, respectivamente. Um título parcelado com competência contábil de outubro entrou com suas duas parcelas de novembro e nenhuma em outubro. A terceira parcela do mesmo título foi projetada em dezembro.
- Hipóteses a confirmar: dinheiro conta pela baixa do caixa; pagamento só informado não basta; fatura de cartão só conta como conferida quando `paid`.
- Testes de Vendas e Taxas: [`financial-month-closing-sales-fees-flow`](../../../tests/unit/financial-month-closing-sales-fees-flow.test.ts) e [`financial-month-closing-stone-bindings`](../../../tests/unit/financial-month-closing-stone-bindings.test.ts). A leitura do servidor (`sales-fees.server.ts`) não tem teste automatizado nem foi executada com dados reais.
- **Recebimento (2026-11-21), etapa Pix e cartão:** cada parcela conta no mês da sua **data prevista**, venha de qual mês de venda vier (`receipts-flow.ts`, leitura em `receipts.server.ts`). Lê as conferências Stone salvas (`stoneReceiptMonthSnapshots`) do mês e do anterior (crédito à vista de 30 dias); se alguma tiver parcelado (`installmentCount > 1`), lê também até 11 meses para trás. Cada conferência precisa estar salva depois do fim da competência, com o mês publicado; sem ela, conta como pendente. Pendente = `unpaid`, `paid_late`, `chargeback`, `review`, `missing_file` (`PENDING_RECEIPT_STATUSES`) ou `to_receive` (dentro do prazo da Stone, “Pendente até dd/mm”). Sem tela própria: leva à tela de recebimentos no mês. **Etapa do dinheiro:** só vale depois que o mês terminou (antes, fica pendente). Lê os fechamentos de caixa do mês (consulta `cashClosures` por workspace, ano e mês sem ordenação (não depende de índice composto), até 1.000 por chamada; acima disso a etapa fica indisponível) e, por quiosque, exige todo dia **aprovado** e todo dinheiro elegível (`cashDeposit.eligibleCents > 0`) com depósito **pago ou ajustado**; o ajuste é feito na tela de depósitos e conta como resolvido. Sem os fechamentos lidos, nada é dado como depositado. O Recebimento fecha sozinho quando Pix/cartão e dinheiro estão em dia. Custo por chamada: 2 leituras de conferência por vínculo (até 12 com parcelado) e até 1.000 fechamentos de caixa, sem polling.
- Lacunas conhecidas: tabela por quiosque, Bancos (saldo final), DRE, e o reconhecimento da taxa na competência.
