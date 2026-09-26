# Painel de operações: agregação e encaminhamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página `/dashboard/operations`](../../../src/app/dashboard/operations/page.tsx) usa `useAuth` e exige `dashboard.view` para renderizar o painel. Ela lê lotes e produtos por seus providers, remove itens de uniforme e restringe os lotes visíveis com `canAccessUnit` **em memória**. Calcula contagens de lotes vencendo em sete dias, vencidos e ativos; o cartão leva ao [controle de estoque](stock-control.md). [`ExpiryProductsProvider`](../../../src/hooks/use-expiry-products.tsx) alimenta o painel com listener `lots` sem filtro/limite antes do filtro por unidade na página.

As abas montam [`PurchaseAlertCard`](../../../src/components/purchase-alert-card.tsx), [`RestockPanel`](../../../src/components/restock-panel.tsx), [`AuditDashboard`](../../../src/components/audit-dashboard.tsx) e, quando `tasks.view` está presente, [`TaskManager`](../../../src/components/task-manager.tsx). As chamadas e escritas desses componentes pertencem aos fluxos de [compras](purchasing-order-receipt.md), reposição, [contagem](stock-count.md) e [tarefas](tasks.md). O [índice estático](../flow-entrypoints.md) lista APIs e coleções candidatas; a mera importação desses componentes não prova que cada chamada ocorre em toda visita ao painel.

## Dados, acesso e limites

O próprio arquivo da página não grava dados. O controle `dashboard.view` é visual; cada aba e API precisa de autorização própria. O filtro em memória limita a **exibição** dos lotes por unidade, enquanto a leitura do provider depende das [regras Firestore](../../../firestore.rules). Para alterações em indicadores, conferir unidade restrita, vencimento, exclusão de uniformes e custo do listener; para ações nas abas, conferir autorização e contrato no fluxo proprietário. `npm run check` passou na verificação anterior do mapa (2026-09-25), sem teste ponta a ponta específico deste painel identificado por nome. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Contrato das abas rastreado

[`PurchaseAlertCard`](../../../src/components/purchase-alert-card.tsx) calcula cobertura e data de pedido para `matriz`, convertendo embalagens para unidade do insumo e usando consumo validado; encaminha a compras. [`RestockPanel`](../../../src/components/restock-panel.tsx) filtra quiosques por `canAccessUnit`, soma lotes positivos convertidos, compara mínimo e exibe necessidade. O botão `Repor` nesse componente não tem handler: não cria solicitação nem movimenta estoque. Isso corrige a interpretação de que toda aba representa uma escrita. As abas de auditoria e tarefas montam os componentes dos fluxos [contagem](stock-count.md) e [tarefas](tasks.md), que possuem rotas e autorização próprias. Nenhuma transação conjunta existe entre abas; falha de uma fonte não desfaz outra ação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
