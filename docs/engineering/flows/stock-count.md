# Estoque: sessões de contagem e ajustes de lote

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de contagem](../../../src/app/dashboard/stock/count/page.tsx) e [auditoria](../../../src/app/dashboard/audit/page.tsx) levam às sessões. [`GET /api/stock/count-sessions`](../../../src/app/api/stock/count-sessions/route.ts) exige `stock.stockCount.view` ou `stock.audit.view`, valida filtros, aplica unidade permitida e pagina por cursor. A [consulta](../../../src/features/stock-count/session-list.server.ts) limita os registros lidos.

O cliente salva e conclui a sessão pela [rota coringa de cadastro](../../../src/app/api/registry/%5B...path%5D/route.ts) em `PATCH stock-audit/{id}`. A rota exige permissão de atualização do recurso e que a pessoa seja a dona da sessão. Para `status=completed`, [`completeStockCountSession`](../../../src/features/stock-count/lib/finalize.ts) valida o mesmo conjunto de lotes, quantidades não negativas e justificativas compatíveis com a diferença física. Numa transação, confere que cada lote ainda existe e pertence à unidade, ajusta quantidade com `FieldValue.increment`, grava movimentos de entrada/saída e marca a sessão concluída. Repetir uma sessão já concluída devolve `alreadyCompleted`.

Após salvar ou concluir, [`syncStockCountTaskSafely`](../../../src/features/stock-count/lib/task-sync.ts) atualiza/cria tarefa associada à sessão. A [tarefa](tasks.md) de origem `stock_count_approval` não pode ser concluída manualmente na tela de tarefas; a contagem é a fonte do estado.

## Dados, permissão e impacto

| Local | Efeito observado |
| --- | --- |
| `stockAuditSessions` | Itens, responsável, unidade, status e ponteiro para tarefa. [Rota](../../../src/app/api/registry/%5B...path%5D/route.ts). |
| `lots`, `movementHistory` | Ajuste de saldo e movimentos na mesma transação de conclusão. [Finalização](../../../src/features/stock-count/lib/finalize.ts). |
| `tasks`, projeto/subprojeto de estoque | Tarefa sincronizada depois do estado da sessão. [Sincronização](../../../src/features/stock-count/lib/task-sync.ts). |

**Inferência de impacto:** a transação protege saldo, histórico e conclusão no banco principal, mas a sincronização da tarefa ocorre depois; falha nessa segunda etapa pode deixar a tarefa atrasada. Ajustar tipos de movimento ou validação de diferença exige conferir relatórios de estoque, reposição e auditoria que leem `movementHistory`.

## Verificação e limites

O [teste de fluxo de contagem](../../../tests/unit/stock-count-flow.test.ts) é referência inicial. Para mudanças, conferir dono da sessão, unidade restrita, lote movido, quantidade zero, divergências detalhadas, conclusão repetida e sincronização da tarefa. Este guia não valida criação nem cancelamento ponta a ponta.

## Criação e cancelamento rastreados

Na [API registry](../../../src/app/api/registry/[...path]/route.ts), POST `stock-audit` normaliza payload, exige unidade/nome/itens e `canAccessUnit`, persiste sessão e chama sincronização de tarefa. PATCH valida dono antes de salvar itens ou delegar conclusão à transação de finalização. DELETE também exige dono, remove documento da sessão e depois chama `cancelStockCountTaskSafely`. Cancelamento nesse handler não executa movimento inverso nos lotes: não deve ser interpretado como estorno de contagem já aplicada. Criação/cancelamento e espelho da tarefa são etapas separadas; testes devem cobrir estado concluído, proprietário, falha de tarefa e repetição. A semântica de estorno desejada não é estabelecida pela existência do DELETE.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
