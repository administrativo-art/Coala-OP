# Plano — Revisão antecipada das batidas (saneamento do ponto antes do fechamento)

**Estado:** proposta de 25/11/2026, a validar com o programador. Nada implementado.
**Área:** Ponto e DP. Toda mudança nesta área passa por revisão de Doc Brown antes do commit (AGENTS.md, "Revisão obrigatória das normas de ponto eletrônico").

## 1. Problema

Em Registro de ponto (modo de conferência, `/dashboard/collaborator/time-recording`), o DP vê dias "a conferir" (ex.: 17 em novembro de uma pessoa), mas só descobre no fechamento. Tudo se acumula e a pessoa precisa lembrar de dias de semanas atrás. O DP não pode pedir à pessoa que revise um dia, e o sistema não a avisa.

## 2. Situação atual verificada

- As ocorrências já existem em `src/features/dp/rep-p/day-model.ts` (`DayIncident`): `missing`, `odd`, `missing_break`, `short_break` (gravidade *danger*) e `late_exit`, `long_break`, `other_unit` (*warn*). O mesmo cálculo alimenta a web e o Coala Go.
- O colaborador já corrige pelo próprio fluxo: **Pedir ajuste** (web e `TimeScreens.kt`), classificação de batidas e ausência. O DP só decide. Regra mantida: **o ponto é exclusivo do colaborador**; o DP pede que ele regularize e decide pedidos, nunca lança por ele.
- Infra de aviso pronta: `userNotifications` (sino da web, `src/features/notifications`), push FCM (`src/features/mobile/push/send.server.ts`, `CoalaMessagingService` no Android, que abre um `path` seguro) e funções agendadas em `functions/src`. A rotina de avisos do ponto usa `POST /api/jobs/...` com segredo + função agendada.
- O Coala Go **não** consome `userNotifications` hoje: só recebe o push (texto genérico "Você tem uma atualização no Coala") e abre o caminho no navegador. Não há lista de pendências do ponto dentro do app.
- Falta automática: já existe regra de 24 h sem batida/ausência/ajuste (`plano-falta-automatica.md`); a nova rotina precisa respeitá-la, não duplicá-la.

## 3. Proposta (três momentos + pedido manual)

Unidade: **pedido de revisão** por pessoa e dia, com ID determinístico (pessoa, data, tipo de gatilho), idempotente como `ensureTaskFromOrigin`.

1. **Dia seguinte (D+1).** Rotina diária cedo (após o fim possível de qualquer turno, inclusive noturno/virada do dia). Para cada dia fechado de ontem com ocorrência de gravidade *danger* (ímpar, sem batidas, sem intervalo classificado, intervalo curto), cria o pedido "Revise suas batidas de DD/MM" e avisa a pessoa. Ocorrências *warn* (saída após o previsto, intervalo longo, outra unidade) aparecem na lista, sem push, para não gerar ruído.
2. **Fim da semana corrente.** No sábado às 08:00, reúne os pedidos da semana ainda sem resposta num único lembrete: "Você tem N dias para revisar".
3. **Dia 1º.** Rotina de pré-fechamento: lista todos os dias do mês anterior ainda pendentes, por pessoa, e reabre o lembrete para a pessoa. O DP vê o painel consolidado antes de abrir o fechamento.
4. **Pedido manual do DP.** Botão "Pedir revisão" na linha do dia (modo de conferência), com observação opcional, que cria o mesmo pedido. Fica registrado quem pediu e quando.

**Resolução.** O pedido some sozinho quando o dia deixa de ter ocorrência *danger* ou quando existe ajuste/ausência em análise ou decidido para o dia; ou quando a própria pessoa marca "Revisei, está correto" (registra a confirmação, sem alterar batida). Não cria batida nem ajuste em nome da pessoa.

## 4. Como aparece no aplicativo (Coala Go)

