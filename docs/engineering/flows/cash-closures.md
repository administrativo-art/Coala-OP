# Fechamento de caixa: sincronização PDV e contagem

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

## Entrada e percurso

As [páginas de fechamento](../../../src/app/dashboard/financial/cash-closures/page.tsx) usam [`GET /api/financial/cash-closures`](../../../src/app/api/financial/cash-closures/route.ts), com filtros por unidade/período, sessão de contagem aberta e autorização `cashClosures.view`. A rota filtra novamente por unidade acessível antes de responder.

[`syncCashClosure`](../../../src/features/financial/cash-closures/service.server.ts) resolve a filial PDV Legal da unidade, busca cupons, operadores e fontes de movimentos de caixa, constrói o fechamento e o grava pelo [repositório](../../../src/features/financial/cash-closures/repository.server.ts). Falhas de sincronização são registradas. O [job diário](../../../src/app/api/jobs/cash-closures/daily-sync/route.ts), protegido por segredo, percorre unidades com filial PDV, sincroniza a data escolhida ou o dia anterior em Belém e registra execução por unidade em `cashClosureJobRuns`.

Na [rota de finalização](../../../src/app/api/financial/cash-closures/%5BclosureId%5D/finalize/route.ts), o operador selecionado só pode ser finalizado por pessoa com `cashClosures.approve` na unidade. Divergências podem exigir permissão sênior adicional; contagens incompletas e faltas sem justificativa são rejeitadas. A ação chama `finalizeCashClosureOperator` no [repositório](../../../src/features/financial/cash-closures/repository.server.ts) e considera a sessão de contagem ativa. Reabertura, ajuste esperado, divisão de depósito e auditoria possuem [rotas específicas](../../../src/app/api/financial/cash-closures) que precisam ser seguidas para mudanças nesses estados.

## Dados, dependências e impacto

| Local | Efeito observado |
| --- | --- |
| PDV Legal e cadastro de `kiosks`/`dp_units` | Origem de cupons, movimentos, usuários e vínculo com filial. [Serviço](../../../src/features/financial/cash-closures/service.server.ts). |
| Fechamentos e sessões de contagem no banco financeiro | Valores esperados, contados, divergências e etapa de operador. [Repositório](../../../src/features/financial/cash-closures/repository.server.ts). |
| `cashClosureJobRuns` | Resultado e falha parcial do job diário. [Job](../../../src/app/api/jobs/cash-closures/daily-sync/route.ts). |

**Inferência de impacto:** falha em uma unidade do job não impede as demais e o resultado `partial` depende da contagem de falhas. Alterar cálculo de cupons/movimentos afeta esperado, divergências e eventual depósito. Antes de mexer na finalização, conferir também o vínculo com sessão e a regra de aprovação sênior.

## Verificação e limites

Os [testes de estados](../../../tests/unit/cash-closure-state-machine.test.ts) e verificações do módulo são pontos de partida. Para mudanças, conferir unidade sem filial, dia/fuso, sincronização repetida, sessão de outra pessoa, contagem incompleta, falta justificada, permissão sênior e efeitos em depósito. Este guia não comprova resposta real do PDV Legal nem cobre reabertura/depósito por inteiro.

## Auditoria, esperado e reabertura rastreados

A [rota audit](../../../src/app/api/financial/cash-closures/[closureId]/audit/route.ts) exige visão na unidade e lista logs por workspace/fechamento. [`adjustCashClosureExpected`](../../../src/features/financial/cash-closures/repository.server.ts) usa transação, limites de linhas/operadores, estado editável, valor inteiro não negativo e justificativa mínima; recalcula linha/agregados e registra alteração. A restauração do esperado possui função própria no mesmo repositório. Resumos mensais são projeções posteriores e alimentam a DRE.

[Reabertura](../../../src/app/api/financial/cash-closures/[closureId]/reopen/route.ts) exige permissão específica e motivo; chama [`reopenCashClosureWithDepositHandling`](../../../src/features/financial/cash-deposits/repository.server.ts). Transação seleciona operadores aprovados, valida transição e desanexa sessão/locks com auditoria; operadores vinculados a sessões devem ser reabertos individualmente. Sem cobrança emitida/moeda preparada, retira itens dos lotes, ajusta totais e volta para não alocado. Com histórico de emissão/pagamento ou moedas, preserva lote e cria ajuste `pending_allocation`, marcando depósito `adjusted`. Atualiza fechamento/operadores e logs juntos; refresca resumo depois. Nova finalização calcula delta do ajuste para alocação futura, sem apagar história bancária.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
