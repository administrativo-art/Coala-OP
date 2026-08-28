# Fase A de alertas — configuração ativa

## Estado e decisões

Configuração criada e habilitada em 28/08/2026. A releitura pelas APIs oficiais confirmou exatamente um uptime check, duas métricas e oito policies. Não foram criados notification channels ou dashboards.

Decisões operacionais de 27/08/2026:

- cobertura provisória: `06:00–23:00 America/Fortaleza`, por 30 dias;
- notification channels: nenhum nesta fase;
- consulta operacional: Cloud Monitoring, páginas **Alerting** e **Incidents**;
- PagerDuty, Slack e Google Chat: fora da Fase A;
- Error Reporting API: permanece desabilitada;
- policies: criadas inicialmente com `enabled=false`, validadas e depois habilitadas uma a uma;
- paging `CRITICAL`: fora da Fase A;
- fingerprint: pesquisa e triagem apenas, nunca label de métrica.

**Alerta registrado não significa notificação enviada.** Sem notification channel não há entrega por e-mail ou paging, e nenhum SLA de resposta por canal está ativo.

## Inventário criado

| Tipo | ID ou display name | Estado atual |
|---|---|---:|---|
| uptime check | `coala-op-login-https-externo-kU33u5o5nd8` | ativo |
| log-based metric | `coala_system_error_high` | ativa |
| log-based metric | `coala_scheduler_attempt_errors` | ativa |
| alert policy `213598315803996706` | `Coala OP — 5xx — revisão atual` | habilitada |
| alert policy `213598315803998031` | `Coala OP — SystemErrorEvent HIGH recorrente` | habilitada |
| alert policy `4117311868365525201` | `Coala OP — startup/build/rollout terminal` | habilitada |
| alert policy `1486045578511851733` | `Coala OP — job — interStatementSync` | habilitada |
| alert policy `5688903355103410223` | `Coala OP — job — interCobrancaReconciliation` | habilitada |
| alert policy `3925283481025925748` | `Coala OP — job — cashDepositDailyReconciliation` | habilitada |
| alert policy `5688903355103409401` | `Coala OP — job — cashClosureDailySync` | habilitada |
| alert policy `15523120843942580646` | `Coala OP — job — interPaymentReconciliation` | habilitada |

Total criado: 11 recursos — 1 uptime check, 2 métricas e 8 policies. Todas as policies têm `notificationChannels=[]`.

Não criar nesta fase:

- policy para `SystemErrorEvent critical`;
- policy de indisponibilidade ligada ao uptime check;
- policy para `checklistDailyGenerate`, `expireQuotations` ou `checkFieldMapConsistency`;
- policy para `hourlyPdvSync` até existir sinal que prove execuções consecutivas malsucedidas;
- qualquer dashboard, sink, exclusão de logs, retenção, API, secret ou alteração de aplicação.

## Canais e cobertura

Não existe notification channel. A operação consulta diretamente os incidentes no Cloud Monitoring. A janela `06:00–23:00 BRT` continua como referência provisória de cobertura humana por 30 dias, mas não constitui SLA ativo nesta configuração.

Adicionar e-mail, paging ou escala 24x7 exige autorização separada. Nenhum dashboard customizado faz parte desta fase.

## Uptime check

Configuração ativa:

```json
{
  "displayName": "Coala OP /login — HTTPS externo",
  "monitoredResource": {
    "type": "uptime_url",
    "labels": {
      "host": "op.coalashakes.com",
      "project_id": "smart-converter-752gf"
    }
  },
  "httpCheck": {
    "requestMethod": "GET",
    "path": "/login",
    "port": 443,
    "useSsl": true,
    "validateSsl": true
  },
  "period": "300s",
  "timeout": "10s",
  "selectedRegions": ["SOUTH_AMERICA", "USA", "EUROPE"]
}
```

Preflight real: `GET https://op.coalashakes.com/login` respondeu `200`, sem redirecionamento e com `text/html`. Após a criação, o Monitoring retornou probes `passed=true` em São Paulo, Bélgica e três localidades dos EUA. O check não autentica, não envia body e não executa escrita. Nenhuma policy de uptime/paging foi criada.

## Métrica `coala_system_error_high`

Filtro final:

