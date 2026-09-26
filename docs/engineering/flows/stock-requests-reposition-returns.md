# Estoque: solicitação de item, reposição e devolução

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Solicitação de novo item (`stock-requests`)

A [página de solicitações](../../../src/app/dashboard/stock/item-requests/page.tsx) usa o [cliente de solicitações](../../../src/features/item-requests/lib/client.ts) para [`GET/POST /api/stock/item-requests`](../../../src/app/api/stock/item-requests/route.ts) e [`PATCH/DELETE` por ID](../../../src/app/api/stock/item-requests/%5BrequestId%5D/route.ts). GET exige `itemRequests.approve` ou `stock.stockCount.perform` (ou administrador), lê `itemAdditionRequests` inteira e ordena em memória. POST exige `itemRequests.add` ou `stock.stockCount.perform`, nome e quiosque existente; cria projeto/subprojeto e tarefa vinculada, depois grava solicitação. PATCH exige `itemRequests.approve`, muda estado para `completed`/`rejected` e atualiza tarefa depois; DELETE exige administrador e rejeita a tarefa após excluir solicitação. Essas etapas não são uma transação única. Conferir se o POST verifica escopo da unidade informada antes de ampliar acesso.

## Reposição (`stock-reposition`)

A [página de reposição](../../../src/app/dashboard/stock/reposition/page.tsx) monta [`RepositionManagement`](../../../src/components/reposition-management.tsx). A criação por [`POST /api/stock/reposition-activities`](../../../src/app/api/stock/reposition-activities/route.ts) exige permissão de gerenciar e acesso às unidades; reserva quantidades em `lots` e cria `repositionActivities` numa transação, depois sincroniza tarefa. [`PATCH` por ID](../../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts) permite gerenciamento ou atualização limitada de recebimento à pessoa com `reposition.receive` no destino; verifica unidades, mescla campos na atividade e sincroniza tarefa após mudança de status. [`DELETE` por ID](../../../src/app/api/stock/reposition-activities/%5BactivityId%5D/route.ts) exige cancelamento e contém transação para desfazer reserva. A [transferência manual](stock-control.md) entra aqui como atividade que começa em `Aguardando despacho`; não movimenta imediatamente o lote.

## Devolução e bonificação (`stock-returns`)

A [página de devoluções](../../../src/app/dashboard/stock/returns/page.tsx) usa o [cliente de devoluções](../../../src/features/return-requests/lib/client.ts) e [`GET/POST /api/stock/return-requests`](../../../src/app/api/stock/return-requests/route.ts). POST exige `stock.returns.add`, produto existente, tipo `devolucao`/`bonificacao`, lote, quantidade positiva e motivo com ao menos dez caracteres. Monta número diário com contador, cria tarefa e grava `returnRequests` e contador. [`PATCH/DELETE` por ID](../../../src/app/api/stock/return-requests/%5BrequestId%5D/route.ts) separam `stock.returns.updateStatus` e `stock.returns.delete`.

**Risco observado:** no POST, o contador é lido numa transação que não escreve, depois uma tarefa é criada, e só então outra transação grava o número calculado e o contador. Duas requisições concorrentes podem calcular o mesmo número; uma falha após criar a tarefa pode deixar tarefa órfã. Validar concorrência e recuperação antes de corrigir.

## Dados, acesso e verificação

`itemAdditionRequests`, `repositionActivities`, `returnRequests`, `lots`, `tasks` e `counters` no banco principal são os contratos cruzados. [Regras Firestore](../../../firestore.rules) negam acesso direto a `repositionActivities`; APIs autenticadas aplicam permissão e, em alguns ramos, unidade. `npm run check` passou na verificação anterior do mapa (2026-09-25). Para mudança funcional, revisar permissões diretas, escopo por quiosque, quantidades reservadas versus disponíveis, transições completas, tarefa órfã/atrasada, contador concorrente e consultas sem limite. Os três grupos estão traçados; despacho, recebimento e efeitos físicos estão detalhados abaixo, com testes integrados pendentes.

## Efeitos finais e recuperação rastreados

**Solicitação de item:** o [POST](../../../src/app/api/stock/item-requests/route.ts) valida existência do quiosque, mas a checagem de unidade também ocorre no `createManualTask` chamado com `unitId`; não basta inspecionar somente o handler. GET lê a coleção inteira sem filtro de unidade no handler. Solicitação e tarefa usam IDs vinculados, porém são gravações sequenciais: falha pode deixar tarefa órfã; não foi encontrado rollback nessa rota. Aprovar solicitação altera seu estado, não cria automaticamente produto/lote.

**Despacho e recebimento:** o [componente](../../../src/components/reposition-management.tsx) registra quantidades, assinatura/anexos de despacho e `Aguardando recebimento`; recebimento compara quantidades e grava `Recebido com/sem divergência`. O [PATCH](../../../src/app/api/stock/reposition-activities/[activityId]/route.ts) restringe receptor a status/itens/notas/assinatura, enquanto gestor pode alterar mais campos; verifica escopo e depois sincroniza tarefa. Esse PATCH não movimenta estoque nem impõe uma matriz completa de transições.

**Efetivação física:** o [POST finalize](../../../src/app/api/stock/reposition-activities/[activityId]/finalize/route.ts) exige `reposition.finalize` ou `stock.analysis.restock`/admin e acesso a alguma unidade da atividade. [`finalizeRepositionActivityServer`](../../../src/features/reposition/lib/server.ts) aceita somente estado recebido; `trust_receipt` usa quantidades recebidas quando há divergência, `trust_dispatch` usa enviadas. Em transação lê lotes e atividades, agrega débito por origem/crédito por destino, grava dois movimentos por transferência, recalcula reservas excluindo esta atividade e marca `Concluído`. Quantidades e reserva precisam de teste dirigido: não presumir que a transação sozinha impede saldo negativo. Depois a rota sincroniza tarefa e marca solicitação de reposição `Atendida`, fora dessa transação.

**Cancelamento/estorno:** DELETE da atividade rejeita concluída/cancelada e recalcula reservas em transação antes de marcar cancelada. O [serviço](../../../src/features/reposition/lib/server.ts) também contém reabertura de despacho/auditoria e `revertRepositionActivityServer`: para concluída, localiza movimentos vinculados, devolve saldo ao lote de origem, debita destino, grava movimentos inversos e marca originais revertidos. Essa inversão deve ser distinguida de mera reabertura de estado; exige conferir a rota/ação correspondente ao modificar recuperação.

**Devolução/bonificação:** [PATCH/DELETE](../../../src/app/api/stock/return-requests/[requestId]/route.ts) gravam estado/histórico/anexos e depois atualizam tarefa (`finalizado_sucesso` → completed; `finalizado_erro` → rejected). Esses handlers não escrevem lotes nem créditos financeiros: conclusão do chamado não comprova retorno físico nem reembolso. O risco do contador em duas transações continua como achado confirmado, não como ramo desconhecido. Verificação integrada deve incluir tarefa órfã, saldo concorrente, escopo e estorno.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
