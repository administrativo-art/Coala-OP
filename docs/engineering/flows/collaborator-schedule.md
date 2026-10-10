# Escala do colaborador: consulta própria e equipe

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** percurso de leitura traçado no checkout `3f64b3ccd77acf2ba304bf2d7c4fe427b36983fe` em 2026-09-25; revisão de privacidade/custo e testes de integração pendentes. A publicação da escala pertence ao fluxo DP.

## Entrada e percurso

A [página da escala](../../../src/app/dashboard/collaborator/schedule/page.tsx) monta [`CollaboratorSchedulePage`](../../../src/components/collaborator-schedule-page.tsx). A interface exige `dashboard.collaborator` ou `dashboard.view`, escolhe ano/mês e chama [`GET /api/collaborator/schedule`](../../../src/app/api/collaborator/schedule/route.ts) com token. A rota autentica por `requireUser`, repete a permissão em [`canAccessCollaboratorSchedule`](../../../src/features/collaborator-schedule/server.ts) e valida ano entre 2020 e dois anos adiante e mês entre 1 e 12. Só há GET; a página não grava escala.

[`buildCollaboratorSchedulePayload`](../../../src/features/collaborator-schedule/server.ts) consulta `dp_schedules` do mês, retém somente escalas `locked`, escolhe a mais recente por unidade e lê os turnos de cada escala escolhida. Identifica turnos próprios por IDs da conta, RH, Bizneo, PDV e acessos PDV; escolhe turnos da equipe pelas unidades vinculadas à pessoa ou a seus próprios turnos. Deduplica turnos, busca nomes de unidade/definição/pessoas por ID e devolve `shifts`, `teamUnits`, ano, mês e sinal de publicação. A tela apresenta os dados em modos diário/mensal e estado sem escala publicada.

## Escala no aplicativo (2026-10-09)

O módulo "Escala" de `apps/coala-notas` reutiliza `buildCollaboratorSchedulePayload` sem alterar a regra: só escalas `locked`, a mais recente por unidade, turnos próprios identificados pelos mesmos IDs e equipe das unidades vinculadas à pessoa ou aos seus turnos. Permissão própria da lista do aplicativo, `app.schedule.view`; `dashboard.collaborator` do sistema não a concede. `GET /api/dp/mobile-schedule?year=&month=` aplica os mesmos limites de período do web e devolve, por unidade, as pessoas (uma vez cada, com cargo e foto) e os turnos referenciados por posição; nenhum ID interno de usuário sai do servidor. O aplicativo abre em hoje, com a semana no topo, filtro "Só a minha" e, em tela larga, quadro semanal; cada mês é lido uma vez por visita, sem polling. O custo por leitura é o da função reutilizada (subcoleção `shifts` inteira de cada escala publicada do mês) mais um `getAll` dos usuários da equipe para a foto.

`GET /api/mobile/profile` devolve somente o cartão de quem está autenticado (nome, cargo e `avatarUrl`, este apenas se `https`) e quais módulos do aplicativo o perfil libera, para a tela inicial esconder o que a pessoa não pode usar; a autorização de cada módulo continua nas respectivas rotas. `POST /api/mobile/profile/photo` troca a foto da própria pessoa, como o perfil web já permite: grava em `avatars/{userId}` (o ID vem da sessão, nunca da requisição) e atualiza `users/{userId}.avatarUrl`, com o mesmo limite de 5 MB das regras de armazenamento; o tipo é verificado pelo conteúdo (JPG, PNG ou WEBP). A imagem não passa por moderação; como no web, fica visível para a equipe.

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
