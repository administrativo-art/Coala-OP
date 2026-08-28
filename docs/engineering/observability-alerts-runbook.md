# Runbook de alertas da Fase A

## Estado

Fase A ativa desde 28/08/2026: um uptime check, duas métricas de logs e oito policies habilitadas. Existem zero notification channels e zero dashboards customizados. A cobertura provisória é `06:00–23:00 BRT` por 30 dias, mas não constitui SLA ativo sem canal e responsáveis nomeados. Os thresholds marcados como provisórios devem ser reavaliados ao fim desse período.

**Alerta registrado não significa notificação enviada.** A operação inicial consulta Cloud Monitoring → Alerting/Incidents diretamente.

## Princípios

1. Alertar por impacto e terminalidade, não por todo `WARNING`, `401`, `403`, `404` ou exceção esperada.
2. Filtrar pela release/revisão atualmente servida para não paginar por histórico imutável.
3. Contar cada hop separadamente e nunca chamar o total bruto Scheduler + Function + App Hosting de incidentes únicos.
4. Usar dimensões de baixa cardinalidade. Fingerprint, `eventId`, IDs de request/correlação, URL crua, mensagem e stack ficam em logs/triagem, nunca como labels de métrica.
5. Um alerta é evidência para triagem. Não publica issue, não prova causa e não autoriza rollback.

## Matriz operacional

| Classe | Sinais | Ação |
|---|---|---|
| `CRITICAL` | `SystemErrorEvent critical`; segurança/integridade/financeiro; indisponibilidade comprovada | notificação imediata dentro da cobertura e contenção |
| `HIGH` | falha terminal importante; recorrência relevante; burst de `5xx`; falha de startup/rollout | notificar quando o threshold de impacto/recorrência for atingido; evento isolado geral vai primeiro para triagem |
| `MEDIUM` | falha transitória, dívida operacional conhecida, novo fingerprint sem impacto alto | fila de triagem sem paging |
| `LOW` | comportamento esperado, ruído conhecido, evento recuperável | revisão semanal/tendência |

## Exclusões obrigatórias

Aplicar antes de qualquer contagem ou notificação:

- `environment != production`;
- `SyntheticObservabilitySmoke`, `COALA_OBS_SYNTHETIC_*` e outros testes com marcador formal;
- `EXPECTED_BUSINESS`, `AUTHENTICATION`, `AUTHORIZATION`, `VALIDATION` e `NOT_FOUND`, exceto se uma regra separada detectar anomalia de volume;
- `401`/`403` esperados e requests deliberadamente negados;
- `404` de scanners/probes e assets de revisão antiga;
- `ERR_BLOCKED_BY_CLIENT`, extensões do navegador, `AbortError` e cancelamentos esperados;
- health/smoke conhecidos;
- tentativa intermediária de job quando ainda houver retry e nenhum critério terminal/recorrente tiver sido atingido.

Uma exclusão precisa ser estreita e auditável. Nunca excluir genericamente todos os `5xx`, `ERROR`, uma rota inteira ou um fingerprint real apenas porque ocorreu uma vez.

## Catálogo proposto

### OBS-ALERT-1 — `SystemErrorEvent critical`

| Item | Proposta |
|---|---|
| sinal | evento estruturado de produção com `coalaSeverity="critical"`, após exclusões |
| baseline | 0 eventos reais em 30 dias; um smoke sintético `high` |
| threshold | 1 evento elegível; sem agregação |
| janela | imediata, limitada pelo rate limit de notificação |
| motivo | a severidade contratual já representa segurança, integridade, financeiro ou impacto equivalente; o número 1 vem da semântica, não de estatística inventada |
| falso positivo | classificação incorreta como `critical` ou teste sem marcador |
| falso negativo | falha anterior à instrumentação, sink indisponível ou evento classificado abaixo do impacto |

Implementação futura preferida: log-match direto. Não requer log-based metric. A Fase A não inclui esta policy nem paging `CRITICAL`.

