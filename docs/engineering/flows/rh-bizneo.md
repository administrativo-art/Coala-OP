# Perfil RH, campos e sincronização Bizneo

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

As páginas de [colaboradores](../../../src/app/dashboard/rh/employees/page.tsx), [perfil próprio](../../../src/app/dashboard/rh/me/page.tsx), [campos](../../../src/app/dashboard/rh/config/fields/page.tsx), [cargos](../../../src/app/dashboard/rh/config/roles/page.tsx) e [sincronização](../../../src/app/dashboard/rh/sync/page.tsx) montam componentes em [`features/rh`](../../../src/features/rh/components/EmployeeListPage.tsx). A [rota de mapeamento](../../../src/app/api/rh/field-map/route.ts) lê/grava `schema/field_map` no banco RH e exige administrador, `settings.manageUsers` ou `dp.collaborators.edit`. A [rota de perfil](../../../src/app/api/rh/employee-profile/[employeeId]/route.ts) restringe perfil próprio quando `ownProfileOnly` e filtra campos conforme matriz de acesso antes de ler `field_values`.

O [painel de sincronização](../../../src/features/rh/components/SyncPanel.tsx) deve ser consultado junto às rotas/serviços Bizneo antes de mudar o contrato externo. Configuração de cargo/função dialoga com [organograma](organization.md) e [acesso](people-access.md). Falta traçar importação, resolução de identidade, conflitos, campos sensíveis e efeitos de consentimento. `npm run check` passou, sem verificação integrada Bizneo registrada. Decisões aprovadas permanecem em [regras de negócio](../business-rules.md).

## Importação desativada e campos rastreados

O [painel de sync](../../../src/features/rh/components/SyncPanel.tsx) é somente histórico; [`useSyncLog`](../../../src/features/rh/hooks/useSyncLog.ts) lê os dez últimos `sync_log`. [`sync-users`](../../../src/app/api/integrations/bizneo/sync-users/route.ts) retorna 410. Tanto a agenda mensal em [`functions/src/index.ts`](../../../functions/src/index.ts) quanto sync diário/manual em [`functions/src/rh/sync.ts`](../../../functions/src/rh/sync.ts) têm guarda `BIZNEO_COLLABORATOR_IMPORT_ENABLED = false`. O código de importação legado não representa um fluxo ativo; reabilitá-lo exigiria nova revisão do merge e origem dos campos.

A [rota de perfil](../../../src/app/api/rh/employee-profile/[employeeId]/route.ts) resolve identidade, monta contexto de unidade/propriedade/papel, calcula chaves legíveis com `canViewField`, visibilidade, acesso e `access_matrix`; consulta `field_values` pertinentes. `canViewConfidential` depende de papel admin. O cache de acesso RH é sincronizado por `syncRhAccessCache` em [sync.ts](../../../functions/src/rh/sync.ts); alteração de perfil no banco principal pode ter propagação assíncrona. Consentimento tem [fluxo separado](consents.md), não deve ser inferido de um dado Bizneo. A conclusão aqui é sobre o percurso atual desativado/leitura e controle de campos; dados históricos e regras implantadas ainda precisam de verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
