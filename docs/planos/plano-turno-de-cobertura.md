# Plano — Turno de cobertura e cálculo único do dia de ponto

**Estado:** decisões do programador em 25/11/2026; nada implementado. Mudança de cálculo de ponto: exige revisão de Doc Brown antes do commit (AGENTS.md). Relacionado: [Revisão antecipada das batidas](plano-revisao-antecipada-ponto.md) e seção 3.10 do [plano de jornada e fechamento](plano-jornada-fechamento-rh.md).

## 1. Problema

A líder de quiosque tem contrato de 8h, mas é escalada num turno de 6h para mostrar qual cobertura faz em cada unidade. Ela pode ficar até completar 8h. Hoje, ao ficar, a tela do dia acusa "Saída após o previsto" e saldo positivo, e o dia entra em "a conferir" sem haver erro.

## 2. Situação atual verificada (25/11/2026)

**Leitura de produção, somente consulta:**
- Líder é **função** ("Líder de quiosque"); o cargo é "Atendente de quiosque". A aplicabilidade de jornadas já aceita `jobFunctionIds`.
- Jornada "40h | 8h diárias", empresa toda, desde 01/12/2026: tolerância de 5 min, intervalo esperado de 60 min, `useDefinedShiftWhenShorter: true`. A jornada "44h | 7h20" vale até 30/11.
- Política "CCT | 2026 - São Luís/MA": banco ligado, saldo negativo permitido, vencimento em 180 dias com destino "revisão", **sem ciclo mensal**.
- Há 13 definições de turno, com ~6h líquidas e 15 min de intervalo, exceto "CS | Turno - Líder" (09:00–18:00, intervalo flexível de 60 min).

**Código, três camadas independentes:**

| Camada | Fonte | Compara com |
| --- | --- | --- |
| Validação da escala | `journey-validation/core.ts` (`useDefinedShiftWhenShorter`) | autoriza turno menor que a jornada |
| Tela do dia: saldo prévio e ocorrências | `rep-p/day-model.ts` (navegador) e `domain/TimeRules.kt` (Coala Go) | **turno** |
| Banco de horas | `time-bank/core.ts` (`referenceMinutes`) | **jornada** |

Assim, 6h trabalhadas num turno de 6h aparecem como 0:00 na tela do dia e −2h no banco (decisão 3.10, de 17/10/2026). A captura de 25/11 confirma: dia 24/11 com saldo 0:00 e banco em −20:50.

**O resumo do dia é calculado em lugares diferentes:** no navegador (`day-model.ts`, via `buildMonthView` em `my-time-recording-page.tsx` e `use-today-journey.ts`), no app (`TimeRules.summarizeDay`), no servidor para a análise de ajuste (`time-adjustments/day-summary.ts`) e no banco (`time-bank/core.ts`). A rota do mês (`own-month.server.ts`) devolve dados brutos, e cada cliente calcula o próprio resumo.

**Dia manual já integrado à `main`:** `manualSegments`, `manualMode: fixed|flexible` e `manualWorkMinutes` em `day-model.ts`, `own-month.server.ts` e `TimeRules.kt`. Com segmentos manuais, a carga do dia vem deles e a checagem de saída após o previsto não roda. É o caminho para a exceção da atendente que cobre um turno maior. A mesma regra foi escrita duas vezes (TypeScript e Kotlin), o que reforça a decisão 7. **Precedência a definir:** com dia manual e cobertura no mesmo dia, o dia manual prevalece (proposta).

## 3. Decisões (25/11/2026)

1. **Jornada é a referência do banco para todos** (8h a partir de 01/12). Sem mudança no banco. Confirmado em 25/11/2026: todas as colaboradoras têm contrato de 8h, e o turno é que é menor (6h). O −2h por dia no banco é intencional, inclusive para as atendentes em dezembro (escala publicada: 168 dos 172 turnos têm ~6h líquidas).
2. **"Política de jornada de cobertura"** é uma seção própria no editor da jornada, com ícone de explicação (`InfoTooltip`). Nela se selecionam **funções e/ou cargos**; a pessoa entra na política se o cargo dela ou qualquer uma das funções estiver na lista. Não se cria uma jornada por função (decisões de 25/11/2026).
3. **Com cobertura ativa, a tela do dia:**
   - trabalhar 6h num turno de 6h dá 0:00, sem revisão (igual hoje);
   - ficar além do turno até o limite não gera "Saída após o previsto" nem saldo positivo no dia;
   - passar do limite é ocorrência e hora extra normais;
   - o banco continua comparando com a jornada: 6h dão −2h e 8h dão zero.
