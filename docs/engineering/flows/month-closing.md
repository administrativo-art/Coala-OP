# Fechamento financeiro mensal: tela inicial e fluxo de Despesas (somente leitura)

**Estado:** traçado. O [plano](../../planos/plano-fechamento-financeiro-mensal.md) registra o escopo do fluxo. Fechar, reabrir, travar a competência e gerar relatório são etapas futuras.

## Escopo e entradas

- Tela inicial **Financeiro › Fechamento do mês** ([`month-closing/page.tsx`](../../../src/app/dashboard/financial/month-closing/page.tsx) → [`MonthClosingPage`](../../../src/features/financial/month-closing/month-closing-page.tsx)) e tela do fluxo [`month-closing/expenses/page.tsx`](../../../src/app/dashboard/financial/month-closing/expenses/page.tsx) → [`ExpensesFlowPage`](../../../src/features/financial/month-closing/expenses-flow-page.tsx). A competência vem de `?month=AAAA-MM`; sem ela, o mês anterior ao atual no fuso `America/Belem`, nunca antes de agosto de 2026 (início da DRE).
- Entrada na barra lateral do Financeiro (“Fechamento do mês”), visível para o administrador padrão ou para quem tem `financial.view` e `financial.monthClosings.view`.
- Os cinco fluxos aparecem na tela inicial. Só **Despesas** é calculado. **Vendas, Recebimento, Taxas e DRE** aparecem como “Ainda não conectado”, sem números. Detalhe de cada um fica para as próximas etapas do plano.
- A análise mostra a situação e leva à tela de origem. Ações como pagar, vincular, cancelar ou ajustar ficam em [Despesas](expenses.md), [Faturas de cartão](card-statements.md) e no extrato. Um item parcelado abre o título de origem com `?competence=&expense=&installment=`.

## Percurso observado

1. A página chama [`useMonthClosing`](../../../src/features/financial/month-closing/use-month-closing.ts), que faz uma leitura `GET /api/financial/month-closing?month=` pelo cliente autenticado compartilhado. Sem polling nem listener; atualiza ao trocar a competência ou por “Tentar de novo”.
2. A rota [`api/financial/month-closing/route.ts`](../../../src/app/api/financial/month-closing/route.ts) usa `secureRoute` (contrato `financial.month-closing.overview`): valida `month` (`AAAA-MM`, de 2026-08 até o mês atual), autentica, exige a permissão (`assertMonthClosingAccess`) e chama [`getMonthClosingOverview`](../../../src/features/financial/month-closing/overview.server.ts).
3. O serviço seleciona `expenses` com competência do título igual ao mês ou `paymentMethod == "installments"`. A consulta usa uma união com a chave de documento, em páginas de 250. Isso inclui títulos legados com parcelas no mês e competência do título em outro período. `cardStatements` é consultada pelo `monthKey`. Os limites são de 1.500 despesas e 60 faturas. Se ultrapassados, a API responde 409 `MONTH_CLOSING_LIMIT_EXCEEDED`.
4. [`evaluateExpensesFlow`](../../../src/features/financial/month-closing/expenses-flow.ts) usa o [contrato central da despesa](../../../src/features/financial/lib/expense-accounting-contract.ts), compartilhado com Despesas. Títulos parcelados avulsos entram pelo vencimento de cada parcela. Cartão entra pelo ciclo da fatura. Estado, baixa e saldo pertencem à parcela relevante. [`expense-display-state`](../../../src/features/financial/lib/expense-display-state.ts) calcula vencidos e saldos.

## Regras de classificação (Despesas)