### OBS-ALERT-2 — `SystemErrorEvent high` recorrente

| Item | Proposta |
|---|---|
| sinal | `coalaSeverity="high"` agrupado por `source + errorCode` |
| baseline | 0 eventos reais em 30 dias; volume insuficiente para distribuição estatística |
| threshold | **provisório:** 2 ocorrências do mesmo grupo de baixa cardinalidade em 15 min; um evento isolado entra na fila, sem paging |
| janela | 15 min |
| motivo | preserva a exigência de recorrência para `HIGH` geral; 15 min coincide com a menor cadência financeira relevante, mas precisa de recalibração |
| falso positivo | retry duplicado em mais de um hop ou classificação excessiva |
| falso negativo | incidente grave de ocorrência única classificado apenas como `high`; a triagem isolada é a rede de segurança |

Implementação ativa pela métrica `coala_system_error_high`, com labels somente `source` e `error_code`. Fingerprint, rota/job dinâmica e identificadores permanecem em logs e na triagem.

### OBS-ALERT-3 — indisponibilidade pública

| Item | Proposta |
|---|---|
| sinal | uptime check HTTPS em `/login`, sem autenticação e sem efeito colateral |
| baseline | rota respondeu normalmente no smoke; nenhum uptime check histórico |
| threshold | **provisório:** falha em pelo menos 2 localidades por 2 ciclos consecutivos de 5 min |
| janela | 10 min |
| motivo | exige confirmação espacial e temporal antes de paging; `/login` é pública e segura |
| falso positivo | problema regional de rede/CDN ou mudança intencional da rota |
| falso negativo | falha parcial atrás de autenticação ou degradação menor que o timeout |

O check `Coala OP /login — HTTPS externo` está ativo em três regiões configuradas. O preflight confirmou `GET 200`, sem redirecionamento, body enviado ou autenticação; probes em América do Sul, Europa e EUA foram `passed=true`. Não existe policy de indisponibilidade/paging nesta fase.

### OBS-ALERT-4 — elevação de `5xx` da revisão atual

| Item | Proposta |
|---|---|
| sinal | `run.googleapis.com/request_count` do serviço `studio`, apenas revisão que recebe tráfego, código `5xx` |
| baseline | atual: 0/207; histórico App Hosting: 4,29% em 24 h, 4,92% em 7 d e 1,35% em 30 d, quase todo concentrado em revisões antigas |
| threshold | **provisório HIGH:** pelo menos 3 `5xx` em 10 min e taxa de `5xx` ≥ 10%, com ao menos 10 requests no período |
| janela | 10 min |
| motivo | no volume médio atual, 3 respostas já representam desvio material, mas o histórico limpo da revisão é curto |
| falso positivo | request malformado que chega a `500`, teste sem marcador ou um único fluxo duplicado |
| falso negativo | indisponibilidade com baixo tráfego; o uptime check cobre essa lacuna |

A policy está ativa usando a métrica nativa, sem log-based metric. Ela não combina serviço chamador e rota de destino. Reavaliar percentil/taxa após 30 dias e atualizar explicitamente `revision_name` a cada rollout validado.

### OBS-ALERT-5 — startup ou rollout

| Item | Proposta |
|---|---|
| sinal | erro de inicialização/container na revisão candidata ou build/rollout em estado terminal de falha |
| baseline | build e rollout atuais concluíram com sucesso; nenhum erro de startup na revisão atual |
| threshold | 1 falha terminal de build/rollout; para log de startup, 1 evento confirmado na revisão com tráfego |
| janela | imediata durante rollout e 15 min após tráfego |
| motivo | uma falha terminal impede a promoção; não é necessário esperar recorrência |
| falso positivo | mensagem de inicialização antiga ou revisão sem tráfego |
| falso negativo | degradação funcional com container saudável; coberta por smoke/5xx/uptime |

