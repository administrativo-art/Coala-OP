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


## Arredondamento do preço automático por canal — 27/11/2026

A regra de acréscimo passa por `calculateAutomaticChannelPrice`, em
[`pricing-context.ts`](../../../src/lib/pricing-context.ts), antes de devolver o
preço efetivo. O resultado é normalizado em centavos; de 0 a 39 centavos desce
para o real inteiro e de 40 a 99 centavos sobe para o próximo real. Exemplos:
R$ 30,39 → R$ 30,00; R$ 30,40 → R$ 31,00. Um cálculo com mais casas, como
R$ 30,399, primeiro corresponde a R$ 30,40 e resulta em R$ 31,00. A normalização
compensa diferenças de representação numérica no limite do centavo.

Os dois caminhos da regra automática (preço global ou preço da unidade) e a
prévia do editor compartilham o mesmo helper. Para o exemplo do iFood com base
R$ 20,00 e acréscimo de 36,05%, R$ 27,21 calculados resultam em R$ 27,00. Lista,
ficha e métricas que usam o preço resolvido recebem esse valor final; a margem é
calculada sobre ele. Não se arredondam imposto, percentual de acréscimo ou CMV.

Preços manuais por canal/unidade e o preço de balcão mantêm seus centavos. A
precedência e a disponibilidade permanecem como antes. O cálculo é derivado,
sem migração, alteração de overrides ou regravação do histórico de vendas.
O painel **Preços por canal** identifica **Regra do canal · arredondado** e tem
um `InfoPopover` no cabeçalho e na caixa da regra do editor, acionável por
clique, toque ou teclado, com alcance e exemplos do corte.

Regressão dirigida em `tests/unit/pricing-context.test.ts`: limites de centavos,
normalização, preço global/unidade, reajuste, exceções manuais, indisponibilidade
e métricas do preço final. Nenhuma consulta, listener, permissão ou fonte de
dados nova; custo recorrente adicional de Firestore: zero. Verificação global
do fluxo segue distinta da cobertura desses cálculos.

As prévias de criação e edição da regra nos Parâmetros também usam o cálculo final arredondado compartilhado, inclusive o exemplo de base R$ 12,00.
