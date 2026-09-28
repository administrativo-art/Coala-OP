# Férias: registro e decisão do agendamento

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** subfluxo traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Descreve comportamento implementado; políticas aprovadas são registradas em [regras de negócio](../business-rules.md).

## Entrada e percurso

A [tela de férias](../../../src/components/dp/dp-ferias-profile.tsx) carrega o histórico de uma colaboradora e oferece agendar, editar, aprovar, rejeitar e cancelar conforme o registro. As chamadas usam [`POST /api/dp/vacations`](../../../src/app/api/dp/vacations/route.ts), [`PATCH`/`DELETE /api/dp/vacations/{id}`](../../../src/app/api/dp/vacations/%5BvacationId%5D/route.ts). Os corpos são validados por [`createVacationSchema` e `updateVacationSchema`](../../../src/features/hr/vacations/schemas.ts), incluindo período, tipo `gozo`/`venda`, dias e justificativa de rejeição/cancelamento.

1. [`createVacation`](../../../src/features/hr/vacations/server.ts) exige `dp.vacation.request` ou administrador padrão; criar diretamente como `APPROVED` exige também `dp.vacation.approve`. Na transação, confere acesso à colaboradora por unidade, histórico, sobreposição e conformidade. Cria `dp_vacations/{id}` com análise, avisos e trilha inicial para `gozo`, além de evento `VACATION_CREATED` em `dp_vacationEvents`.
2. [`updateVacation`](../../../src/features/hr/vacations/server.ts) permite `update_record` apenas em `PLANNED`/`PENDING` e antes do início do aviso. Revalida histórico e conformidade, recria a trilha inicial e grava `VACATION_UPDATED` na mesma transação. Para `approve`, exige permissão de aprovação, recalcula conformidade, muda o registro para `APPROVED` e abre a etapa do aviso para `gozo`; registra `VACATION_APPROVED`.
3. `reject` exige estado `PLANNED`/`PENDING` e justificativa; marca `REJECTED`, cancela a trilha aplicável e cria evento. `cancel` exige férias `APPROVED` com trilha ativa e recusa quando há solicitação de pagamento ou pagamento em preparação/concluído, pois pede reversão financeira. Marca `REJECTED`, encerra a trilha, invalida o token do contador e registra a justificativa e evento. [Fonte](../../../src/features/hr/vacations/server.ts).
4. `DELETE` exige permissão de aprovação e acesso à colaboradora. Só exclui quando o aviso ainda está `not_generated` ou `failed`; exclui `dp_vacations/{id}` e conserva o evento `VACATION_DELETED` com snapshot do registro. A listagem exige permissão de visualização, aprovação ou solicitação, limita a consulta por colaboradora e usa cursor. [Serviço](../../../src/features/hr/vacations/server.ts), [rotas](../../../src/app/api/dp/vacations/route.ts).

## Dados, acesso e dependências

| Item | Operação | Controle observado |
| --- | --- | --- |
| `users/{id}` | Leitura da colaboradora e unidade | `assertTargetAccess` usa `canAccessUserByUnit`. |
| `dp_vacations` | Consulta histórica, criação, transições, exclusão | Permissões `dp.vacation.request`/`approve`/`viewAll` ou administrador; transações do servidor. |
| `dp_vacationEvents` | Escrita de eventos com cada transição | Mesma transação Firestore da mudança principal. |
| Análise legal e histórico | Valida período, saldo e conformidade | [`vacationComplianceAnalysis`, `validateAgainstHistory`](../../../src/features/hr/vacations/server.ts). |

A aprovação abre [geração e assinatura do aviso](vacation-notice.md); cancelamento após movimentação financeira exige tratar o [pagamento de férias](../flow-coverage.md) antes. **Inferência de impacto:** mudanças no cálculo de saldo, estado ou histórico podem alterar tanto a aprovação quanto o momento em que o aviso fica disponível; conferir criação e atualização juntas.

## Verificação e limites

O [teste de trilha](../../../tests/unit/dp-vacation-workflow.test.ts) cobre avanço após aprovação e cancelamento de etapas. O [E2E de férias](../../../tests/e2e/hr/vacations.spec.ts) deve ser conferido para cada mudança de ação; este levantamento não atribui a ele cobertura completa de permissões, reversão financeira ou concorrência. A política desejada para exceções legais e o procedimento de reversão financeira exigem confirmação fora deste guia.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
