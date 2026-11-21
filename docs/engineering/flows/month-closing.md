# Fechamento financeiro mensal: tela inicial e fluxos de Despesas, Vendas e Taxas (somente leitura)

**Estado:** localizado. **Base:** `origin/main` `73236fb8`, 20/11/2026, com a implementação local desta mudança. Descreve comportamento implementado; decisões aprovadas estão no [plano](../../planos/plano-fechamento-financeiro-mensal.md). Fechar, reabrir, travar a competência e relatório **não existem ainda**.

## Escopo e entradas

- Tela inicial **Financeiro › Fechamento do mês** ([`month-closing/page.tsx`](../../../src/app/dashboard/financial/month-closing/page.tsx) → [`MonthClosingPage`](../../../src/features/financial/month-closing/month-closing-page.tsx)) e tela do fluxo [`month-closing/expenses/page.tsx`](../../../src/app/dashboard/financial/month-closing/expenses/page.tsx) → [`ExpensesFlowPage`](../../../src/features/financial/month-closing/expenses-flow-page.tsx). A competência vem de `?month=AAAA-MM`; sem ela, o mês anterior ao atual no fuso `America/Belem`, nunca antes de agosto de 2026 (início da DRE).
- Entrada na barra lateral do Financeiro (“Fechamento do mês”), visível para o administrador padrão ou para quem tem `financial.view` e `financial.monthClosings.view`.
- Os cinco fluxos aparecem na tela inicial. **Despesas, Vendas e Taxas** são calculados; **Recebimento e DRE** aparecem como “Ainda não conectado”, sem números (Recebimento é um dos últimos: o crédito a 30 dias só fecha depois). Só Despesas tem tela de detalhe; Vendas e Taxas levam direto à tela de origem, já no mês e no vínculo Stone da pendência. Cada fluxo fica **Conferido sozinho** quando todas as suas conferências estão ok; só o fechamento do mês será manual (etapa futura).
- Fora deste fluxo: tratar a pendência (pagar, vincular, cancelar, ajustar) continua nas telas de [Despesas](expenses.md), [Faturas de cartão](card-statements.md) e do extrato. As telas do fechamento só mostram a situação e levam à tela de origem pelo filtro da URL (`?competence=`, `?expense=`, `?month=`, `accountId`, `paymentMethodId`).

## Percurso observado

1. A página chama [`useMonthClosing`](../../../src/features/financial/month-closing/use-month-closing.ts), que faz uma leitura `GET /api/financial/month-closing?month=` pelo cliente autenticado compartilhado. Sem polling nem listener; atualiza ao trocar a competência ou por “Tentar de novo”.
2. A rota [`api/financial/month-closing/route.ts`](../../../src/app/api/financial/month-closing/route.ts) usa `secureRoute` (contrato `financial.month-closing.overview`): valida `month` (`AAAA-MM`, de 2026-08 até o mês atual), autentica, exige a permissão (`assertMonthClosingAccess`) e chama [`getMonthClosingOverview`](../../../src/features/financial/month-closing/overview.server.ts).
3. O serviço lê `expenses` por `competenceMonth` (páginas de 250, teto de 1.500, acima disso responde 409 `MONTH_CLOSING_LIMIT_EXCEEDED` em vez de truncar) e `cardStatements` por `monthKey` (teto de 60), e entrega a [`evaluateExpensesFlow`](../../../src/features/financial/month-closing/expenses-flow.ts), função pura e testada.
4. A avaliação reaproveita [`expense-display-state`](../../../src/features/financial/lib/expense-display-state.ts) para a regra de “Vencido” e o [contrato de conciliação](../../../src/features/financial/obligations/expense-reconciliation.ts) para a situação de pagamento, tal como no detalhe de Despesas. O backend consulta débitos antigos por vínculos persistidos apenas para despesas pagas que precisam dessa evidência. O limite é de 1.500 documentos de transação, com leitura adicional para detectar estouro. A resposta contém conferências, pendências ordenadas (vencidas primeiro, depois por data) e totais.

## Regras de classificação (Despesas)

