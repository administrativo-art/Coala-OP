# Sincronização manual PDV Legal para metas

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

A [página de sincronização](../../../src/app/dashboard/settings/pdv-sync/page.tsx) envolve [`PdvSyncManagement`](../../../src/components/pdv-sync-management.tsx) em `PermissionGuard` com `settings.view`. A tela escolhe quiosque(s) e intervalo, resolve `pdvFilialId`, monta dias e chama diretamente a Firebase Callable `syncGoalsForRange` em blocos de até sete dias por quiosque, de forma sequencial. Mostra status, receita e diagnósticos por dia; os logs ficam no estado da interface.

A [Cloud Function `syncGoalsForRange`](../../../functions/src/index.ts) exige autenticação e, para não administradores padrão, `settings.manageUsers` ou `goals.manage` no perfil. Ela valida presença de quiosque e datas, carrega quiosque e filial PDV, token e catálogo, e chama `syncDayAdmin` para cada dia, retornando receita/diagnóstico/erro. A função usa segredos PDV no ambiente de execução, conforme [contrato de segredos](../../../functions/src/pdv-secret-contract.ts). A sincronização pode atualizar metas e relatórios, mas o conjunto exato de escritas deve ser confirmado em `syncDayAdmin` antes de alteração funcional.

**Divergência observada:** a página aceita `settings.view`, mas a Callable exige `settings.manageUsers` ou `goals.manage`; um perfil que vê a tela pode receber negação ao executar. A UI divide intervalos em blocos de sete dias, porém a função não limita a duração do intervalo recebido diretamente; conferir custo, timeout e validação no servidor. A autorização da Callable também deve considerar escopo do quiosque, já que ela busca o ID informado sem checagem de unidade visível nesse trecho.

## Dependências e verificação

O fluxo depende de `kiosks.pdvFilialId`, catálogo PDV, credenciais em Secret Manager e da implementação `syncDayAdmin` no [módulo de Functions](../../../functions/src/index.ts). Consulte [metas](../flow-coverage.md) e [comparação PDV × Stone](stone-sales-review.md) antes de mudar interpretação de vendas. `npm run check` passou na verificação anterior do mapa (2026-09-25); [teste do contrato de segredos](../../../tests/unit/functions-pdv-secret-contract.test.ts) não cobre execução ponta a ponta. Testar permissão, unidade restrita, intervalo inválido/extenso, falha por dia, reprocessamento idempotente e dados persistidos antes de marcar `Verificado`.

## Persistência e consumidores rastreados

O serviço real está em [`functions/src/pdv-sync.ts`](../../../functions/src/pdv-sync.ts), importado pelo index. `syncDayAdmin` coleta e normaliza cupons, produz snapshot de vendas/consumo e usa reconciliação para decidir aplicar ou aguardar confirmação de redução. Relatórios têm IDs determinísticos por unidade/dia. A transação grava `salesReports`, `consumptionReports`, `pdvSyncReconciliationStates`, métricas/fingerprint e progresso das metas; preserva `createdAt` anterior. `goalPeriods.currentValue` é soma do mapa diário atualizado, evitando acumular a mesma importação repetida.

Metas individuais recebem receita por identificador de operador/empregado e turno trabalhado; com múltiplos turnos sem correspondência, distribui proporcionalmente ao alvo (ou igualmente se alvo total zero). Atualiza `employeeGoals` e usa escala/usuários para distribuição. Catálogo limitado de simulações/itens/insumos alimenta custo e consumo. Consumidores: [metas](goals.md), [DRE](dre.md), [análises](stock-analysis.md) e painel. Falha por dia é reportada; reprocessamento não é execução de pagamento nem confirmação de venda bancária. Os limites de período/escopo observados na callable continuam achados para verificação.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
