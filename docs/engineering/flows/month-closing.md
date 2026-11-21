# Fechamento financeiro mensal: tela inicial e fluxo de Despesas (somente leitura)

**Estado:** localizado. **Base:** `origin/main` `73236fb8`, 20/11/2026, com a implementação local desta mudança. Descreve comportamento implementado; decisões aprovadas estão no [plano](../../planos/plano-fechamento-financeiro-mensal.md). Fechar, reabrir, travar a competência e relatório **não existem ainda**.

## Escopo e entradas

- Tela inicial **Financeiro › Fechamento do mês** ([`month-closing/page.tsx`](../../../src/app/dashboard/financial/month-closing/page.tsx) → [`MonthClosingPage`](../../../src/features/financial/month-closing/month-closing-page.tsx)) e tela do fluxo [`month-closing/expenses/page.tsx`](../../../src/app/dashboard/financial/month-closing/expenses/page.tsx) → [`ExpensesFlowPage`](../../../src/features/financial/month-closing/expenses-flow-page.tsx). A competência vem de `?month=AAAA-MM`; sem ela, o mês anterior ao atual no fuso `America/Belem`, nunca antes de agosto de 2026 (início da DRE).
- Entrada na barra lateral do Financeiro (“Fechamento do mês”), visível para o administrador padrão ou para quem tem `financial.view` e `financial.monthClosings.view`.
- Os cinco fluxos aparecem na tela inicial. Só **Despesas** é calculado. **Vendas, Recebimento, Taxas e DRE** aparecem como “Ainda não conectado”, sem números. Detalhe de cada um fica para as próximas etapas do plano.
- Fora deste fluxo: tratar a pendência (pagar, vincular, cancelar, ajustar) continua nas telas de [Despesas](expenses.md), [Faturas de cartão](card-statements.md) e do extrato. As telas do fechamento só mostram a situação e levam à tela de origem pelo filtro da URL (`?competence=`, `?expense=`, `?month=`, `accountId`, `paymentMethodId`).

## Percurso observado

1. A página chama [`useMonthClosing`](../../../src/features/financial/month-closing/use-month-closing.ts), que faz uma leitura `GET /api/financial/month-closing?month=` pelo cliente autenticado compartilhado. Sem polling nem listener; atualiza ao trocar a competência ou por “Tentar de novo”.
2. A rota [`api/financial/month-closing/route.ts`](../../../src/app/api/financial/month-closing/route.ts) usa `secureRoute` (contrato `financial.month-closing.overview`): valida `month` (`AAAA-MM`, de 2026-08 até o mês atual), autentica, exige a permissão (`assertMonthClosingAccess`) e chama [`getMonthClosingOverview`](../../../src/features/financial/month-closing/overview.server.ts).
3. O serviço lê `expenses` por `competenceMonth` (páginas de 250, teto de 1.500, acima disso responde 409 `MONTH_CLOSING_LIMIT_EXCEEDED` em vez de truncar) e `cardStatements` por `monthKey` (teto de 60), e entrega a [`evaluateExpensesFlow`](../../../src/features/financial/month-closing/expenses-flow.ts), função pura e testada.
4. A avaliação reaproveita [`expense-display-state`](../../../src/features/financial/lib/expense-display-state.ts) (mesma regra de “Vencido” da lista de Despesas) e devolve conferências, pendências ordenadas (vencidas primeiro, depois por data) e totais.

## Regras de classificação (Despesas)

| Conferência | Conferido quando | Observações |
| --- | --- | --- |
| Previsões e rascunhos resolvidos | nenhuma previsão (`provisionType: forecast`) sem valor real e nenhum rascunho | Previsão `reconciled` conta como resolvida. |
| Pagas e vinculadas ao extrato | título pago com `settlementSummary.paymentEvidenceStatus` CONFIRMED/MIXED e `reconciliationStatus` MATCHED | **Dinheiro** (`plannedPaymentMethodType: cash`) conta pela baixa do fechamento de caixa. Pago sem confirmação no extrato, só informado, divergente e “pagamento encontrado sem documento” são pendências. Vencido = saldo em aberto após o vencimento; a vencer aguarda a data. |
| Fatura do cartão | fatura da competência com `status: paid` | Compra no cartão é conferida pela fatura, não como título avulso. Fatura fechada aguarda pagamento (vencida vira pendência que depende de quem opera); aberta pende; compra no cartão sem fatura importada pende. |

Exclusões iguais às da lista de Despesas: `cancelled`, `reconciled` não previsão, `hiddenFromExpensePanel` e `budgetMigration`. O fluxo só confere despesas: fica “Conferido” quando previsões, títulos pagos e vinculados ao extrato e fatura do cartão estão resolvidos. Folha e Caixa de documentos não são conferências do fluxo (decisão de 2026-11-21): a folha entra como despesa provisionada e a caixa de cobranças é tratada em Cobranças.

## Dados e acesso

| Dado ou coleção | Operação | Fonte | Quem pode ler e onde é verificado |
| --- | --- | --- | --- |
| `expenses` (banco financeiro) | leitura por competência | `overview.server.ts` | Rota: `financial.view` + `financial.monthClosings.view`; itens (descrição, fornecedor, valor) só com `financial.expenses.view`. |
| `cardStatements` | leitura por competência | `overview.server.ts` | Mesma rota. |
| Nenhuma | escrita | — | Não há escrita nem auditoria nesta etapa. |

- Permissão nova: `financial.monthClosings` = `{ view, close, reopen }` ([`src/types/index.ts`](../../../src/types/index.ts)), opcional para não quebrar perfis salvos (ausência = negado). Administrador padrão tem tudo. `close` e `reopen` aparecem no perfil mas **não têm efeito** ainda. Perfis existentes que precisem da tela exigem ajuste manual.
- O fechamento é **da empresa inteira**, sem filtro por unidade (a tabela por quiosque ainda não existe). Quem tem a permissão enxerga os totais da empresa; os itens dependem de `financial.expenses.view`.
- Não há dado pessoal novo persistido; as leituras usam coleções já existentes.

## Custo de leitura (Firestore)

Por abertura de tela: até 1.500 leituras de despesas + até 60 de faturas; típico de uma competência, centenas. Cenário 10 aberturas/dia × 22 dias: até 330.000 leituras/mês no teto, tipicamente 30 mil a 70 mil. Sem listeners nem polling; a tela de Despesas e a inicial leem de novo a cada abertura (sem cache entre telas).

## Verificação e limites

- Testes: [`financial-month-closing-expenses-flow`](../../../tests/unit/financial-month-closing-expenses-flow.test.ts) (classificação, vencimento, cartão, dinheiro, datas sem deslocamento de fuso, ocultação de itens) e [`financial-month-closing-access-and-month`](../../../tests/unit/financial-month-closing-access-and-month.test.ts) (permissões, fuso, intervalo, apresentação).
- **Não verificado:** dados reais (a classificação ainda não foi executada sobre outubro), navegador/visual, rota HTTP ponta a ponta em emulador, e a hipótese de que `settlementSummary` está preenchido nas despesas já pagas (despesas antigas sem ele aparecerão como “Sem vínculo no extrato”).
- Hipóteses a confirmar: dinheiro conta pela baixa do caixa; pagamento só informado não basta; fatura de cartão só conta como conferida quando `paid`.
- Lacunas conhecidas: tabela por quiosque, Bancos (saldo final) e os demais quatro fluxos.
