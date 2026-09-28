# Escalas do DP

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de escala](../../../src/app/dashboard/dp/schedules/page.tsx) levam à [visão mensal](../../../src/app/dashboard/dp/schedules/month/[period]/page.tsx) e ao [editor](../../../src/app/dashboard/dp/schedules/[id]/page.tsx). [`DpSchedulesList`](../../../src/components/dp/dp-schedules-list.tsx) lê `dp_schedules` e subcoleção `shifts`; [`DpScheduleEditor`](../../../src/components/dp/dp-schedule-editor.tsx) monta turnos, cobertura, folgas, férias e conflitos. A interface consulta `dp.schedules.view/create/edit/delete/publishBizneo` conforme ação.

As mutações dos turnos passam pelas [rotas de escala](../../../src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts), incluindo [turno individual](../../../src/app/api/dp/schedules/[scheduleId]/shifts/[shiftId]/route.ts), [folgas](../../../src/app/api/dp/schedules/[scheduleId]/day-offs/route.ts) e [cobertura](../../../src/app/api/dp/schedules/[scheduleId]/coverage-demands/[date]/route.ts). Essas rotas chamam `requireUser`; as regras por ação e o escopo de unidade precisam ser comparados com o editor antes de mudar permissões. [`useDpShifts`](../../../src/hooks/use-dp-shifts.ts) também lê a subcoleção diretamente pelo SDK cliente.

## Dados, dependências e limites

`dp_schedules`, `shifts` e `dp_calendars` são fontes observadas. A [rota de férias da escala](../../../src/app/api/dp/schedules/[scheduleId]/vacations/route.ts) lê `dp_vacations` e `users` com `dp.schedules.view`; mudanças em calendário, ausência ou turno impactam [escala do colaborador](collaborator-schedule.md) e [metas](goals.md). Publicação, conflitos e exclusão estão detalhados abaixo; conferir os efeitos sobre acesso no [guia de pessoas](people-access.md). A checagem geral `npm run check` passou; faltam testes dirigidos de autorização, duas edições concorrentes, feriado, férias e publicação antes de marcar `Verificado`.

## Criação, conflito, publicação e exclusão rastreados

[`use-dp-store`](../../../src/store/use-dp-store.ts) cria a escala por ID determinístico ano/mês/unidade canônica, valida unidade ativa e duplicidade local, e usa transação para impedir documento existente. Atualização é SDK direto; unidades arquivadas ficam somente leitura na função. Exclusão lê turnos, remove-os e remove escala em um batch, sem chamada de desfazimento ao Bizneo. Portanto apagar escala local não prova remoção externa, nem remove automaticamente outras subcoleções. Regras de `dp_schedules` são a autoridade para essas operações diretas.

[`saveWorkShift`](../../../src/features/dp/shifts/service.server.ts) exige edição ou administrador, valida usuário ativo, unidade permitida, escala destrancada, competência, vínculo de unidade e modo criar/editar. Consulta ocupações por pessoa/data com limite 21; atingir limite bloqueia validação. Folga impede turno; conflito entre escalas é registrado como `hasConflict`, sem bloquear por si só. Turno, incremento do contador e `actionLogs` são transacionais. [`applyWorkShiftBulkChange`](../../../src/features/dp/shifts/bulk-service.server.ts) concentra substituição/remoção, valida ocupação e escreve turnos, contador e auditoria na transação. Folgas e demandas usam [serviços próprios](../../../src/features/dp/day-offs/service.server.ts), com estado de publicação externa separado.

[`push-schedule`](../../../src/app/api/integrations/bizneo/push-schedule/route.ts) exige acesso Bizneo de escalas e `dp.schedules.export` (ou administrador), valida schema, permite dry-run e chama `pushShiftToBizneo` por item. Retorna sucesso/erro por turno; falha de um não desfaz os já enviados. A [lista](../../../src/components/dp/dp-schedules-list.tsx) faz preflight e audita exportação; o [editor](../../../src/components/dp/dp-schedule-editor.tsx) também apresenta conflitos com férias, folgas e outras unidades. Guards visuais e a permissão `publishBizneo` não substituem a checagem efetiva de cada rota. Recuperação, exclusão remota e concorrência ficam para testes, com a separação entre escrita local e efeito externo explicitada.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
