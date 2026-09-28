# Central de processos e projeção de desligamentos

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** leitura e projeção traçadas no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25. Outros módulos podem publicar na coleção de projeções; este guia trata da fonte de desligamento.

## Entrada e percurso

[`processes/page.tsx`](../../../src/app/dashboard/processes/page.tsx) monta [`ProcessCenterPage`](../../../src/features/hr/termination/process-center-page.tsx), que consulta [`GET /api/processes`](../../../src/app/api/processes/route.ts). A rota exige usuário autenticado. Quem tem perfil de administração ou permissão de DP ampla pode receber a lista geral; demais usuários recebem apenas projeções cujo `visibleToUserIds` inclui seu ID, filtradas após leitura da coleção. A resposta lê até 500 projeções ordenadas pela atividade.

Para usuários com visão ampla, o `GET` primeiro lê **toda** a coleção `terminationProcesses` no banco RH, recalcula cada processo e atualiza `processProjections` no banco principal se versão/saúde mudou. Em escritas normais, [`saveTermination`](../../../src/features/hr/termination/server.ts) já tenta publicar [`buildProcessProjection`](../../../src/features/hr/termination/core.ts); falha de publicação é registrada no processo RH. A [lista de desligamentos](../../../src/features/hr/termination/termination-list-page.tsx) consulta a [API própria](../../../src/app/api/hr/terminations/route.ts), e [`GET /api/hr/terminations/{id}`](../../../src/app/api/hr/terminations/%5Bid%5D/route.ts) pode reconciliar estado de assinatura com a Autentique antes da resposta.

## Dados, acesso e contratos

| Item | Operação | Controle observado |
| --- | --- | --- |
| `terminationProcesses` no banco RH | Leitura total para visão ampla; gravação nas ações de desligamento | Permissão de DP na rota de processos; gestão nas mutações. |
| `processProjections` no banco principal | Escrita de projeção; leitura limitada a 500 | `visibleToUserIds` filtra a resposta após a consulta. |
| Autentique | Consulta/reconciliação em leitura de desligamento | `reconcileTerminationProviderState` quando aplicável. |

**Ponto de atenção observado:** o `GET /api/processes` faz escritas e varredura sem limite em `terminationProcesses` para usuários com visão ampla. Isso contraria as orientações atuais de [`AGENTS.md`](../../../AGENTS.md) para GET sem efeitos e consultas limitadas; não é uma mudança proposta por este levantamento. Antes de refatorar, medir volume/custo, identificar publicadores de projeção e preservar visibilidade e atualização da saúde do processo. A filtragem de `visibleToUserIds` ocorre depois de ler até 500 projeções; considerar crescimento e autorização por consulta em uma melhoria futura.

## Verificação e limites

Conferir [núcleo de projeção](../../../tests/unit/hr-termination-core.test.ts), permissões da rota, atualização após cada transição e comportamento com mais de 500 projeções. Este guia não executou teste de carga nem quantificou leituras reais. O risco de custo é inferido da consulta sem limite e depende do tamanho/uso da coleção.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
