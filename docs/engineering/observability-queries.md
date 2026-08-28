# Consultas reproduzíveis de observabilidade

## Regras de uso

Estas consultas são somente leitura. Substitua placeholders por valores verificados e mantenha exports exclusivamente em `.ai-work/error-triage/`. Nunca use `--format=json` sem projeção de campos em produção: isso pode materializar payloads desnecessários.

Não exportar `httpRequest.requestUrl`, bodies, headers, `textPayload`, mensagem bruta, cookies, tokens, documentos, dados bancários ou dados de RH. `messageSanitized`, `stackSanitized` e `metadataSanitized` só podem ser usados porque pertencem ao contrato sanitizado; ainda assim, revisar a saída antes de compartilhá-la.

## Filtro-base de eventos reais

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.eventId:*
jsonPayload.environment="production"
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

O filtro remove o smoke conhecido. Não adicionar exclusão genérica por fingerprint, `ERROR`, rota ou ocorrência única.

## Eventos de uma release

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.environment="production"
jsonPayload.release="studio-build-AAAA-MM-DD-NNN"
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

`jsonPayload.release` contém a revisão observável. A associação dessa revisão ao SHA fonte deve ser confirmada separadamente no build/rollout oficial do App Hosting.

## Evento por `eventId`

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.eventId="EVENT_ID_OPACO"
```

Não aplicar a exclusão sintética nesta consulta: um `eventId` autorizado pode pertencer justamente a um smoke controlado.

## Eventos por fingerprint

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.environment="production"
jsonPayload.fingerprint="err-v1-FINGERPRINT"
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

Sempre registrar a janela consultada. Encontrar o mesmo fingerprint em outra release não prova regressão.

## `HIGH`/`CRITICAL`

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.environment="production"
(jsonPayload.coalaSeverity="high" OR jsonPayload.coalaSeverity="critical")
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

## Erros de rota/job instrumentado

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.environment="production"
jsonPayload.routeOrJob="/api/jobs/inter/cobrancas/reconcile"
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

Trocar somente o valor por outra rota/job normalizada conhecida. Não pesquisar body ou URL com query string.

## Falhas do Scheduler por job

Exemplo do extrato Inter:

```text
resource.type="cloud_scheduler_job"
resource.labels.job_id="firebase-schedule-interStatementSync-us-central1"
log_id("cloudscheduler.googleapis.com/executions")
jsonPayload."@type"="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished"
severity>=ERROR
```

Conclusões `OK` do mesmo job:

```text
resource.type="cloud_scheduler_job"
resource.labels.job_id="firebase-schedule-interStatementSync-us-central1"
log_id("cloudscheduler.googleapis.com/executions")
jsonPayload."@type"="type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished"
severity=INFO
```

IDs allowlisted:

- `firebase-schedule-interStatementSync-us-central1`;
- `firebase-schedule-interCobrancaReconciliation-us-central1`;
- `firebase-schedule-interPaymentReconciliation-us-central1`;
- `firebase-schedule-cashDepositDailyReconciliation-us-central1`;
- `firebase-schedule-cashClosureDailySync-us-central1`;
- `firebase-schedule-checklistDailyGenerate-us-central1`;
- `firebase-schedule-expireQuotations-us-central1`;
- `firebase-schedule-hourlyPdvSync-us-central1`.

Confirmar o ID novamente antes de automatizar: nomes de função e Scheduler podem divergir.

## `5xx` da revisão atualmente servida

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
resource.labels.revision_name="studio-build-AAAA-MM-DD-NNN"
httpRequest.status>=500
httpRequest.status<600
```

Para alertas, preferir a métrica nativa `run.googleapis.com/request_count`, filtrada pelo serviço/revisão, em vez de criar métrica baseada em logs. Não somar as respostas do Function chamador ao App Hosting de destino.