```text
resource.type="cloud_run_revision" AND
resource.labels.service_name="studio" AND
jsonPayload.schemaVersion=1 AND
jsonPayload.eventId:* AND
jsonPayload.environment="production" AND
jsonPayload.coalaSeverity="high" AND
NOT jsonPayload.errorName="SyntheticObservabilitySmoke" AND
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_" AND
NOT (
  jsonPayload.errorKind="EXPECTED_BUSINESS" OR
  jsonPayload.errorKind="AUTHENTICATION" OR
  jsonPayload.errorKind="AUTHORIZATION" OR
  jsonPayload.errorKind="VALIDATION" OR
  jsonPayload.errorKind="NOT_FOUND"
)
```

Labels permitidas:

```json
{
  "source": "EXTRACT(jsonPayload.source)",
  "error_code": "EXTRACT(jsonPayload.errorCode)"
}
```

Não extrair fingerprint, `eventId`, request/correlation ID, mensagem, stack, URL ou rota dinâmica. A policy soma o contador por `service + source + error_code` em 15 minutos e abre condição quando o valor for maior que `1`, isto é, duas ocorrências elegíveis. O threshold é provisório porque o baseline real elegível é zero.

Preview validado:

| Janela | HIGH bruto | Sintético | HIGH elegível |
|---|---:|---:|---:|
| 24 h | 1 | 1 | 0 |
| 7 dias | 1 | 1 | 0 |
| 30 dias | 1 | 1 | 0 |

## Policy nativa de `5xx`

Usar `run.googleapis.com/request_count`, sem métrica de logs. Filtro-base:

```text
metric.type="run.googleapis.com/request_count" AND
resource.type="cloud_run_revision" AND
resource.labels.service_name="studio" AND
resource.labels.revision_name="studio-build-2026-08-27-003"
```

A policy usa `AND_WITH_MATCHING_RESOURCE` entre três condições alinhadas por 600 segundos:

1. `response_code_class="5xx"`, soma `>= 3`;
2. razão `5xx / total >= 0,10`;
3. soma total `>= 10` requests.

Preview da revisão atual:

| Janela | Requests | 5xx | Taxa | Janelas que satisfazem as três condições |
|---|---:|---:|---:|---:|
| 24 h | 364 | 0 | 0% | 0 |
| 7 dias | 365 | 0 | 0% | 0 |
| 30 dias | 365 | 0 | 0% | 0 |

A métrica Firebase App Hosting `firebaseapphosting.googleapis.com/backend/request_count` existe, mas não possui label de revisão. A policy usa Cloud Run porque o contrato exige a revisão atual. Depois de cada rollout, o `revision_name` precisa ser atualizado somente após validar a revisão com 100% do tráfego.

## Policy de startup, build e rollout

Implementar como uma condição de log-match direta, sem métrica customizada:

```text
(
  resource.type="cloud_run_revision" AND
  resource.labels.service_name="studio" AND
  resource.labels.revision_name="studio-build-2026-08-27-003" AND
  log_id("run.googleapis.com/varlog/system") AND
  severity>=ERROR
)
OR
(
  resource.type="build" AND
  log_id("cloudaudit.googleapis.com/activity") AND
  protoPayload.serviceName="cloudbuild.googleapis.com" AND
  protoPayload.methodName="google.devtools.cloudbuild.v1.CloudBuild.CreateBuild" AND
  protoPayload.authenticationInfo.principalEmail="service-787876557774@gcp-sa-firebaseapphosting.iam.gserviceaccount.com" AND
  operation.last=true AND
  severity>=ERROR AND
  protoPayload.status.code>1
)
OR
(
  resource.type="audited_resource" AND
  protoPayload.serviceName="firebaseapphosting.googleapis.com" AND
  protoPayload.methodName="google.firebase.apphosting.v1beta.AppHosting.CreateRollout" AND
  protoPayload.resourceName:"/backends/studio/" AND
  operation.last=true AND
  severity>=ERROR
)
```

O código gRPC `1` (`CANCELLED`) é excluído do ramo de build: uma operação cancelada precisa de auditoria, mas não prova falha de build e apareceu triplicada no histórico. A condição dispara com um evento terminal elegível. Preview com a exclusão:

| Janela | Startup atual | Build falho | Rollout falho |
|---|---:|---:|---:|
| 24 h | 0 | 0 | 0 |
| 7 dias | 0 | 0 | 0 |
| 30 dias | 0 | 2 | 0 |

Os dois builds históricos foram anteriores à revisão atual e servem para provar o filtro; uma policy desabilitada não notifica retroativamente.

## Métrica `coala_scheduler_attempt_errors`

Filtro final:

