# Formulários: modelos, execução e tarefas geradas

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de formulários](../../../src/app/dashboard/forms/page.tsx) usam APIs em [`/api/forms`](../../../src/app/api/forms). [`GET /api/forms/models`](../../../src/app/api/forms/models/route.ts) lista modelos ativos por workspace para quem pode acessar o módulo; `POST` exige gestão global de modelos, valida [`formModelSchema`](../../../src/features/forms/lib/schemas.ts), grava `form_models` no banco de checklist e registra auditoria.

[`POST /api/forms/executions`](../../../src/app/api/forms/executions/route.ts) valida template, unidade e responsável, exige permissão de operação no projeto e unidade no escopo da pessoa. A rota congela o template, seções e itens (inclusive ramos condicionais até a profundidade suportada) em `form_executions`, estado `pending`, e registra auditoria. `GET` tem caminho de tarefas atribuídas à pessoa e caminho geral; ambos limitam a até 100 registros, mas o caminho geral ainda filtra visibilidade após a consulta por [`assertFormExecutionAccess`](../../../src/features/forms/lib/server-access.ts).

A [rota de execução individual](../../../src/app/api/forms/executions/%5BexecutionId%5D/route.ts) avalia condições de gatilhos de tarefa ao processar respostas. Quando aplicável, chama [`ensureTaskFromOrigin`](../../../src/features/tasks/lib/server.ts), vincula a tarefa à execução e registra evento. O [fluxo de tarefas](tasks.md) sincroniza o estado de ocorrências posteriormente. Agendador, eventos e análise possuem [rotas específicas](../../../src/app/api/forms) e são detalhados na seção de recorrência, análise e retenção abaixo.

## Dados, permissão e impacto

| Local | Efeito observado |
| --- | --- |
| `form_models`, `form_templates`, `form_executions` no banco de checklist | Modelo, template congelado e respostas/estado da execução. [Serviço](../../../src/features/forms/lib/server.ts), [rotas](../../../src/app/api/forms/executions/route.ts). |
| `tasks` no banco principal | Tarefas geradas por gatilho de formulário. [Rota individual](../../../src/app/api/forms/executions/%5BexecutionId%5D/route.ts). |
| Logs de auditoria e eventos da execução | Criação de modelo/execução e efeitos dos gatilhos. [Rotas](../../../src/app/api/forms/models/route.ts). |

**Inferência de impacto:** execução e tarefa vivem em bancos diferentes; uma falha entre gravação da resposta e criação/vínculo da tarefa pode deixar trabalho incompleto. Mudanças em template não reescrevem automaticamente o snapshot das execuções existentes. Ao alterar permissões de visão, verificar o filtro posterior ao limite para perfis restritos.

## Verificação e limites

Os [testes de integração com tarefas](../../../tests/unit/forms-analytics/task-integration.test.ts) são ponto de partida. Para mudanças, verificar projeto e unidade, snapshot do template, condição e idempotência do gatilho, tarefa vinculada e visibilidade de execução. Este guia não certifica relatórios analíticos, cron, privacidade/anonimização nem execução completa em navegador.

## Recorrência, análise e retenção rastreadas

O [scheduler](../../../src/app/api/forms/scheduler/route.ts) autentica segredo por comparação constante ou usuário com administração/gestão de templates/criação de projetos. Valida datas/dry-run e chama [`generateDueFormExecutions`](../../../src/features/forms/lib/generator.ts). O gerador lê atribuições/templates ativos do workspace, determina calendário, unidade e turno; usa ID derivado de workspace/atribuição/template/data/unidade/turno e `create` para não sobrescrever execução existente. Atualiza atrasadas fora de dry-run, congela template em cada execução e grava evento depois da criação. A [entrada por evento](../../../src/app/api/forms/events/trigger/route.ts) é outro gatilho de geração. Reprocessamento deve preservar os IDs e snapshots; alterações no template não migram respostas antigas.

[`generateOccurrencesForExecution`](../../../src/features/forms/analytics/generator.ts) adquire revisão de geração por transação, produz ocorrências com chave de deduplicação, grava em batches e finaliza geração. Reprocessamento substitui revisão anterior, com rotas de simulação/execução que exigem `reprocess_occurrences`; pode recomputar agregados em [`daily-aggregates`](../../../src/features/forms/analytics/daily-aggregates.ts). Sumário e exportação passam por contexto/permissões analíticas e escopo; dados pessoais têm controle distinto de resultado agregado. Resolução/validação/rejeição/cancelamento de ocorrência e tarefas vinculadas usam o contrato em [tarefas](tasks.md).

[`anonymizeDueOccurrences`](../../../src/features/forms/analytics/anonymization-service.ts) consulta workspace, presença de dados pessoais, não anonimizada e vencimento; padrão 200 + 1 para detectar mais resultados. Pode guardar textos originais em `restricted_occurrence_texts` antes de remover identificadores/textos da ocorrência. Cofre e patch são sequenciais; anonimização não equivale a apagar todo original. Os [jobs](../../../src/app/api/forms/analytics/jobs/anonymize-due/route.ts) exigem `assertCronSecret`, enquanto ações administrativas exigem contexto analítico. Retenção é resolvida pelo [serviço de políticas](../../../src/features/forms/analytics/retention-policy-service.ts). Falha por lote/revisão e privacidade permanecem casos de verificação, com os caminhos de processamento registrados.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