## Erros de inicialização

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
resource.labels.revision_name="studio-build-AAAA-MM-DD-NNN"
log_id("run.googleapis.com/varlog/system")
severity>=ERROR
```

Revisar manualmente o tipo da mensagem sem exportar payload bruto; nem todo log `ERROR` do sistema equivale a indisponibilidade.

## Novos erros desde rollout

```text
resource.type="cloud_run_revision"
resource.labels.service_name="studio"
jsonPayload.schemaVersion=1
jsonPayload.environment="production"
timestamp>="AAAA-MM-DDTHH:MM:SSZ"
NOT jsonPayload.errorName="SyntheticObservabilitySmoke"
NOT jsonPayload.messageSanitized:"COALA_OBS_SYNTHETIC_"
```

Filtrar também pela `release` candidata quando coexistirem revisões. "Novo" significa ausente na janela histórica comparada, não necessariamente criado pela release.

## Export sanitizado para a skill

```bash
COALA_PROJECT_ID="PROJECT_ID"
COALA_RELEASE="studio-build-AAAA-MM-DD-NNN"
COALA_TRIAGE_DIR=".ai-work/error-triage/release-$COALA_RELEASE"
mkdir -p "$COALA_TRIAGE_DIR"

COALA_FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"studio\" AND jsonPayload.schemaVersion=1 AND jsonPayload.environment=\"production\" AND jsonPayload.release=\"$COALA_RELEASE\" AND NOT jsonPayload.errorName=\"SyntheticObservabilitySmoke\" AND NOT jsonPayload.messageSanitized:\"COALA_OBS_SYNTHETIC_\""

gcloud logging read "$COALA_FILTER" \
  --project="$COALA_PROJECT_ID" \
  --freshness=30d \
  --limit=1000 \
  --order=asc \
  --format='json(timestamp,severity,resource.type,resource.labels.service_name,resource.labels.revision_name,jsonPayload.schemaVersion,jsonPayload.eventId,jsonPayload.occurredAt,jsonPayload.coalaSeverity,jsonPayload.source,jsonPayload.environment,jsonPayload.release,jsonPayload.requestId,jsonPayload.correlationId,jsonPayload.fingerprint,jsonPayload.routeOrJob,jsonPayload.operation,jsonPayload.errorCode,jsonPayload.errorKind,jsonPayload.errorName,jsonPayload.messageSanitized,jsonPayload.stackSanitized,jsonPayload.metadataSanitized,jsonPayload.retryAttempt,jsonPayload.isTerminal)' \
  > "$COALA_TRIAGE_DIR/events.json"
```

O limite impede export acidental ilimitado. Se houver paginação, aumentar de forma deliberada e revisar custo/escopo; nunca remover o limite por conveniência.

Preflight explicit-only:

```bash
node --import tsx .agents/skills/coala-error-triage/scripts/triage-errors.mjs \
  --input "$COALA_TRIAGE_DIR/events.json" \
  --dry-run
```

## Recorrência e fingerprint novo

Materializar dois exports sanitizados com o mesmo schema: baseline anterior ao rollout e janela posterior. Depois, comparar apenas fingerprints:

```bash
jq -n \
  --slurpfile before .ai-work/error-triage/before/events.json \
  --slurpfile after .ai-work/error-triage/after/events.json \
  '{
    before: [$before[][]?.jsonPayload.fingerprint // empty] | unique,
    after: [$after[][]?.jsonPayload.fingerprint // empty] | unique
  }
  | . as $sets
  | {
      newFingerprints: ($sets.after - $sets.before),
      knownFingerprints: ($sets.after - ($sets.after - $sets.before))
    }'
```

A saída informa presença nos dois exports, não causalidade, recorrência ou regressão. Para essas classificações, usar datas/releases de correção e o protocolo da skill.

## Agregações seguras

Para relatórios, agrupar somente por:

- severidade;
- source allowlisted;
- `errorCode` estável;
- rota/job normalizada;
- ambiente;
- release como filtro temporal.

Fingerprint pode aparecer em tabela de triagem local, mas nunca como label de métrica. `eventId`, request/correlation ID, URL, mensagem, stack e identidade de usuário nunca são dimensões operacionais.