4. **O limite é exibido com 1h de intervalo:** "Turno 09:00–15:15 · pode estender até HH:MM". HH:MM é o início do turno + carga da jornada + 1h. A ocorrência de saída além do limite é calculada pelos **minutos trabalhados**, que não podem passar da carga da jornada + tolerância. O horário exibido serve de referência para a colaboradora.
5. **Intervalo pelo tempo trabalhado** (só com cobertura ativa; decisão de 25/11/2026):
   - até 6h trabalhadas, vale o intervalo do turno (15 min);
   - acima de 6h, o intervalo esperado é **fixo em 1h**, sem tolerância (a tolerância vale só no início e no fim da jornada).
   - Não há intervalo acima de 2h nem justificativa para ele (item removido).
   - Ocorrências: "passou de 6h com intervalo menor que 1h" (grave) e "intervalo maior que o previsto" (a existente, agora comparada com 1h).
6. **Entrada e saída mínima** continuam presas ao turno. Sair antes do fim do turno fica a conferir (proposta; confirmar).
6a. **Depois do Doc Brown (25/11/2026):**
   - **Tolerância só no início e no fim da jornada, nunca no intervalo** (decisão do programador em 25/11/2026, para todas as colaboradoras). Substitui o trecho da decisão de 20/10/2026 que estendia a tolerância aos avisos de intervalo. Mudar `short_break`/`long_break` em `day-model.ts` (linhas 199–200) e o aviso de intervalo em `TimeRules.kt` (linha 277) para comparar sem tolerância; subir `DAY_ALGORITHM_VERSION`. O banco já não aplica tolerância ao intervalo.
   - **Banco nos dias de cobertura:** a tolerância da saída compara com o limite de extensão (início + carga + 1h), não com o fim do turno. Ex.: turno 09:00–15:15, saída 18:03 = dentro da tolerância, sem extra; 18:06 = 6 min de extra.
   - **Fracionamento:** segue o cadastro do turno (`breakSplit`, `breakPauseCount`, `breakMinPauseMinutes`). Turno sem fracionamento exige o intervalo de 1h numa pausa só. O app orienta antes do intervalo: "Vai estender? Faça 1h agora."
   - **Intervalo suprimido (art. 71 §4º):** passou de 6h trabalhadas com intervalo menor que 1h gera evento de folha indenizatório (minutos suprimidos + 50%), visível ao DP.
   - **Pedido de revisão:** texto "Revisei este dia", desabilitado em dia ímpar ou sem batida, motivo do DP por lista (sem horário ou valor).
   - **Aviso de dia sem batidas:** cita o prazo da falta automática (`dueAt`), não uma falta já registrada.
7. **Fonte única de cálculo:** o servidor calcula o resumo de cada dia (ocorrências, saldo prévio, limite de extensão e faixa de intervalo) com um contrato central e o devolve pronto. Web e Coala Go só exibem. Isso vem antes da regra de cobertura, para que ela seja escrita uma vez só.

## 4. Pendências a confirmar

- **Doc Brown:**
  - art. 71 da CLT: 15 min até 6h; acima de 6h, intervalo fixo de 1h;
  - risco de passar de 6h com 15 min de intervalo.
- **Zeragem mensal do saldo negativo:** configurar o ciclo mensal e o destino do residual na política. Doc Brown registra se "zerar" significa a empresa absorver o débito (favorável ao empregado) ou desconto em folha, que tem outro caminho legal.
- **Saída antes do fim do turno:** ocorrência a conferir ou livre.
- **Offline no Coala Go:** dias fechados vêm do servidor. O estado "em curso" de hoje (horas até agora, em intervalo desde) continua local para funcionar sem rede e passa a seguir o mesmo contrato. Definir o que aparece sem rede para dias anteriores (último resultado guardado).

- **P1 — turnos já publicados (Doc Brown, 25/11/2026):** a decisão de cobertura é congelada na escrita do turno. Os 172 turnos de dezembro publicados antes da política não têm `coverage`. Ordem: (1) publicar a jornada com a política (nova versão, porque a atual está publicada); (2) regravar ou republicar os turnos de quem entra na política. O passo (2) é escrita em produção: script com ensaio e cópia de segurança, só com autorização do programador.

