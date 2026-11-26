# Plano — Fechamento do ponto por organização e política de hora extra completa

**Estado:** decisões do programador em 25/11/2026. Base do cálculo implementada em `feat/ponto-politica-tolerancias` (sobre o PR #988), sem commit: ver seção 7. Muda cálculo de ponto, banco e folha: exige parecer de Doc Brown antes do commit das partes de cálculo (AGENTS.md). Telas aprovadas no canvas [Fechamento do ponto — telas](https://claude.ai/artifact/Q1qqEAFRYToLMmwuBiKM32). Relacionados: [Turno de cobertura](plano-turno-de-cobertura.md), [Revisão antecipada das batidas](plano-revisao-antecipada-ponto.md), [Falta automática](plano-falta-automatica.md), [Jornada e fechamento](plano-jornada-fechamento-rh.md).

## 1. Problema

A tela atual de fechamento (`src/features/dp/time-adjustments/closure-section.tsx`) tem duas trilhas que não batem (competência com 4 etapas, pessoa com outras 4), três sentidos de "pendência" (pedido sem decisão trava e aparece; dia com problema não trava; alerta grave trava, mas só aparece depois do clique em fechar), escopo que muda de etapa para etapa (organização, todas, versão) e a sequência pós-fechamento escondida no card individual e na página de Prestadores. "Declarado" e "ok" significam só "sem pedido aberto"; em novembro, cada pessoa tem ~18 faltas automáticas e mesmo assim aparece em dia.

A política de hora extra cobre só faixas, limites e banco. Tolerâncias ficam na jornada (`toleranceMinutes`), aplicadas igualmente à entrada, à saída e ao intervalo. Intervalo suprimido, interjornada e hora noturna não são calculados.

## 2. Situação atual verificada (leitura de produção, 25/11/2026)

- **Política:** uma publicada, "CCT \| 2026 - São Luís/MA" v1 (CCT Comerciários 2026/2027), desde 13/10/2026, escopo organização Regional 1 \| São Luís (Quiosque João Paulo, Quiosque Shopping do Automóvel, Quiosque Tirirical, Centro de distribuição - Matriz). Faixas: `HE1 - 50%` (dia útil, folha, **pede aprovação**), `HE2.1 - 100%` (feriado, folha), `HE2.1.2 - 100%` (domingo, folha). Sem faixa de folga nem de fora da escala. Sem limite diário ou semanal. Banco ligado, negativo sem limite, crédito vence em 180 dias com destino revisão, sem ciclo. Cobertura externa: unidade de origem. O campo `startsAfterMinutes` gravado nas faixas é legado e é apagado na normalização (`time-config/schemas.ts:185`): não há escalonamento por horas.
- **Jornadas:** "44h \| 7h20" v2, 01/10 a 30/11/2026, Regional 1 (cargo e funções do quiosque), **sem `toleranceMinutes`** (0 min). "40h \| 8h", empresa toda, desde 01/12/2026, tolerância 5 min, intervalo 60 min. "44h" v1 arquivada.
- **Tolerância no código:** `day-model.ts` (desvio, `short_break`/`long_break` com a mesma tolerância, saldo), `day-summary.ts`, `own-month.server.ts`, `time-bank/core.ts` (limitada a 10), `lib/dp-shift-reference.ts`. Na branch `feat/ponto-cobertura-revisao` (sem commit), o intervalo não tem tolerância nenhuma — decisão a ser substituída por este plano (seção 4.3).
- **Fechamento:** por competência inteira (`closure.server.ts`): uma versão, manifesto, trava `repP_competenceFences` com a publicação de escala. A apuração roda em lote depois do fechamento e registra falha individual sem impedir o fechamento (`time-bank/service.server.ts`, `payroll-readiness.ts`).

## 3. Decisões

### 3.1 Fluxo do fechamento (7 etapas)

| # | Etapa | De quem | Avança com |
| --- | --- | --- | --- |
| 1 | Saneamento | pessoa | "Marcar mês conferido" (sem pedido em análise, alerta grave sem liberação nem falta a decidir) |
| 2 | Banco e extras (revisão) | pessoa | "Confirmar banco e extras" (registra a aprovação das extras em nome do operador, com a versão da política) |
| 3 | Fechar organização | grupo | "Fechar <mês> da <organização>"; congela a versão **e calcula a apuração oficial** |
| 4 | Contador | pessoa | "Liberar ao contador" (por pessoa ou lote) |
| 5 | Retorno do contador | pessoa | "Registrar conferência" (contracheque × eventos entregues) |
| 6 | Assinatura | pessoa | "Enviar para assinatura" (espelho + contracheque, Autentique, 24h) |
| 7 | Fechamento geral | grupo | "Concluir fechamento geral" (todos assinaram) |

- **Fechamento por organização:** cada organização tem saneamento, versão, reabertura e assinaturas próprios. Ao clicar no mês abre o modal de escolha: "Continuar" (em andamento), "Iniciar outro fechamento" e "Fechadas neste mês". "Sem unidade financeira" aparece com aviso de cadastro a corrigir.
- **Sem tela intermediária:** ao abrir a organização no mês, abre a primeira pessoa com algo a tratar.
- **Barra preta** é a única lista de pessoas, agrupada pela etapa em que cada uma está, com contadores P (pedidos), A (alertas), F (faltas); "conferido" só com tudo zerado. O nome da organização no topo da barra é o botão "Trocar". Faixa superior com as 7 etapas e a contagem de pessoas em cada uma.
- **Pessoa:** abre na própria etapa; anteriores em consulta; seguintes com cadeado e o motivo.
- **Gravidade fica como hoje:** grave trava e pode ser liberado com justificativa do RH; leve não trava.
- **Apuração dentro do fechamento (ex-etapa 4):** a prévia das etapas 1–2 e a apuração oficial usam o mesmo cálculo. Se a política mudar depois da conferência de alguém, o fechamento recusa e pede revisar a etapa 2 dessa pessoa. Se o cálculo falhar para alguém, a organização não fecha e o motivo aparece na conferência da etapa 3.

### 3.2 Etapa 1 — registro do mês e modal do dia

- Tela da pessoa: cabeçalho com anterior/próxima, 6 indicadores clicáveis (sem ocorrência, alertas graves, faltas automáticas, pedido em análise, aviso, ausência aprovada), cards recolhíveis "Mês em um olhar" e "Horas do mês (prévia)", tabela dos dias com ação do DP, rodapé "Pedir a X que regularize" e "Marcar mês conferido".
- **Modal do dia** (base: `closure-focus-mode.tsx`): evidências à esquerda (resumo, linha do dia, batidas, "para onde vai"), decisão à direita, fila dos dias no topo. Ações por tipo: falta automática (descontar, não descontar com motivo, pedir justificativa — **"não descontar" é decisão nova**), grave (pedir regularização; liberar com motivo e justificativa, recolhido), pedido de ajuste (aprovar/recusar), ausência (aprovar/pedir correção/recusar, regras do tipo), aviso (conferir com motivo).
- **A faixa da hora extra de cada dia é definida no modal** (bloco "Hora extra do dia": sugestão da política, faixa ou banco, horas, dividir em partes). Inclui o trabalho em folga sem faixa.
- **Card "Intervalo do dia"** quando houver: previsto, feito, falta na saída e na volta, tolerância, suprimido e "vai para a folha: HEI".
- O DP nunca grava batida nem pedido em nome do colaborador.

### 3.3 Etapa 2 — banco e extras (revisão)

- Política aplicada recolhível (nome, versão, "vale para", faixas, tolerâncias, limites, banco).
- Divisão das horas por faixa: apurado, pagar na folha, banco, sem destino. Linhas HE1, HE2.1, HE2.1.2, **HEI**, interjornada, noturno, sem faixa, débito, falta.
- Tabela única de lançamentos com "Definida em" (etapa 1 · quem · data / pela política / pela jornada / automático / ajustada aqui) e "Ajustar" (editor inline, total fixo, motivo obrigatório, "Voltar ao da etapa 1").
- As extras entram aprovadas; o confirmar da etapa registra a aprovação.

### 3.4 Etapa 3 — fechar a organização

Conferência antes do clique (mesmas checagens do servidor, mais a apuração): todas as pessoas com etapa 2 confirmada; nenhum pedido sem decisão; nenhum dia devolvido sem resposta; graves liberados; faltas automáticas reconciliadas com a escala; nenhuma publicação de escala em andamento; apuração calculada sem erro. Aviso não bloqueante: pessoas sem e-mail (travam a etapa 6). Tabela do que será congelado por pessoa e totais. Reabrir com motivo cria nova versão.

### 3.5 Política de hora extra completa

Toda política nova nasce de um **modelo padrão legal**; o operador ajusta conforme CCT ou acordo individual. Cada campo guarda a **origem** (`law`, `cct`, `individual_agreement`, `internal`) e a referência (cláusula). O sistema **não salva** valor pior que o mínimo legal sem justificativa jurídica registrada.

| Seção | Padrão legal |
| --- | --- |
| Faixas: dia útil | 50% (CF art. 7º XVI) |
| Faixas: domingo e folga sem compensação | 100% (Lei 605/49; Súmula 146 TST) |
| Faixas: feriado sem compensação | 100% |
| Faixas: fora da escala | revisão do DP |
| Limite de extra | 2h/dia (art. 59) |
| **Tolerância de entrada e saída** | 5 min por marcação, 10 min no dia (art. 58 §1º) |
| **Tolerância do intervalo** (total: saída + volta) | 15 min → 1; 30 min → 2; 60 min → 5 (60 min: TST Tema 14; 15 e 30: regra interna proporcional) |
| **Intervalo intrajornada suprimido** | código `HEI - 50%`, hora normal + 50%, indenizatória (art. 71 §4º), folha, nunca banco; acima da tolerância paga **todo** o tempo suprimido, automático |
| **Interjornada** | 11h entre jornadas (art. 66); horas faltantes pagas como extra 50% (OJ 355 SDI-1) |
| **Hora noturna** | 22h–5h, adicional 20%, hora reduzida de 52min30s (art. 73), cumulativo com a extra |
| Banco de horas | tipo de acordo: individual escrito (até 6 meses), CCT (até 1 ano), tácito (no mês) (art. 59 §§2º, 5º, 6º); validade, destino do vencido, ciclo, limites |
| Tratamento do intervalo | 1ª ocorrência no mês: orientação; a partir da 2ª: sugerir advertência; após advertência: sugerir avaliação de suspensão (só sugestão; decisão do DP) |

Sobreaviso e prontidão ficam fora até haver uso.

### 3.6 Tolerâncias saem da jornada

- A jornada fica com horários, carga e tamanho do intervalo. As tolerâncias passam a ser lidas **da política vigente no dia**.
- Dia sem política vigente: usa o `toleranceMinutes` da jornada (compatibilidade). Versões fechadas não são recalculadas.
- O editor da jornada deixa de exibir o campo; mostra "Tolerância: definida na política · <nome>". Publicar jornada com tolerância divergente da política da organização gera aviso.

## 4. Migração (decidida em 25/11/2026)

1. **Outubro e novembro:** nova versão da política, substituindo a v1 com a mesma data inicial (13/10/2026) e validade até 30/11/2026, com **somente** a tolerância de entrada e saída de **5 min por marcação**. Muda as prévias de out/nov (nenhum mês fechado). Dias 01–12/10 não têm política: seguem a jornada 44h (0 min) — confirmar com o programador se aceita.
2. **A partir de 01/12/2026:** nova versão com tudo da seção 3.5: limite de 10 min no dia, tolerância do intervalo, HEI, interjornada, noturno, tipo de acordo do banco, origens. Faixas atuais mantidas (HE1 com aprovação, HE2.1, HE2.1.2).
3. A jornada 40h (5 min) passa a ler da política sem mudança de entrada/saída; mudam o limite diário e o intervalo (15 min deixa de aceitar 5 min de tolerância: passa a 1).
4. Substitui, na branch `feat/ponto-cobertura-revisao`, a regra "sem tolerância no intervalo" (`day-model.ts`: `counted < expectedBreak`).

## 5. Implementação (ordem)

1. **Tipos e esquema da política** (`src/types/index.ts`, `time-config/schemas.ts`, `service.server.ts`, `OVERTIME_FIELDS`): seções novas, origem por campo, modelo padrão, travas do mínimo legal. Editor da política com as seções e o modelo.
2. **Resolução de tolerância** pela política vigente com fallback na jornada; remover do editor da jornada. Pontos: `day-model.ts`, `day-summary.ts`, `own-month.server.ts`, `time-bank/core.ts`, `dp-shift-reference.ts` e `TimeRules.kt` (Coala Go). Coordenar com o contrato central do dia (plano de cobertura, etapa 2a).
3. **Cálculo novo:** HEI (nova natureza/razão de linha, folha indenizatória), limite diário de 10 min, interjornada, noturno. Prévia e apuração usam o mesmo cálculo.
4. **Migração de dados** (seção 4) por script com ensaio e cópia de segurança, rodado pelo programador.
5. **Fechamento por organização no servidor:** registro por competência + organização, versão, manifesto, reabertura, trava com a publicação de escala por organização, AEJ só quando todas as organizações do estabelecimento fecharem, apuração dentro do fechamento.
6. **Decisões do DP persistidas:** conferência do mês por pessoa, faixa da extra por dia (partes, motivo, quem, quando), "não descontar" falta, aprovação das extras no confirmar da etapa 2.
7. **Telas:** modal de organização, etapa 1 (registro + modal), etapa 2, etapa 3, barra e faixa de etapas; etapas 4–7 reaproveitando `closing-package-card`, `payslip-reconciliation-panel` e Prestadores.
8. Testes de unidade do cálculo (tolerâncias, HEI, interjornada, noturno, migração) e E2E do fluxo.

## 6. Pendências

- **Parecer de Doc Brown:** modelo padrão legal; tolerância de 1 e 2 min nos intervalos de 15 e 30 min (o mais conservador é pagar qualquer minuto); Tema 14 ser anterior à Reforma; supressão por iniciativa do colaborador; escala disciplinar.
- Faixa de folga ausente na CCT atual (hoje cai em revisão).
- "Não descontar" falta automática: confirmar efeito na folha.
- Faixa livre ou restrita ao tipo do dia no editor da extra.
- Confirmação ao fechar (digitar nome?) e cancelamento na Autentique ao reabrir.
- Dias 01–12/10 sem política.

## 7. Execução (25/11/2026)

**Feito:** campos `tolerances` e `intrajornada` na política com origem, modelo padrão e tetos (`time-config/policy-rules.ts`, `schemas.ts`); tolerâncias lidas da política no banco e no Registro de ponto, com a jornada como reserva; linha `payroll_indemnity` da intrajornada; `time-bank-v4`; rótulos na web; editor preserva os campos. As regras só valem em política que tenha os campos.

**Falta antes de ativar uma política com os campos:** parecer de Doc Brown; entrega ao contador, AEJ e conferência do contracheque com a parcela indenizatória; rótulo no Coala Go; editor com os campos novos e o modelo padrão.

**Falta do plano:** limite diário de extra de 2h no modelo, interjornada, hora noturna, tipo de acordo do banco, origem nas demais seções, retirar a tolerância do editor da jornada (passos 1–3 parciais); migração (passo 4); passos 5 a 8.

**Bloqueio da migração (verificado no código):** a publicação exige que a nova versão comece **depois** da anterior (`time-config/service.server.ts`, `DP_TIME_SUCCESSOR_VALIDITY_INVALID`). Não há como publicar uma v2 a partir de 13/10, como previsto na seção 4.1. A decidir: nova versão a partir de outra data (em outubro os dias anteriores ficam na v1) ou correção autorizada da v1 publicada.

**Regra assumida, a confirmar:** intervalo previsto diferente de 15, 30 e 60 min usa a proporção do valor de 60 min, arredondada para baixo.

**Verificação (25/11):** typecheck ok; unidade 3709/3710 (a falha é a classe `border-ds-info-border` em dois arquivos do PR #988); integração 131/138 no primeiro lote, com as mesmas 7 falhas da base (o segundo lote não roda quando o primeiro falha, na base também); fechamento do ponto 4/4. `check:security-contracts` para numa exceção vencida em 24/11, em arquivo não alterado aqui. Produção (somente leitura): nenhuma coleção de fechamento ou de apuração do banco, então `time-bank-v4` não invalida nada.

**Pendências antes do commit:**
- Parecer de Doc Brown. Incluir: dia sem nenhuma pausa (supressão total) hoje não gera a parcela; AEJ ignora `payroll_indemnity` sem avisar (o portal do contador recusa).
- `check-person-source-registration` pede classificar `dp_unitGroups` e `dp_overtimePolicies` (a política pode citar colaboradores em `applicability.collaboratorIds`): decisão de classificação em aberto.
- Rebase sobre o PR #988, que ganhou o commit `5c16c563`; avaliar se o contrato central do dia (`DAY_ALGORITHM_VERSION`) precisa de nova versão.
- Versão de outubro e novembro, quando a data for resolvida: proposta de leitura da decisão: 5 min por marcação, **5 no dia**, intervalo 0/0/0 e sem intrajornada. Confirmar o limite do dia.

**Custo de leitura:** por mês lido e por pessoa, 1 consulta a `dp_overtimePolicies` (hoje 1 documento publicado; limite 500) e, só quando houver política com tolerâncias, até 3 documentos (usuário, unidade, grupo). Vale também para a checagem de alertas do fechamento, que lê o mês de cada pessoa.

**Abstração nova:** `policy-tolerance.server.ts` concentra o alvo de aplicabilidade antes escrito dentro do serviço do banco, que passou a usá-lo; não havia resolvedor reutilizável fora dele sem import circular.

### 26/11/2026

- Decisão do programador: os valores em aberto (outubro e novembro, limite do dia, intervalos) são configurados por ele no editor, que passou a editar tolerâncias, intrajornada e origem. Política nova nasce com o modelo legal.
- Modelo: trabalho em folga nasce em **revisão**. A lei garante 100% só no descanso semanal remunerado; a outra folga do 5x2 depende da CCT (corrige a tabela da seção 3.5, para conferência do Doc Brown).
- AEJ passa a recusar período com a parcela indenizatória.
- Limite conhecido: a menor data de uma nova versão continua sendo o dia seguinte ao início da anterior (hoje, 14/10/2026).

### Revisão de ponto (26/11/2026)

Substituto do Doc Brown (o perfil não estava disponível como agente): **não conforme, commit bloqueado**. Veredito completo no registro do chamado.
**Não conforme: commit bloqueado** por (1) recusa do AEJ: o registro 07 do leiaute 002 não tem tipo para a parcela e a supressão já aparece nas marcações; tirar o bloqueio, mantê-lo só na entrega ao contador; (2) editor ligar tolerâncias e intrajornada por padrão em política nova: nascer desligado ou o servidor recusar publicar com `intrajornada` até resolver a ativação.

**Bloqueia ativação:** prévia ≠ oficial (cobertura, turno noturno, dia manual provável, cobertura com referência ≤ turno, rótulos e Coala Go); linha de intrajornada em dia mandado para revisão; intervalo exigido não segue o art. 71 por horas trabalhadas (até 4h; acima de 6h em turno de 15 min); pausas fracionadas somadas; sem limite de habitualidade; tolerância abaixo de 5/10 aplicada ao desconto (art. 58 §1º); dia sem pausa; contador e contracheque sem a parcela.

**Retroativo out/nov:** tolerância só no débito, ou decisão jurídica (art. 468). A proposta de "5 no dia" mantém desconto indevido.

**Decisão jurídica necessária:** tolerância no intervalo (15/30/60), dia sem pausa, fracionamento, retroativo, folga no 6x1, texto da CCT. Substitui a pendência (b) de 20/10. Súmulas e a redação integral do Tema 14 não conferidas.

O coordenador ainda não conferiu os achados no código, e nenhuma correção foi aplicada.

### Correções aprovadas (26/11/2026)

O programador aprovou: tirar o bloqueio do AEJ; modelo nasce com tolerâncias e intrajornada **desligadas** (substitui "vem tudo preenchido e ativo"); prévia e apuração com as mesmas funções; intervalo exigido pela duração trabalhada; não pagar em dia em conferência; mínimo 5/10 sempre aplicado ao desconto quando a política define tolerâncias; dia sem pausa e pausas divididas vão ao DP e travam o fechamento. Escolhas conservadoras do implementador, também para o DP e a confirmar: turno de até 6h estendido, intervalo de 30–59 min, turno manual e noturno. Estas correções ainda não passaram por nova revisão.

**Reconferência (26/11/2026):** o substituto do Doc Brown retirou o bloqueio do commit (só leitura). **Antes de ativar uma política com os campos:** avaliar o intervalo em folga e fora da escala; criar a ação do DP para decidir o intervalo (hoje um dia a conferir trava a pessoa na apuração e na entrega ao contador); levar a parcela ao contador e à conferência do contracheque; Coala Go; parecer jurídico (Tema 14 após a Reforma e em 15/30 min, limite de 6h+10min, fracionamento, habitualidade, outubro e novembro, folga no 6x1). Menores: `BREAK_REVIEW` transitório no dia em curso e selo de tolerância na cobertura.
