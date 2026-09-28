# Estoque: lotes, baixa e transferência manual

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de validade](../../../src/app/dashboard/expiry/page.tsx), [controle](../../../src/app/dashboard/inventory-control/page.tsx) e [controle no menu de estoque](../../../src/app/dashboard/stock/inventory-control/page.tsx) montam [`ExpiryControl`](../../../src/components/expiry-control.tsx). Este lê lotes por [`useExpiryProducts`](../../../src/hooks/use-expiry-products.tsx), além de produtos, unidades, locais e atividades de reposição. O provedor de lotes abre `onSnapshot` da coleção `lots` sem filtro ou limite após autenticação; se o listener falha, tenta `fetchClientBootstrap` para `lots`. O modal [`AddEditLotModal`](../../../src/components/add-edit-lot-modal.tsx) chama `addLot` ou `updateLot`. `addLot` mescla quantidade no ID derivado de produto/unidade/número/validade e grava movimento de entrada na mesma transação; `updateLot` faz `setDoc(..., {merge:true})` sem movimento correspondente.

Na [baixa](../../../src/app/dashboard/stock/write-down/page.tsx), [`StockWriteDown`](../../../src/components/stock-write-down.tsx) valida no formulário quantidade positiva e tipo de motivo; motivo “Outros” exige observação. Para cada item chama `consumeFromLot` **sequencialmente**. A função lê lote e reserva, recusa quantidade maior que a disponível, e atualiza `lots` e `movementHistory` em uma transação **por item**. Se um item posterior falhar, os anteriores continuam gravados.

Na [transferência](../../../src/app/dashboard/stock/transfer/page.tsx), [`StockTransfer`](../../../src/components/stock-transfer.tsx) seleciona origem, destino e lotes. `handleConfirmTransfer` chama `createRepositionActivity` no [`RepositionProvider`](../../../src/components/reposition-provider.tsx), que usa o [cliente de reposição](../../../src/features/reposition/lib/client.ts) para `POST /api/stock/reposition-activities`. A [rota](../../../src/app/api/stock/reposition-activities/route.ts) valida autenticação, permissão de gerenciar reposição e escopo nas duas unidades; numa transação cria `repositionActivities` com estado `Aguardando despacho` e aumenta `reservedQuantity` dos lotes. Depois sincroniza a [tarefa de reposição](../../../src/features/reposition/lib/task-sync.ts). A ação nesta tela **reserva** o estoque; despacho/recebimento pertencem ao fluxo de reposição.

## Dados, acesso e dependências

| Dado | Operação e autorização observada |
| --- | --- |
| `lots` | Listener e escritas pelo SDK cliente em [`useExpiryProducts`](../../../src/hooks/use-expiry-products.tsx). As [regras Firestore](../../../firestore.rules) permitem leitura por permissões de inventário/contagem/compras; criação, edição e exclusão têm permissões diferentes. |
| `movementHistory` | Entrada, baixa e movimentações gravadas pelo hook; [regras Firestore](../../../firestore.rules) exigem `canRecordMovement()` e estrutura válida, e proíbem atualização. |
| `repositionActivities` | Criação e consulta apenas por API; [regras Firestore](../../../firestore.rules) negam acesso direto. A [rota POST](../../../src/app/api/stock/reposition-activities/route.ts) reserva lotes atomicamente, mas tarefa e vínculo com solicitação são posteriores. |

**Divergência observada:** [`StockTransfer`](../../../src/components/stock-transfer.tsx) mostra a ação com `stock.inventoryControl.transfer`, enquanto o POST exige `reposition.prepareDispatch` ou `stock.analysis.restock` (ou administrador). Um perfil com apenas a primeira permissão pode ver o formulário e receber 403; um perfil com permissão de reposição pode chamar a API sem ter a permissão de transferência da tela. Conferir regra desejada antes de alinhar.

**Dependências:** movimentos alimentam histórico e análises; lotes abastecem compras, contagem e reposição. A [rota de reposição](../../../src/app/api/stock/reposition-activities/route.ts) lê a coleção inteira em GET e filtra o escopo em memória, ponto de custo e visibilidade para revisão. A tela usa lotes de um listener sem filtro; medir volume antes de alterar consulta ou provider.

## Verificação e lacunas

`npm run check` passou na verificação anterior do mapa (2026-09-25), mas não testa esse percurso ponta a ponta. Para mudança funcional, conferir regras Firestore com `npm run check:rules`, permissões de cada operação, unidade restrita, concorrência de reserva, baixa de múltiplos itens e falha da sincronização de tarefa. Revisar também edição/exclusão de lote, histórico e despacho/recebimento antes de marcar o grupo `Verificado`.

## Edição, exclusão e histórico rastreados

No [hook de lotes](../../../src/hooks/use-expiry-products.tsx), `updateLot` faz merge sem movimento; `deleteLotsByIds` remove lotes em batch e `forceDeleteLotById` remove um documento, sem limpar ou compensar movimentos antigos. `revertMovement` executa uma transação no SDK cliente: lê lote/movimento, altera saldo, grava movimento inverso e tenta marcar o original. As regras negam atualização de `movementHistory`; há incompatibilidade a reproduzir/corrigir. O POST e o serviço de estorno do worktree anterior não existem na main desta entrega.

`moveMultipleLots` lê origem/destino, valida disponível ou reservado, agrega movimentação transacional e cria entrada/saída. O fluxo ativo de reposição no provider usa API `finalize`, não essa função cliente como prova de seu comportamento. Despacho, recebimento, finalização e estorno estão detalhados no [guia de reposição](stock-requests-reposition-returns.md). Assim, edição direta, baixa, transferência e efetivação possuem contratos diferentes; testes de regras e saldo permanecem pendentes.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) registra as referências disponíveis e o que ainda falta comprovar nesta base. Resultados de funções ou regras isoladas não certificam automaticamente este percurso completo.
