# Análise de custo e comparação de preços

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As páginas de [custo](../../../src/app/dashboard/pricing/cost-analysis/page.tsx) e [comparação](../../../src/app/dashboard/pricing/price-comparison/page.tsx) usam `pricing.view`. [`PricingSimulator`](../../../src/components/pricing-simulator.tsx) calcula preço, CMV e margem por canal com simulações, insumos, histórico e parâmetros. [`ProductSimulationProvider`](../../../src/components/product-simulation-provider.tsx) lê diretamente `productSimulations`, `productSimulationItems`, `simulationPriceHistory` e `priceOverrides`, e grava alterações pelo SDK cliente; [`ChannelsProvider`](../../../src/components/channels-provider.tsx) lê `channels` e resolve preços por canal. A [comparação](../../../src/components/price-comparison-table.tsx) usa dados de [`CompetitorProvider`](../../../src/components/competitor-provider.tsx), que escreve `concorrentes`, `concorrente_produtos`, `concorrente_precos` e grupos.

O endpoint [`/api/catalogo`](../../../src/app/api/catalogo/route.ts) fornece fichas técnicas a quem passa `canViewTechnicalSheets`; ver [catálogo](catalog.md). A função de preço pode afetar vendas, metas e DRE, mas nenhuma escrita nesse domínio deve ser tratada como regra aprovada sem conferir [regras de negócio](../business-rules.md). Conferir [`firestore.rules`](../../../firestore.rules) para as mutações diretas, origem do custo e precedência entre balcão, canal e exceção. `npm run check` passou; faltam testes de fórmulas, permissão e histórico antes de marcar `Verificado`.

## Fórmulas, precedência e escrita rastreadas

[`ProductSimulationProvider`](../../../src/components/product-simulation-provider.tsx) soma quantidade de item × custo do insumo (`lastEffectivePrice.pricePerUnit`, fallback `initialCostPerUnit`). Override de custo é convertido da unidade declarada para base; item sem insumo/quantidade é ignorado e erro de conversão não acrescenta custo, limite que pode subestimar CMV. [`calculateSimulationMetrics`](../../../src/lib/pricing-context.ts) calcula receita líquida = preço × (1 − imposto/100 − taxa/100), lucro = líquida − CMV, lucro percentual sobre preço, markup preço/CMV e margem bruta preço − CMV, com guardas para denominadores zero.

A resolução contextual no mesmo arquivo rejeita canal inativo; prioriza override unidade+canal, depois regra/unidade aplicável, override de canal e preço global, preservando disponibilidade. IDs de override incluem simulação/unidade/canal. Criação da simulação precede batch de itens; edição/recriação de itens e histórico usam batches no provider, e exclusão de override é direta. Assim, listeners exibem recalculado conforme custo atual; não é garantia de preço histórico de uma venda. [Regras Firestore](../../../firestore.rules) em `productSimulations`, `productSimulationItems`, `simulationPriceHistory`, `priceOverrides` e concorrentes são a fronteira de autorização do SDK. Revisão de fórmula/concorrência e histórico pertence à verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