- **P2 — valor do intervalo suprimido (Doc Brown, etapa 4):** hoje o intervalo suprimido (>6h com <1h) vira `short_break`, entra nos alertas do fechamento e trava a folha da pessoa em "Confira o intervalo e seu efeito na folha" (`breakReviewDates`). Faltam: minutos suprimidos visíveis no alerta do fechamento, o caminho para liberar a folha depois de conferido (hoje o texto manda reabrir a competência) e a natureza/valor do pagamento (art. 71 §4º; pergunta ao advogado). O fechamento só aceita quatro naturezas de lançamento, então o evento indenizatório exige natureza nova no pipeline de folha.
- **Condição de P1:** não regravar os turnos de dezembro com a cobertura antes de o Coala Go usar o contrato central (etapa 6); até lá o app orienta o intervalo pela regra antiga.
- **Efeito imediato da regra v2:** sem tolerância no intervalo, competências abertas (novembro) podem ganhar alertas `short_break` novos no fechamento.

## 5. Ordem de execução

1. Revisão de Doc Brown das decisões 4–6 e da zeragem; registro no chamado em `.ai-work/development-technology/<id>/`.
2. **Contrato central do dia:**
   - mover o cálculo de `day-model.ts` para um serviço do servidor, mantendo o mesmo resultado (testes de caracterização antes);
   - a rota do mês devolve `days[]` calculados, com versão do algoritmo;
   - a web passa a usar o resultado;
   - o Coala Go troca `summarizeDay` pela leitura, com teste de contrato (`ApiContractTest`) e regra de paridade em `coala-go-parity.md`.
3. **Cadastro:**
   - campo `coveragePolicy: { jobRoleIds: string[]; jobFunctionIds: string[] }` na jornada (schema, `JOURNEY_FIELDS`, campos da Natasha, histórico por versão);
   - seção "Política de jornada de cobertura" em `dp-settings-journeys.tsx`, com `InfoTooltip`, seletores de cargos e de funções e linha "Cobertura: …" no resumo da jornada;
   - a seção só fica habilitada com "Usar o expediente definido no turno" ligado;
   - na publicação da escala, cada dia de quem se encaixa recebe `coverage: true`.
4. **Regra de cobertura no contrato central:** limite de extensão, faixa de intervalo, novas ocorrências e texto "pode estender até HH:MM". Testes com turno de 6h e 8h, e com intervalo de 15 min, de 1h e de 1h acima da tolerância.
5. **Falta automática sem desconto automático (decisão de 25/11/2026):** a falta continua registrada 24h depois do fim do turno, mas entra no banco e no fechamento como "a decidir pelo DP" (hoje vira `unexcused_absence` com desconto em `time-bank/service.server.ts` e `closure.server.ts`). O DP marca, por falta, se desconta ou não; até lá, o dia fica pendente no fechamento. Revisão de Doc Brown sobre o AEJ.
6. **Documentação:** `docs/engineering/flows/dp-time-recording.md`, `docs/design/app.md` e verificadores exigidos por AGENTS.md.

## 6. Estado da execução e como continuar (25/11/2026)

- **Implementado e enviado (PR #988, não mesclado):** etapas 2 a 6 deste plano e do [plano de revisão antecipada](plano-revisao-antecipada-ponto.md): contrato central do dia, Política de jornada de cobertura, regra do dia v2, revisão antecipada e Coala Go. Cada etapa passou por Doc Brown antes do commit.
- **Bloqueio:** o `quality` de todo PR falha em seis exceções de contrato vencidas em 24/11 (`hr/onboarding/public/[token]`, `client/bootstrap`, `financial/payment-requests`, `financial/payment-requests/[id]/submit`, `hr/roles`, `hr/roles/[roleId]`). A sétima (assinatura da admissão) foi migrada no PR #989. Decisão pendente: migrar ou prorrogar com prazo.
- **Ordem de publicação** (cada passo com autorização):
  1. #989 e depois #988 na `main`, e promoção para `production`;
  2. nova versão da jornada com a política marcando "Líder de quiosque";
  3. ciclo mensal `forfeit` na política (escrita em produção);
  4. APK do Coala Go;
  5. regravar os turnos de dezembro (escrita em produção, só depois do APK);
  6. `timeReviewDailyJob`, só depois do advogado.
- **Não implementado:**
  - falta automática sem desconto automático (seção 3, item 5 das decisões de 25/11);
  - minutos e evento de folha do intervalo suprimido (P2);
  - linha de absorção no extrato do `forfeit`;
  - chip por dia do app vindo do servidor;
  - push direto para o Ponto.
- Guia completo e registro do chamado ficam fora do repositório: `.ai-work-archive/development-technology/2026-11-25-ponto-cobertura-revisao/` (pasta-mãe dos worktrees).
