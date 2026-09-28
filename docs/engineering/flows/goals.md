# Cadastro, acompanhamento e análise de metas

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As páginas de [cadastro](../../../src/app/dashboard/goals/registration/page.tsx), [acompanhamento](../../../src/app/dashboard/goals/tracking/page.tsx), [análise](../../../src/app/dashboard/goals/analysis/page.tsx) e [histórico](../../../src/app/dashboard/goals/history/page.tsx) usam [`GoalsProvider`](../../../src/components/goals-provider.tsx). Ele mantém listeners diretos, sem filtro de período nas consultas observadas, para `goalTemplates`, `goalPeriods` e `employeeGoals`, e cria/atualiza/exclui documentos dessas coleções pelo SDK cliente. Assim, a autorização efetiva das escritas deve ser conferida em [`firestore.rules`](../../../firestore.rules), além da visibilidade de `goals.view/manage` na tela.

O [painel de acompanhamento](../../../src/components/goals-tracking-dashboard.tsx) cruza metas com usuários e dados de venda; a [rota de análise por IA](../../../src/app/api/ai/analyze-goals/route.ts) é entrada separada. A [sincronização manual PDV](pdv-sync.md) pode alimentar os relatórios usados aqui. Alterações em escala afetam a interpretação por colaborador; ver [escalas](dp-schedules.md). O cálculo de período, receita, redistribuição, IA e os consumidores de histórico precisam ser rastreados antes de mudar fórmulas. `npm run check` passou; faltam testes de regras Firestore, escopo de equipes, idempotência de importação e indicadores para marcar `Verificado`.

## Indicadores, distribuição e PDV rastreados

[`calcMonthlyStats`](../../../src/components/goals-tracking-dashboard.tsx) usa datas ativas da distribuição, mínimo de um dia, dias decorridos/restantes, ritmo `currentValue / elapsedDays`, projeção ritmo × dias ativos e necessário diário pelo saldo do alvo. UP usa valor guardado ou 120% do alvo; TOP só existe quando configurado acima do UP. A visão semanal usa o mesmo retrato de jornadas. `calculateTieredGoalBonus` em [`goal-methods`](../../../src/lib/goal-methods.ts) calcula faixas e distribuição por participantes, incluindo liderança/folguista; esse cálculo não cria pagamento.

[`rebalanceGoalsForSchedule`](../../../src/lib/goals-schedule-rebalance.ts) resolve unidade/quiosque, busca metas ativas de receita que sobrepõem competência e exclui `version=2` desse rebalanceamento. Carrega retrato de jornadas, calcula alvo/fração por empregado e grava batch por período. Alteração de escala pode afetar metas sem mexer na tela de metas. [PDV](pdv-sync.md) atualiza progresso por dia e soma acumulado, com regras de reconciliação e distribuição por operador/turno.

As regras de `goalTemplates`, `goalPeriods`, `employeeGoals` em [Firestore](../../../firestore.rules) permitem leitura a visão/gestão de metas ou gestão de usuários e escrita a gestão/admin; não aplicam filtro de unidade nesses blocos. Filtro visual por `canAccessUnit` não prova isolamento de coleção. `analyze-goals` é assistência separada, não fonte oficial de receita ou prêmio. Testes de períodos, versão, jornadas, acesso e replay continuam necessários.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
