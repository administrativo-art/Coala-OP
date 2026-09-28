# Escala do colaborador: consulta própria e equipe

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** percurso de leitura traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25; revisão de privacidade/custo e testes de integração pendentes. A publicação da escala pertence ao fluxo DP.

## Entrada e percurso

A [página da escala](../../../src/app/dashboard/collaborator/schedule/page.tsx) monta [`CollaboratorSchedulePage`](../../../src/components/collaborator-schedule-page.tsx). A interface exige `dashboard.collaborator` ou `dashboard.view`, escolhe ano/mês e chama [`GET /api/collaborator/schedule`](../../../src/app/api/collaborator/schedule/route.ts) com token. A rota autentica por `requireUser`, repete a permissão em [`canAccessCollaboratorSchedule`](../../../src/features/collaborator-schedule/server.ts) e valida ano entre 2020 e dois anos adiante e mês entre 1 e 12. Só há GET; a página não grava escala.

[`buildCollaboratorSchedulePayload`](../../../src/features/collaborator-schedule/server.ts) consulta `dp_schedules` do mês, retém somente escalas `locked`, escolhe a mais recente por unidade e lê os turnos de cada escala escolhida. Identifica turnos próprios por IDs da conta, RH, Bizneo, PDV e acessos PDV; escolhe turnos da equipe pelas unidades vinculadas à pessoa ou a seus próprios turnos. Deduplica turnos, busca nomes de unidade/definição/pessoas por ID e devolve `shifts`, `teamUnits`, ano, mês e sinal de publicação. A tela apresenta os dados em modos diário/mensal e estado sem escala publicada.

## Dados, acesso e dependências

| Dado | Leitura e limite observado |
| --- | --- |
| `dp_schedules` e subcoleção `shifts` | Consulta do mês no servidor; subcoleção de cada escala publicada é lida inteira e filtrada por data em memória. |
| `dp_units`, `dp_shiftDefinitions`, `users` | Busca por IDs derivados dos turnos visíveis para enriquecer a resposta. |

O contrato de publicação é `locked === true` no [serviço](../../../src/features/collaborator-schedule/server.ts); mudar a confirmação no fluxo [escalas DP](../flow-coverage.md) altera visibilidade aqui. A resposta de equipe inclui nomes/cargos; conferir política aprovada de privacidade e unidade. A consulta lê turnos de todas as escalas publicadas do mês antes de filtrar pessoas/unidades em memória, então medir custo e exposição interna antes de refatorar.

## Verificação

`npm run check` passou para esta documentação. Não foi identificado teste de integração específico desta rota pelo nome. Antes de marcar `Verificado`, testar perfil sem permissão, IDs alternativos, múltiplas escalas na mesma unidade, mês sem publicação, equipe de unidade alheia, período inválido e volume de turnos. A sequência de interface → rota → serviço → leitura/retorno está descrita acima; por isso o estado do grupo é `Traçado`.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
