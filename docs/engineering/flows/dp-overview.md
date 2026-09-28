# Painel do Departamento Pessoal

**Compatibilidade:** guia trazido do levantamento `3f64b3cc` e adaptado à main `70aaab65`. Resultados históricos citados não são homologação desta versão; ver [integração documental](../main-map-integration.md).

**Estado:** rastreamento estático concluído na base `3f64b3c`, atualizado em 2026-09-26. Entradas, sequência, dados, controles e efeitos estão descritos abaixo e nos subfluxos vinculados. Verificação integrada pendente; comportamento implementado não equivale a regra aprovada.

A [página DP](../../../src/app/dashboard/dp/page.tsx) usa `dp.view` e compõe dados de [`useDPBootstrap`](../../../src/hooks/use-dp-bootstrap.ts), [`useDPSchedulesShifts`](../../../src/hooks/use-dp-schedules-shifts.ts) e [cartão de desligamentos ativos](../../../src/features/hr/termination/active-terminations-card.tsx). Mostra próximas férias, férias ativas, turnos atuais/semana, aniversários e processos de desligamento; cálculos e filtros ficam na própria página. A leitura de turnos alcança `dp_schedules`; o cartão de desligamentos chama [`/api/hr/terminations`](../../../src/app/api/hr/terminations/route.ts).

Este painel não é a fonte canônica das ações. Para alterar os dados, consultar [escalas](dp-schedules.md), [férias](vacation-scheduling.md) e [central de desligamentos](termination-process-center.md). Conferir custo dos hooks, recorte por unidade e diferenças entre contadores da página e estados oficiais. `npm run check` passou, sem teste integrado específico do painel.

## Indicadores e acesso rastreados

A [página](../../../src/app/dashboard/dp/page.tsx) seleciona escalas do mês/ano atual antes de carregar turnos. Enriquece-os por usuário, unidade e definição; semana começa segunda-feira e hoje é agrupado por unidade/horário. Férias em curso exigem `recordType: gozo` e hoje dentro de início/fim; pagamentos próximos usam janela de 15 dias e retornos, 7 dias. Esses contadores não filtram por status de aprovação. Aniversários usam mês do nascimento, sem alteração no cadastro. Os hooks executam antes do retorno visual de `dp.view`; a autorização dos dados pertence às fontes DP/RH, e o seletor de unidade filtra em memória. O painel apresenta erros parciais se ainda houver dados e não grava escalas ou férias. A revisão de escopo/custo e consistência entre contador e lista é verificação pendente.

## Evidências da etapa 2

A [verificação por grupo](../flow-verification.md) aponta testes disponíveis e lacunas na main. Execuções do worktree de correções não certificam esta base; funções ou regras isoladas não certificam o percurso completo.