```text
resource.type="cloud_scheduler_job" AND
log_id("cloudscheduler.googleapis.com/executions") AND
jsonPayload."@type"="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished" AND
severity>=ERROR AND
(
  resource.labels.job_id="firebase-schedule-interStatementSync-us-central1" OR
  resource.labels.job_id="firebase-schedule-interCobrancaReconciliation-us-central1" OR
  resource.labels.job_id="firebase-schedule-cashDepositDailyReconciliation-us-central1" OR
  resource.labels.job_id="firebase-schedule-cashClosureDailySync-us-central1" OR
  resource.labels.job_id="firebase-schedule-interPaymentReconciliation-us-central1"
)
```

Única label extraída:

```json
{
  "job_id": "EXTRACT(resource.labels.job_id)"
}
```

Cardinalidade máxima prevista na Fase A: cinco séries por projeto/localização antes das dimensões nativas. Não usar fingerprint.

Cada policy filtra um `job_id` exato:

| Job | Threshold preservado | Erros 24 h / 7 d / 30 d | Grupos que teriam atingido o threshold em 24 h / 7 d / 30 d |
|---|---|---:|---:|
| `interStatementSync` | 3 em 20 min | 100 / 1.045 / 1.048 | 2 / 6 / 7 |
| `interCobrancaReconciliation` | 3 em 15 min | 0 / 0 / 0 | 0 / 0 / 0 |
| `cashDepositDailyReconciliation` | 3 em 15 min | 0 / 0 / 24 | 0 / 0 / 8 |
| `cashClosureDailySync` | 3 em 15 min | 0 / 0 / 0 | 0 / 0 / 0 |
| `interPaymentReconciliation` | 4 em 15 min | 4 / 4 / 7 | 1 / 1 / 1 |

O preview agrupa sequências reais separadas por mais de uma janela. Ele é conservador para decidir prontidão e não substitui a avaliação do mecanismo de incidentes do Monitoring.

Não implementar nesta fase a condição provisória de ausência de `OK` do `interStatementSync`: ela exigiria calendário operacional e um sinal explícito de heartbeat para não criar falso positivo fora de `06:00–23:00 BRT`.

## Limite de `hourlyPdvSync`

O Scheduler não observa falha terminal confiável nesse job. O handler captura erros por quiosque e o erro geral, registra `console.error` e não relança a exceção. Assim, uma tentativa pode terminar `OK` mesmo sem sincronização completa.

Uma policy baseada em `AttemptFinished ERROR` daria falsa segurança. Contar linhas `Erro no quiosque` também não prova duas execuções consecutivas, pois uma execução pode emitir várias linhas. A policy fica bloqueada até uma mudança de aplicação, fora deste gate, emitir resultado terminal estruturado ou relançar a falha conforme contrato.

## Falhas obrigatoriamente triadas antes de paging

Não criar policy nem mute para:

- `checklistDailyGenerate`;
- `expireQuotations`;
- `checkFieldMapConsistency`.

Os logs e evidências permanecem intactos. Os acompanhamentos locais estão em `observability-triage-backlog.md`, com revisão até 03/09/2026. Após a triagem, cada caso recebe decisão separada: corrigir, alertar ou formalmente mutar com dono e expiração.

## Permissões

O principal autenticado passou no `testIamPermissions` oficial para:

- `monitoring.uptimeCheckConfigs.create/get/list`;
- `monitoring.alertPolicies.create/get/list/update`;
- `monitoring.timeSeries.list`;
- `logging.logMetrics.create/get/list`;
- `logging.notificationRules.create`, exigida pela policy de log-match.

`monitoring.notificationChannels.list` e `monitoring.dashboards.list` foram usados somente para confirmar quantidade zero. Nenhuma permissão de criação desses recursos foi exercida.

IAM não foi alterado. O hash sanitizado do policy document permaneceu idêntico antes e depois da ativação.

## Ativação executada e rollback

Execução realizada:

1. inventário revalidado com zero recursos da Fase A;
2. uptime check e métricas criados;
3. oito policies criadas com `enabled=false`;
4. os 11 recursos foram relidos e comparados campo a campo;
5. as policies foram habilitadas uma por vez na ordem autorizada;
6. cada habilitação foi relida e observada sem abertura imediata de incidente;
7. a auditoria final confirmou 11 recursos, 8 policies habilitadas, zero canais, zero dashboards e zero incidentes abertos no corte inicial.

Rollback de criação, se necessário:

1. desabilitar somente a policy ruidosa;
2. preservar filtros e evidências para diagnóstico;
3. interromper o uptime check somente com autorização explícita;
4. excluir recursos somente com autorização destrutiva separada;
5. confirmar que Logging, App Hosting, production, aplicação, IAM e secrets não mudaram.
