# Cadastros e configurações do DP

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As [configurações de colaboradores](../../../src/app/dashboard/dp/settings/collaborators/page.tsx) usam o [cliente RH](../../../src/features/hr/lib/client.ts) para departamentos, cargos, funções e acesso. [`GET /api/hr/bootstrap`](../../../src/app/api/hr/bootstrap/route.ts) agrega `jobDepartments`, `jobRoles`, `jobFunctions` do banco RH com `dp_units` e `dp_shiftDefinitions` do banco principal. As rotas de [departamentos](../../../src/app/api/hr/departments/route.ts), [cargos](../../../src/app/api/hr/roles/route.ts) e [funções](../../../src/app/api/hr/functions/route.ts) leem/criam seus cadastros; os endpoints por ID fazem alteração. Um cargo pode referenciar `profiles`, portanto mudar seu perfil padrão afeta [acesso de pessoas](people-access.md).

O [calendário do DP](../../../src/app/dashboard/dp/settings/calendars/[id]/page.tsx) usa `dp_calendars` via [`useDpHolidays`](../../../src/hooks/use-dp-holidays.ts). A interface mostra `dp.settings.manageCalendars`; permissões de escrita dependem também das regras Firestore para os caminhos diretos. [`/api/hr/login-access`](../../../src/app/api/hr/login-access/route.ts) combina `users`, `jobRoles` e `dp_loginAccessJustifications` para concessões de login. A auditoria tem [rota própria](../../../src/app/api/hr/login-access/audit/route.ts).

Antes de alterar estes cadastros, conferir autorização em cada método, propagação de cargo/função para usuários, calendário em escala e escopo de unidade. `npm run check` passou, mas não substitui a verificação de acesso e sincronização entre bancos. Veja [regras de negócio](../business-rules.md) para decisões aprovadas.

## Calendário, perfil e login rastreados

[`use-dp-store`](../../../src/store/use-dp-store.ts) cria/edita calendário e definições de turno pelo SDK. Adição/remoção de feriado usa batch com incremento/decremento de `holidayCount`; exclusão de calendário apaga feriados e pai no mesmo batch, sem migrar referências das escalas/férias. A leitura de feriados ordena por data em [`useDPHolidays`](../../../src/hooks/use-dp-holidays.ts). A autorização dessas mutações depende de `dp_calendars`/`dp_shiftDefinitions` em [regras Firestore](../../../firestore.rules). Alterar calendário afeta cálculos que o consultam; não reescreve automaticamente registros históricos.

Cargo/função/perfil padrão e limites de propagação estão em [organograma](organization.md); edição de pessoa pode sincronizar perfil via `resolveCollaboratorCore`, conforme [acesso](people-access.md). Na [API de login](../../../src/app/api/hr/login-access/route.ts), o próprio usuário autenticado pode consultar/justificar seu acesso; operar sobre outro exige `assertHrAccess(..., "manage")`. POST valida schema, limitador ativo e motivo `after_shift_requires_justification` com turno de referência. Grava justificativa com sequência/prazo de extensão e depois dois eventos de auditoria; recalcula a avaliação. Leitura da sequência e gravação não compartilham transação, e falha de auditoria pode ocorrer após concessão. O tempo e o limite vêm das constantes/política importadas nessa rota. Conferir concorrência, fuso e perfil na etapa de verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