A policy está ativa com log-match direto para erro do sistema da revisão, término falho de build iniciado pelo service agent do App Hosting e término falho de rollout do backend `studio`. Não há polling nem métrica customizada para esse sinal.

### OBS-ALERT-6 — jobs/integrations

Usar `AttemptFinished`, nunca `AttemptStarted`. Os thresholds abaixo derivam da periodicidade e do retry configurados; onde o histórico não permite estimativa, estão marcados como provisórios.

| Job | Criticidade e sucesso esperado | Threshold proposto | Ação |
|---|---|---|---|
| `interStatementSync` | financeiro; `OK` a cada 15 min entre 06–23 BRT; rota idempotente; até 2 retries | 3 `AttemptFinished ERROR` em 20 min; **provisório CRITICAL** se nenhuma conclusão `OK` por 45 min dentro da janela | HIGH no ciclo terminal; escalar pela duração/impacto |
| `interCobrancaReconciliation` | financeiro; a cada 2 h, 08–18 BRT em dias úteis; 2 retries | 3 erros em 15 min para uma execução | HIGH |
| `cashDepositDailyReconciliation` | financeiro; 07:00 BRT; 2 retries | 3 erros em 15 min ou ausência de `OK` após a janela de retry | HIGH no mesmo dia |
| `cashClosureDailySync` | financeiro; 06:00 BRT; 2 retries | 3 erros em 15 min ou ausência de `OK` após a janela de retry | HIGH no mesmo dia |
| `interPaymentReconciliation` | fallback financeiro somente de consulta/conciliação; a cada 5 min; 1 retry | **provisório:** 4 erros em 15 min, equivalentes a dois ciclos esgotados; um ciclo isolado é MEDIUM | HIGH se dois ciclos consecutivos |
| `checklistDailyGenerate` | gera operação do dia às 00:05 BRT; 2 retries | triagem obrigatória antes de paging | sem policy/mute na Fase A |
| `expireQuotations` | expira estado de compras às 00:30 BRT; 2 retries | triagem obrigatória antes de paging | sem policy/mute na Fase A |
| `checkFieldMapConsistency` | compara semanalmente o mapa de campos com a API Bizneo | triagem obrigatória antes de paging | sem policy/mute na Fase A |
| `hourlyPdvSync` | sincroniza dados comerciais de hora em hora, 08–23 BRT | desejado: 2 execuções consecutivas com falha; sinal atual não prova isso | policy bloqueada até instrumentação terminal confiável |
| `syncFromBizneo` | rotina diária de RH atualmente desativada por política no código | sucesso esperado é no-op; alertar somente exceção inesperada | MEDIUM, sem ler dados de RH |
| retenção de documentos | rotina diária de conformidade | falha terminal de um ciclo | MEDIUM; elevar por prazo/impacto regulatório |

As policies dos cinco jobs financeiros com sinal confiável estão ativas pela métrica `coala_scheduler_attempt_errors`. Ausência de sucesso continua fora da Fase A: requer uma condição limitada à janela do cron e heartbeat explícito. Não implementar polling.

Falsos positivos esperados: tentativas intermediárias contadas como terminais, retries atravessando duas janelas e o mesmo erro duplicado no Function e na rota de destino. Falsos negativos: job que deixa de iniciar e portanto não emite `ERROR`, falha de negócio após resposta técnica `OK` ou janela de ausência mal alinhada ao cron. Por isso falha e ausência de sucesso são sinais diferentes.

### OBS-ALERT-7 — fingerprint novo após rollout

| Item | Proposta |
|---|---|
| sinal | diferença entre fingerprints sanitizados da release candidata e baseline anterior, usando exports limitados |
| baseline | 0 fingerprints reais do novo contrato em 30 dias; somente um sintético |
| threshold | novidade sozinha não pagina; `CRITICAL` segue OBS-ALERT-1, `HIGH` segue OBS-ALERT-2, demais entram na triagem |
| janela | consulta aos 60 min, 24 h e 7 dias após rollout; sem polling |
| motivo | fingerprint novo é sinal de investigação, não prova regressão ou impacto |
| falso positivo | baseline incompleto, mudança do algoritmo/sanitização ou ruído não excluído |
| falso negativo | colisão de fingerprint ou falha nova agrupada em identidade conhecida |

