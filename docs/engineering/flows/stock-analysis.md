# Análises, projeções e valor de estoque

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As páginas de [consumo](../../../src/app/dashboard/stock/analysis/consumption/page.tsx), [movimentos](../../../src/app/dashboard/stock/analysis/movement-analysis/page.tsx), [projeção](../../../src/app/dashboard/stock/analysis/projection/page.tsx), [reposição](../../../src/app/dashboard/stock/analysis/restock/page.tsx), [vendas](../../../src/app/dashboard/stock/analysis/sales/page.tsx) e [valorização](../../../src/app/dashboard/stock/analysis/valuation/page.tsx) montam componentes distintos. Consumo, projeção, reposição e valorização têm guards `stock.analysis.*` nas páginas; conferir acesso das telas de movimento e vendas separadamente.

[`MovementAnalysis`](../../../src/components/movement-analysis.tsx) cruza histórico de movimento, produtos, insumos e consumo validado. [`ConsumptionProjection`](../../../src/components/consumption-projection.tsx) usa lotes, insumos, produtos e relatórios de consumo validado para simular risco. [`StockValuation`](../../../src/components/stock-valuation.tsx) combina lotes e histórico de preço de compras para valor. [`RestockAnalysis`](../../../src/components/restock-analysis.tsx) calcula sugestão local e cria solicitação/atividade via hooks; a escrita final é descrita em [reposição](stock-requests-reposition-returns.md). O painel de consumo pode chamar [`/api/ai/analyze-consumption`](../../../src/app/api/ai/analyze-consumption/route.ts), caminho separado das fórmulas locais.

As fontes incluem `lots`, `movementHistory`, `consumptionReports`, `salesReports`, `priceHistory`, `baseProducts` e `products`; o índice de [entradas candidatas](../flow-entrypoints.md) ajuda a localizar hooks. Antes de alterar cálculo, conferir unidade de medida, período, lote expirado, custo efetivo e permissões de cada fonte. `npm run check` passou; faltam testes de fórmula e verificação de consultas por unidade para marcar `Verificado`.

## Fórmulas, dados e efeitos rastreados

[`StockValuation`](../../../src/components/stock-valuation.tsx) seleciona lotes positivos da unidade, converte tamanho de embalagem para unidade do insumo e multiplica quantidade × tamanho convertido × custo efetivo (fallback inicial). Soma por insumo e total; histórico carregado não significa que o cálculo usa custo da data de entrada. [`ConsumptionProjection`](../../../src/components/consumption-projection.tsx) usa consumo validado, média diária ajustada pela simulação e lotes em unidade base; calcula ruptura por estoque/média e percorre lotes para estimar fim de consumo, perda por vencimento e custo. Sem consumo/conversão/validade há estados específicos, não estimativa confiável implícita.

[`RestockAnalysis`](../../../src/components/restock-analysis.tsx) desconta reservas, converte embalagens, calcula `max(0, mínimo − disponível)` e sugere lotes disponíveis da matriz por validade. Sugestão não grava saldo; criação de solicitação/atividade entra no [fluxo de reposição](stock-requests-reposition-returns.md). [`MovementAnalysis`](../../../src/components/movement-analysis.tsx) reconstrói entradas/saídas/transferências por período e unidade após corte de auditoria de abril/2026, compara consumo teórico com saídas e calcula médias históricas por mês e volatilidade por desvio/média. Divergência é consumo teórico menos saídas; não ajusta automaticamente lotes.

Relatórios de vendas e consumo derivam da [sincronização PDV](pdv-sync.md); análise IA é caminho separado de sugestão. Filtros de tela não alteram listeners/fallbacks globais dos providers de lotes/produtos. Consumidores compartilham unidades e custos, mas indicadores do painel inicial, reposição e valorização não têm fórmula idêntica. Verificação por unidade, período, conversão e volume fica na etapa 2.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
