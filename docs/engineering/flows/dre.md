# DRE: fontes de receita, despesa e CMV

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página DRE](../../../src/app/dashboard/financial/dre/page.tsx) monta [`DrePage`](../../../src/features/financial/pages/dre-page.tsx). O cliente busca contas e centros de resultado pela coleção financeira e pede dados de unidades/períodos a [`GET /api/financial/dre/source-data`](../../../src/app/api/financial/dre/source-data/route.ts). Quando o critério de CMV é movimentação de estoque, também chama [`GET /api/financial/dre/stock-cmv`](../../../src/app/api/financial/dre/stock-cmv/route.ts). As duas rotas limitam a 20 unidades e seis competências, exigem permissão DRE e verificam o acesso a cada unidade. A rota de fontes também omite detalhes de despesas para quem não possui `financial.expenses.view`.

| Indicador/fonte | Origem observada |
| --- | --- |
| Vendas | [`salesReports`](../../../src/features/financial/dre/source-data.server.ts) filtrados por ano/mês/unidade, com CMV da simulação em `productSimulations`. Relatórios sem itens ou fora das unidades pedidas não entram. |
| Despesas | `expenses` do banco financeiro por `competenceMonth`, normalizadas pelo [contrato contábil](../../../src/features/financial/lib/expense-accounting-contract.ts). |
| Caixa | `cashClosureMonthlySummaries` por workspace/unidade/competência. [Fonte](../../../src/features/financial/dre/source-data.server.ts), [fechamento](cash-closures.md). |
| CMV por estoque | [`movementHistory`](../../../src/features/financial/dre/stock-cmv.server.ts) de saídas da unidade, mais `products`, `baseProducts` e `effective_cost_history`. O cálculo de resumo está em [`stock-cmv.ts`](../../../src/features/financial/dre/stock-cmv.ts). |

As consultas paginam e têm limites explícitos: 5.000 relatórios ou despesas por período, 5.000 simulações, 25.000 movimentos, 5.000 produtos e 10.000 registros de custo. Exceder o limite resulta em erro operacional nas [rotas](../../../src/app/api/financial/dre/source-data/route.ts), em vez de resposta parcial silenciosa.

## Dados, permissão e impacto

**Inferência de impacto:** alteração em vendas, competência de despesa, fechamento de caixa, movimentos ou custo efetivo pode mudar indicadores sem tocar na página DRE. Por isso, investigação de divergência deve começar pela fonte indicada na linha correspondente e conferir o filtro de unidade, período, classificação e critério de CMV. A [página](../../../src/features/financial/pages/dre-page.tsx) combina os resultados e cálculos de despesas; diferenças entre CMV de simulação e de saída de estoque são esperadas quando os critérios selecionados não são os mesmos.

## Verificação e limites

Os [testes de fontes](../../../tests/unit/dre-source-data.test.ts), [CMV de estoque](../../../tests/unit/dre-stock-cmv.test.ts) e [detalhes de despesas](../../../tests/unit/financial-dre-expense-details.test.ts) são referências. Para mudanças, conferir período/unidade, ausência de simulação, despesa sem detalhe autorizado, limite excedido e escolha de CMV. Este guia não valida todos os totais visuais nem exportações ponta a ponta.

## Apresentação, critérios e exportação rastreados

Na [página](../../../src/features/financial/pages/dre-page.tsx), receita por unidade/competência prefere resumo de fechamento quando disponível e usa vendas como fallback. CMV de composição soma o custo de simulação das vendas; critério de estoque agrega consumo, perda e ajuste dos movimentos. Despesas passam por [`calculateDreExpenses`](../../../src/features/financial/lib/dre-expense-calculation.ts), competência, centro de resultado e posição de plano; antes de `FINANCIAL_DRE_START_MONTH_KEY`, não são incluídas pelo cálculo da página.

Receita líquida = bruta − impostos/deduções; margem bruta subtrai CMV; contribuição subtrai custos variáveis; resultado operacional subtrai pessoal, operação, ocupação e não categorizadas. Resultado antes dos impostos incorpora receitas/despesas financeiras e não operacionais; líquido subtrai impostos do resultado. Ponto de equilíbrio divide fixos pela margem de contribuição relativa, quando positiva. Detalhes de pessoal e sua exportação têm permissões específicas.

`exportCsv` usa esses mesmos dados e bloqueios de integridade; fonte com erro, simulação ausente, cadastro/classificação inválida ou critério estoque sem movimentos impedem exportação útil conforme avisos da tela. CSV é artefato local, sem escrita no financeiro. Concordância dos totais com fontes reais e testes de todos os filtros continuam na etapa de verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.

## Comparativo de orçamento pessoal

[Source-data](../../../src/features/financial/dre/source-data.server.ts) inclui `budgetPlanning`, exibido separadamente pela [página](../../../src/features/financial/pages/dre-page.tsx) e pelo [quadro](../../../src/features/financial/components/dre/budget-planning-comparison.tsx). [Projeções](../../../src/features/financial/budgets/projections.server.ts) consultam orçamentos com composição em centros inteiramente autorizados, comparam orçado/comprometido/residual e informam conflitos. Sem permissão de pessoal, substituem nomes nominais. Não criam despesas nem alteram o cálculo contábil. Ver [orçamentos](financial-budgets.md).