Implementar como consulta/export + `coala-error-triage`, não como métrica rotulada por fingerprint.

## Dívida conhecida fora do paging

`checklistDailyGenerate` e `expireQuotations` falharam terminalmente em todos os 30 dias consultados; `checkFieldMapConsistency` falhou nas quatro execuções semanais observadas. A decisão operacional é **TRIAGEM OBRIGATÓRIA ANTES DE PAGING**.

Para cada item, até 03/09/2026, escolher uma das opções após caracterizar causa/hipótese, impacto e responsável:

1. corrigir a falha e proteger com teste;
2. alertar com criticidade e threshold sustentados pela evidência; ou
3. criar mute temporário estrito, com dono, justificativa e expiração.

Na Fase A não criar policy, mute ou exclusão para esses jobs. Logs e evidências permanecem intactos. Os acompanhamentos estão em `observability-triage-backlog.md`.

## Fingerprint e cardinalidade

Fingerprint é usado para pesquisa, agrupamento pela skill, comparação entre releases e janela de recorrência. Não usar como label de metric descriptor: a documentação do Logging alerta que uma métrica pode ter aproximadamente 30 mil séries ativas, e valores únicos consomem esse limite rapidamente.

Labels permitidas somente por allowlist:

- `severity`: conjunto fechado;
- `source`: conjunto fechado do contrato;
- `errorCode`: código estável, nunca mensagem;
- `routeOrJob`: nome normalizado e allowlisted;
- `environment`: conjunto fechado.

Release/revisão deve preferencialmente ser filtro/resource label nativo. Não usar `eventId`, fingerprint, request/correlation ID, URL crua, stack, mensagem ou identidade de usuário como label.

## Notification channels e cobertura

Existem zero canais. Decisão vigente da Fase A:

- consulta primária: Cloud Monitoring → Alerting/Incidents;
- e-mail e fallback: não configurados;
- PagerDuty, Slack e Google Chat: não implantar;
- cobertura: `06:00–23:00 BRT`, por 30 dias.

Qualquer canal futuro precisa de dono, fallback e teste de entrega. Nenhum endereço deve ser inferido.

Sem canal, nenhum SLA de resposta por e-mail/paging está ativo. Não existe paging `CRITICAL` nem compromisso 24x7 na Fase A.

## Ativação executada

1. Inventário e permissões revalidados sem alteração de IAM.
2. Uptime check seguro e duas métricas de baixa cardinalidade criados.
3. Oito policies criadas desabilitadas e comparadas com esta especificação.
4. Policies habilitadas uma a uma na ordem autorizada.
5. Cada policy foi relida sem notification channel e sem incidente imediato.
6. As três falhas persistentes e `hourlyPdvSync` permaneceram fora das policies.

Observar 24 h, 7 dias e 30 dias; registrar falsos positivos/negativos, custo e cardinalidade. A eventual ativação de canal ou paging `CRITICAL` exige gate separado.

## Rollback da ativação

1. Desabilitar primeiro a policy ruidosa; não alterar aplicação, Logging ou App Hosting.
2. Preservar filtros, incidentes e evidência sanitizada para caracterização.
3. Remover o canal da policy se a falha for de entrega/roteamento; manter os outros sinais ativos.
4. Reverter threshold/filtro para a versão documentada anterior e validar por preview.
5. Somente com autorização destrutiva separada, excluir policies, uptime check, canais ou métricas criados exclusivamente pela ativação.
6. Confirmar que o rollback não tocou sinks, retenção, IAM além do principal temporário, production ou rollout.

Desligar uma notificação não apaga logs nem resolve a falha; sempre registrar motivo, dono e data da reativação.
