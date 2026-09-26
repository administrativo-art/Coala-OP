# Página inicial de gestão

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

A [página inicial](../../../src/app/dashboard/page.tsx) usa `dashboard.view` para o painel de gestão e redireciona quem tem apenas `dashboard.collaborator` à visão própria. Ela reúne metas, vendas, consumo, produtos/lotes, tarefas, escalas, férias e despesas por [hooks de domínio](../../../src/hooks/use-all-tasks.tsx) e [`useFinancialCollection`](../../../src/features/financial/hooks/use-financial-collection.tsx). Receita atual/projetada, reposição crítica e obrigações próximas são calculadas na página; fontes e janelas de tempo devem ser comparadas aos guias de [metas](goals.md), [estoque](stock-control.md), [financeiro](financial-overview.md) e [tarefas](tasks.md).

O fluxo observado é principalmente leitura e navegação; não há contrato único de servidor para todos os cartões. Os hooks carregam dados de vários domínios, portanto a permissão do painel não comprova visibilidade de cada coleção. Antes de adicionar cartão ou alterar indicador, conferir regras de cada fonte, escopo por unidade, custo de listeners e indicador canônico. `npm run check` passou; não há teste integrado do conjunto de cartões registrado.

## Indicadores e efeitos rastreados

Na [página inicial](../../../src/app/dashboard/page.tsx), receita soma quantidade × preço unitário dos relatórios do mês atual, com fallback para o período do primeiro relatório disponível. Projeção do mês atual divide receita pelos dias distintos reportados (fallback: dia do mês) e multiplica pelos dias do mês; período fechado usa receita efetiva. Comparação ao mês anterior limita relatórios diários ao mesmo dia decorrido. Metas agregam `currentValue` e `targetValue` por unidade e calculam proporção; tarefas pendentes incluem `pending`, `reopened`, `in_progress`, `awaiting_approval`, e atraso compara vencimento ao início de hoje.

Reposição crítica identifica CD por nome/ID, soma quantidade menos reserva por insumo, compara com mínimo/estoque de segurança e estima ruptura por consumo diário dos demais quiosques no mês, antecipando pedido pelo lead time. Esse cálculo local soma quantidades dos lotes sem conversão de embalagem nesse trecho, limite a validar com o relatório de estoque. Não escreve saldo. Despesas só são consultadas pelo hook se `financial.view`; demais fontes mantêm suas próprias autorizações. Filtros e diálogos são locais e atalhos levam aos fluxos canônicos. Testes dos indicadores e escopo dos hooks permanecem na verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