- **Push**: texto genérico atual (privacidade) abrindo direto o ponto (`path` já validado por `safePushPath`).
- **Cartão no topo de Ponto e da Home:** "N dias para revisar" com contagem e o mais antigo.
- **Lista "Para revisar"** (nova aba/filtro em Registros, reaproveitando o filtro "a conferir" já existente): cada dia mostra o motivo em linguagem simples ("Você tem 3 batidas; falta uma saída"), com ações **Pedir ajuste**, **Justificar ausência** ou **Está correto**.
- **Selo** no sino/ícone de Ponto enquanto houver pendência.
- A web mostra o mesmo no sino (`userNotifications`) e no cartão de Registro de ponto do próprio colaborador.

## 5. Decisões a confirmar

**Decididas em 25/11/2026:**
- **Horários:** rotina D+1 às 08:00 (horário de São Luís), com um aviso por pessoa reunindo os dias. Lembrete semanal **no sábado às 08:00**, cobrindo de segunda a sexta, só para quem ainda tem pendência.
- **Dia 1º:** **apenas aviso**, sem prazo e sem bloqueio do fechamento. A colaboradora recebe a lista do mês anterior, e o painel Fechamento do ponto mostra "N dias pendentes de revisão" por pessoa, só para informar.
- **Pedido manual do DP:** motivo **opcional**; um pedido aberto por dia; não vale para mês fechado; usa a permissão de conferência existente (`dp.timeRecording.view`), dentro do escopo de unidades; fica registrado quem pediu e quando.
- **Dia sem batidas:** o aviso cita a falta automática já registrada após 24h e orienta a solicitar ausência ou ajuste.

**Ainda a confirmar:**
1. Quais ocorrências disparam aviso: proposta só as graves, com classificação dependente da Política de jornada de cobertura (ver [plano de turno de cobertura](plano-turno-de-cobertura.md)).
2. Criar "Saída antes do previsto" e "Entrada após o previsto" (leves; a saída antecipada é grave para quem está na política de cobertura).
3. Jurídico (Doc Brown): a revisão/confirmação "Está correto" tem efeito fiscal ou apenas organizacional? Proposta: apenas organizacional, sem tocar batida, NSR, AFD ou espelho.

**Pendência jurídica (Doc Brown, 25/11/2026):** aviso e push em dia de folga, férias ou afastamento podem ser lidos como tempo à disposição (art. 4º da CLT) ou sobreaviso (Súmula 428 do TST). Hoje os textos são informativos, sem imperativo nem prazo ("a revisão pode ser feita em horário de trabalho"), e o dia 1º não tem prazo nem bloqueio. Pergunta ao advogado: (a) manter como está, (b) só sino em dia sem turno, ou (c) enviar só no horário do turno. **Condição de rollout:** não ativar `timeReviewDailyJob` em produção antes da resposta. Recomendação do especialista: (b) ou (c).

## 6. Ordem de execução

**Dependência:** as rotinas D+1, semanal e do dia 1º precisam das ocorrências calculadas no servidor. Elas consomem o contrato central do dia da etapa 2 do [plano de turno de cobertura](plano-turno-de-cobertura.md), sem criar outro cálculo.

1. Revisão de Doc Brown da proposta (item 5) e decisões da seção 5.
2. Serviço + coleção de pedidos de revisão (registro de pessoa em `person-inventory.ts`, regras `firestore.rh.*`, ID imutável do titular), com testes de idempotência e resolução.
3. Rotinas: D+1, semanal, dia 1º (rota `jobs` com segredo + função agendada) emitindo `userNotifications` e push.
4. Web: cartão para o colaborador, botão "Pedir revisão" e coluna de pendentes no modo de conferência; painel pré-fechamento.
5. Coala Go: rota de leitura, cartão, lista "Para revisar", selo; atualizar `docs/design/app.md` e paridade (`coala-go-parity.md`).
6. Atualizar `docs/engineering/flows/dp-time-recording.md`, `system-notices.md`, regenerar inventários exigidos por AGENTS.md e executar os verificadores.

Antes de qualquer commit: registro do chamado em `.ai-work/development-technology/`, veredito de Doc Brown e autorização do programador para commit/deploy.
