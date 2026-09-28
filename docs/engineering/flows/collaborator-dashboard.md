# Painel do colaborador: escala, metas e próximas ações

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página `/dashboard/collaborator`](../../../src/app/dashboard/collaborator/page.tsx) exige `dashboard.collaborator` ou `dashboard.view` e monta [`CollaboratorDashboardPanel`](../../../src/components/collaborator-dashboard-panel.tsx). O painel chama [`GET /api/collaborator/dashboard`](../../../src/app/api/collaborator/dashboard/route.ts); a rota autentica com `requireUser`, repete a permissão e chama [`buildCollaboratorDashboardPayload`](../../../src/features/collaborator-dashboard/server.ts). O serviço reutiliza a [escala publicada do mês](collaborator-schedule.md), lê `goalPeriods` ativos e **todos** os `employeeGoals`, depois filtra metas próprias por IDs de usuário/RH/Bizneo/PDV. Se não há metas próprias, usa as metas de quiosques atribuídos. Calcula interseção entre turnos e período/meta e retorna um retrato de distribuição de datas e jornadas.

O painel também usa [`useAllTasks`](../../../src/hooks/use-all-tasks.tsx) para tarefas/notificações, acesso rápido a formulários e outros cartões; essas ações pertencem aos fluxos de [tarefas](tasks.md), [formulários](forms.md), [escalas](collaborator-schedule.md) e metas. O [índice de entradas](../flow-entrypoints.md) mostra vários endpoints de clientes importados, que devem ser tratados como candidatos e não como chamadas confirmadas do painel.

## Dados, acesso e riscos de impacto

O GET não grava dados. `goalPeriods` usa filtro `status=active`, mas `employeeGoals` é lida integralmente antes de filtrar no servidor. O serviço define `visibleTeamGoals` como todas as metas dos períodos das metas visíveis, sem filtro explícito de quiosque/pessoa nessa etapa; conferir a política de visibilidade de metas de equipe antes de alterar ou declarar seguro o retorno. A página não substitui autorização das rotas de tarefas, formulários ou metas.

`npm run check` passou na verificação anterior do mapa (2026-09-25). Para mudança funcional, testar perfil sem acesso, identificadores alternativos da pessoa, metas de unidade alheia, período sem escala publicada, projeção de metas de equipe e volume de leituras. O percurso está complementado neste guia; essas verificações permanecem pendentes para o estado `Verificado`.

## Cartões, formulários e recebimento rastreados

O [painel](../../../src/components/collaborator-dashboard-panel.tsx) chama `fetchMyFormExecutions`; seleciona execuções previstas/vencidas hoje e, sem elas, usa todas retornadas, excluindo canceladas. Abrir/preencher leva a `/dashboard/forms/{id}/view`. Contagens abertas são as sessões `pending_review` cujo `auditedBy.userId` é o UID autenticado. O progresso da rotina soma formulários, notificações de tarefa, recebimentos e contagens, mas só formulários concluídos entram no numerador. Esse indicador não representa conclusão global das tarefas.

`handleQuickConfirmReceipt` é uma escrita real: resolve a atividade, copia quantidades sugeridas para `receivedQuantity`, registra assinatura com nome/data e chama `updateRepositionActivity` com `Recebido sem divergência`. Divergências exigem tela própria. A autorização e o movimento final pertencem à [reposição](stock-requests-reposition-returns.md). Notificações de tarefa apenas encaminham ao link de origem; ficha própria exige `dp.collaborators.view`, catálogo usa `canViewTechnicalSheets`. Erros das consultas de dashboard/formulários têm estados separados; não há fallback que autorize dados de outra pessoa.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