| Conferência | Conferido quando | Observações |
| --- | --- | --- |
| Previsões e rascunhos resolvidos | nenhuma previsão (`provisionType: forecast`) sem valor real e nenhum rascunho | Previsão `reconciled` conta como resolvida. |
| Pagas e vinculadas ao extrato | título pago com `settlementSummary.paymentEvidenceStatus` CONFIRMED/MIXED e `reconciliationStatus` MATCHED, ou parcela paga com o próprio `linkedBankTransactionId` | **Dinheiro** (`plannedPaymentMethodType: cash`) conta pela baixa do fechamento de caixa. Pago sem confirmação no extrato, só informado, divergente e “pagamento encontrado sem documento” são pendências. Parcela parcialmente paga considera seu pagamento e seus créditos registrados. |
| Fatura do cartão | fatura da competência com `status: paid` | Compra no cartão é conferida pela fatura, não como título avulso. Fatura fechada aguarda pagamento (vencida vira pendência que depende de quem opera); aberta pende; compra no cartão sem fatura importada pende. |
| Folha e encargos | — | **Fonte não conectada** (fechamento do DP em outro banco). Nunca aparece como conferido. |
| Caixa de documentos | — | **Fonte não conectada**. Idem. |

Exclusões iguais às da lista de Despesas: `cancelled`, `reconciled` não previsão, `hiddenFromExpensePanel` e `budgetMigration`. Fluxo sem pendência, mas com fonte não conectada, fica **“Fonte não conectada”**, não “Conferido”.

## Dados e acesso

| Dado ou coleção | Operação | Fonte | Quem pode ler e onde é verificado |
| --- | --- | --- | --- |
| `expenses` (banco financeiro) | leitura da competência e dos títulos parcelados | `overview.server.ts` | Rota: `financial.view` + `financial.monthClosings.view`; itens (descrição, fornecedor, valor) só com `financial.expenses.view`. |
| `cardStatements` | leitura por competência | `overview.server.ts` | Mesma rota. |
| Nenhuma | escrita | — | Não há escrita nem auditoria nesta etapa. |

- Permissão nova: `financial.monthClosings` = `{ view, close, reopen }` ([`src/types/index.ts`](../../../src/types/index.ts)), opcional para não quebrar perfis salvos (ausência = negado). Administrador padrão tem tudo. `close` e `reopen` aparecem no perfil mas **não têm efeito** ainda. Perfis existentes que precisem da tela exigem ajuste manual.
- O fechamento é **da empresa inteira**, sem filtro por unidade (a tabela por quiosque ainda não existe). Quem tem a permissão enxerga os totais da empresa; os itens dependem de `financial.expenses.view`.
- Não há dado pessoal novo persistido; as leituras usam coleções já existentes.

## Custo de leitura (Firestore)

Por abertura de tela, até 1.500 despesas e 60 faturas, com uma sentinela por fonte. O volume depende dos títulos do mês e do histórico de títulos parcelados. Cada documento encontrado nos dois filtros da união conta uma vez. Sem listeners, polling ou cache entre telas.

## Verificação e limites

- Testes: [`financial-month-closing-expenses-flow`](../../../tests/unit/financial-month-closing-expenses-flow.test.ts) (classificação, vencimento, cartão, dinheiro, datas sem deslocamento de fuso, fonte não conectada, ocultação de itens) e [`financial-month-closing-access-and-month`](../../../tests/unit/financial-month-closing-access-and-month.test.ts) (permissões, fuso, intervalo, apresentação).
- A regressão de parcelas cobre a distribuição entre competências, a baixa individual, o saldo parcial, o vencimento legado à meia-noite UTC e o ciclo de cartão com vencimento no mês seguinte. Validação visual e rota HTTP completa permanecem pendentes. Títulos avulsos legados sem `settlementSummary` podem continuar pendentes mesmo quando o débito existe no extrato.
- Em 21/11/2026, a consulta nova de despesas e o avaliador local foram executados sobre outubro e novembro em leitura. Foram 166 e 95 despesas candidatas, respectivamente. Um título parcelado com competência contábil de outubro entrou com suas duas parcelas de novembro e nenhuma em outubro. A terceira parcela do mesmo título foi projetada em dezembro.
- Hipóteses a confirmar: dinheiro conta pela baixa do caixa; pagamento só informado não basta; fatura de cartão só conta como conferida quando `paid`.
- Lacunas conhecidas: Folha, Caixa de documentos, tabela por quiosque, Bancos (saldo final) e os demais quatro fluxos.
