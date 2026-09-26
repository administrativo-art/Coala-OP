# Tarefas: criação, visão e mudança de estado

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de tarefas](../../../src/app/dashboard/tasks/page.tsx) monta o [gerenciador](../../../src/components/task-manager.tsx), que usa as [rotas de tarefas](../../../src/app/api/tasks/route.ts). `GET` exige módulo habilitado e permissão de visão, aplica política de escopo/limite e carrega projetos, subprojetos, estados e tarefas. [`listTasks`](../../../src/features/tasks/lib/server.ts) filtra por workspace/status, limita a até 500 documentos e depois aplica `canViewTask` por pessoa. Assim, o limite vale antes do filtro de visibilidade individual.

`POST /api/tasks` exige gestão, título e unidade dentro do escopo do usuário. [`createManualTask`](../../../src/features/tasks/lib/server.ts) garante projeto/subprojeto/estado padrão quando faltam, suporta chave de idempotência e grava tarefa com responsável, aprovação, prioridade, origem e histórico. A [rota de status](../../../src/app/api/tasks/%5BtaskId%5D/status/route.ts) exige que a pessoa possa atuar na tarefa/unidade. [`updateTaskStatus`](../../../src/features/tasks/lib/server.ts) rejeita mudança direta em tarefas originadas de contagem de estoque ou outras fontes automáticas; essas devem ser alteradas no fluxo de origem. Ao concluir, reabrir ou aprovar, atualiza histórico, estado e versão e sincroniza ocorrência de formulários, quando vinculada.

## Dados, permissão e impacto

| Local | Efeito observado |
| --- | --- |
| `tasks`, `task_projects`, `task_subprojects`, `task_statuses` no banco principal | Lista, criação, estados e configuração. [Serviço](../../../src/features/tasks/lib/server.ts), [rotas de projetos](../../../src/app/api/tasks/projects/route.ts). |
| Banco de formulários / ocorrências | Sincronização ao mudar o estado da tarefa. [Serviço](../../../src/features/tasks/lib/server.ts), [integração](../../../src/features/forms/analytics/task-integration.ts). |
| Compras e contagem | Podem criar/sincronizar tarefas; a [rota de sincronização de recebimento](../../../src/app/api/tasks/purchase-receipt-sync/route.ts) e a origem da contagem devem ser conferidas antes de editar manualmente. |

**Inferência de impacto:** a gravação da tarefa ocorre antes da sincronização com formulários; falha da segunda operação pode deixar estados diferentes. O filtro de visão após `limit` pode esconder tarefas válidas quando o conjunto cresce. Mudanças em consulta, permissão ou sincronização devem testar muitos registros e perfis restritos.

## Verificação e limites

Conferir [política de consulta](../../../src/features/tasks/lib/query-policy.ts), [acesso](../../../src/features/tasks/lib/server-access.ts) e testes de tarefas/formulários pertinentes. Para mudança de estado, verificar tarefa manual, tarefa automática, unidade restrita, aprovação, reabertura e ocorrência ligada. Este guia não valida ponta a ponta projetos, exclusão nem todas as origens automáticas.

## Projetos e origens rastreados

[Projetos](../../../src/app/api/tasks/projects/[projectId]/route.ts) e [subprojetos](../../../src/app/api/tasks/subprojects/[subprojectId]/route.ts) têm PATCH/DELETE autorizados pelo contexto de tarefas. Exclusão de projeto padrão é bloqueada; existência de tarefa impede remoção. Sem tarefas, batch remove projeto, subprojetos e estados; auditoria é posterior. Subprojeto aplica guarda equivalente e remove seus estados. Não há migração implícita de tarefas para outro projeto.

[`ensureTaskFromOrigin`](../../../src/features/tasks/lib/server.ts) cria ID determinístico com workspace, tipo de origem, execução/seção/item ou recebimento/pedido e gatilho. Garante subprojeto/estados, cria a tarefa em transação apenas se ausente, com unidade, responsáveis, observadores e link de origem. Contagem usa [task-sync](../../../src/features/stock-count/lib/task-sync.ts); reposição usa [task-sync próprio](../../../src/features/reposition/lib/task-sync.ts); compras têm [purchase-receipt-sync](../../../src/app/api/tasks/purchase-receipt-sync/route.ts). Essas origens controlam seus estados, e a tarefa espelha o processo. Erro de sincronização não desfaz saldo/recebimento/contagem já gravados. Testes de exclusão com tarefa concorrente e recuperação de sincronização continuam necessários.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
