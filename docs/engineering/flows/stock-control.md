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


## Saldo sem lote e sem validade — 27/11/2026

O controle agrupa código vazio, espaços e hífen isolado quando não há validade
(incluindo o legado de data vazia), por produto, unidade e local. O helper
[`stock-lot-identity.ts`](../../../src/lib/stock-lot-identity.ts) preserva códigos
reais, datas, workspaces explicitamente distintos e estados de uniforme. O
workspace ausente segue o padrão `WORKSPACE_ID` já usado pelas entradas manuais.
O rótulo é **Sem lote**. Os documentos físicos e `movementHistory` permanecem
intactos; nenhum saldo é migrado ou duplicado pelo agrupamento.

Quando um saldo reúne vários documentos, o painel oferece as entradas de origem
com suas quantidades e reservas. Histórico, edição, exclusão, baixa e transferência
usam exclusivamente o ID e o saldo da entrada escolhida. A reserva da linha é a
soma das reservas de todas as fontes. Links por `lotId` identificam também as
fontes secundárias. O agrupamento não é uma autorização para movimentar o total
por meio do ID de uma única fonte.

Novas entradas manuais, recebimentos de compras de estoque comum e destinos de
transferência/reposição compartilham o ID `prod_<produto>__kiosk_<unidade>__lot_-__exp_null`
somente para ausência de lote e de validade. IDs legados continuam válidos para
movimentação e estorno. Números reais, lotes com validade, compras locais `CL-*`
e a chave específica dos uniformes mantêm suas regras anteriores. O formulário
manual aceita código vazio; o hook grava hífen para o caso sem lote/validade.

Regressão dirigida: `tests/unit/stock-lot-identity.test.ts` cobre os saldos
2.434 e 3.595, data vazia/null, workspace legado, IDs físicos, reservas e separação
por produto, unidade, local, código, data e condição. A apresentação permanece
coberta por `tests/unit/lot-presentation.test.ts`. Esses testes não homologam
integração completa com Firestore. Não há alteração de listener, consulta ou
permissão; o custo recorrente existente não aumenta.

A edição de um documento pode mudar seu código ou validade sem trocar o ID.
Antes de somar a um destino reservado a estoque sem lote, as entradas conferem
produto, unidade, workspace, ausência de código/validade e estado de uniforme.
Cadastro manual, transferência e reposição fazem essa leitura dentro da mesma
transação que ajusta o saldo. Recebimento de compras protege o lote por
precondição da versão lida (ou criação exclusiva) no mesmo lote de gravações
do recebimento. Um conflito preserva a identificação, o saldo e os movimentos.
O cadastro exige número do lote quando a validade for preenchida.

O estorno de reposição pareia cada entrada com uma saída distinta e aplica a
soma dos ajustes uma vez por documento. A transação lê a atividade e seus
movimentos e verifica o saldo disponível após restaurar as reservas. A suíte
`tests/integration/stock-untracked-reposition.test.mjs` cobre quantidades iguais
e diferentes para várias origens com um destino comum, tentativa concorrente de
estorno e bloqueio de destino com identificação editada.

O teste da tela `tests/e2e/stock/untracked-lots.spec.ts` passou com o projeto
demo dos emuladores. Ele verifica agrupamento visual, seleção de origem,
recusa de destino com código e validade e movimentação apenas da origem
selecionada, com os IDs físicos no histórico.