| Conferência | Conferido quando | Observações |
| --- | --- | --- |
| Previsões e rascunhos resolvidos | nenhuma previsão (`provisionType: forecast`) sem valor real e nenhum rascunho | Previsão `reconciled` conta como resolvida. |
| Pagamentos conferidos | título pago com baixa confirmada pela regra compartilhada com Despesas | Reconhece baixa bancária atual, débito antigo vinculado e pagamento em dinheiro baixado pelo caixa. Pagamento informado, sem vínculo, divergente ou com valor real da despesa a conferir fica pendente. Vencido indica saldo aberto após o vencimento. |
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
| `expenses` (banco financeiro) | leitura por competência | `overview.server.ts` | Rota: `financial.view` + `financial.monthClosings.view`; itens (descrição, fornecedor, valor) só com `financial.expenses.view`. |
| `cardStatements` | leitura por competência | `overview.server.ts` | Mesma rota. |
| `transactions` | leitura por vínculo persistido | `expense-reconciliation.server.ts` | O backend usa a evidência no cálculo. A resposta expõe a contagem e, com `financial.expenses.view`, os itens de Despesas. |
| `stoneMerchantMappings` (workspace, até 100), `kiosks`, `dailySalesReviews`, decisões/ocorrências/conferências Stone | leitura | `sales-fees.server.ts` | Rota igual; itens de Vendas e Taxas só administrador padrão (`canViewMonthClosingStoneItems`). |
| Nenhuma | escrita | — | Não há escrita nem auditoria nesta etapa. |

- Permissão nova: `financial.monthClosings` = `{ view, close, reopen }` ([`src/types/index.ts`](../../../src/types/index.ts)), opcional para não quebrar perfis salvos (ausência = negado). Administrador padrão tem tudo. `close` e `reopen` aparecem no perfil mas **não têm efeito** ainda. Perfis existentes que precisem da tela exigem ajuste manual.
- O fechamento é **da empresa inteira**, sem filtro por unidade (a tabela por quiosque ainda não existe). Quem tem a permissão enxerga os totais da empresa; os itens dependem de `financial.expenses.view`.
- Não há dado pessoal novo persistido; as leituras usam coleções já existentes.

## Custo de leitura (Firestore)

Por abertura de tela: até 1.500 leituras de despesas + até 60 de faturas; típico de uma competência, centenas. **Vendas:** até 31 leituras do calendário por vínculo Stone (cerca de 100 com três quiosques). **Taxas:** por vínculo, até 6 conferências mensais salvas, decisões (≤2.000), ocorrências (≤500) e referências de taxa; estimativa de centenas por vínculo, na ordem de 1.000 a 2.000 leituras por abertura com três quiosques. Cenário de 20 aberturas no mês: cerca de 20 a 40 mil leituras adicionais. Cenário 10 aberturas/dia × 22 dias: até 330.000 leituras/mês no teto, tipicamente 30 mil a 70 mil. Sem listeners nem polling; a tela de Despesas e a inicial leem de novo a cada abertura (sem cache entre telas).

## Verificação e limites

- Testes: [`financial-month-closing-expenses-flow`](../../../tests/unit/financial-month-closing-expenses-flow.test.ts) (classificação, vencimento, cartão, dinheiro, datas sem deslocamento de fuso, ocultação de itens) e [`financial-month-closing-access-and-month`](../../../tests/unit/financial-month-closing-access-and-month.test.ts) (permissões, fuso, intervalo, apresentação).
- **Não verificado:** dados reais (a classificação ainda não foi executada sobre outubro), navegador/visual, rota HTTP ponta a ponta em emulador, e a hipótese de que `settlementSummary` está preenchido nas despesas já pagas (despesas antigas sem ele aparecerão como “Sem vínculo no extrato”).
- Hipóteses a confirmar: dinheiro conta pela baixa do caixa; pagamento só informado não basta; fatura de cartão só conta como conferida quando `paid`.
- Testes de Vendas e Taxas: [`financial-month-closing-sales-fees-flow`](../../../tests/unit/financial-month-closing-sales-fees-flow.test.ts) e [`financial-month-closing-stone-bindings`](../../../tests/unit/financial-month-closing-stone-bindings.test.ts). A leitura do servidor (`sales-fees.server.ts`) não tem teste automatizado nem foi executada com dados reais.
- Lacunas conhecidas: tabela por quiosque, Bancos (saldo final), Recebimento e DRE, e o reconhecimento da taxa na competência.
