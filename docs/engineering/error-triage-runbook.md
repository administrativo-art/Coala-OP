# Runbook de triagem de erros

## Estado e responsabilidade

As policies da Fase A estão ativas sem notification channel. Este runbook prepara a consulta direta no Cloud Monitoring, mas ainda não designa pessoas nem ativa SLA de resposta. Permanecem pendentes:

- responsável primário por reconhecimento;
- substituto/fallback;
- owner técnico por serviço/job;
- owner de negócio consultado para financeiro, RH, segurança e integridade;
- confirmação dos responsáveis dentro da janela de referência `06:00–23:00 BRT`.

O reconhecedor não precisa ser quem corrige. Ele confirma recebimento, preserva evidência, classifica impacto inicial e aciona o owner adequado. Somente revisão humana decide paging, issue, mitigação, rollback ou comunicação externa.

## Fluxo

```text
alerta/log
  → coleta de evidência sanitizada
  → agrupamento por fingerprint/release
  → coala-error-triage (invocação explícita)
  → classificação
  → decisão humana se é acionável
  → rascunho/revisão de issue
  → correção sistêmica
  → teste de regressão
  → PR
  → promoção imutável
  → janela de recorrência
```

Nenhuma etapa publica issue automaticamente. Alert policy, fingerprint e correlação não confirmam causa.

## 1. Reconhecer e delimitar

Registrar sem payload bruto:

- timestamp e ambiente;
- alerta/policy e threshold atingido;
- release/revisão;
- `eventId`, fingerprint, severidade, source e rota/job normalizada;
- status HTTP agregado, quando aplicável;
- terminalidade/retry do job;
- impacto observado e superfícies potencialmente afetadas.

Antes de escalar, confirmar que não é smoke sintético, autenticação/autorizacão esperada, validação de negócio, scanner, browser extension ou tentativa intermediária recuperada.

## 2. Coletar evidência sanitizada

Usar as consultas de `observability-queries.md`. Materializar somente em `.ai-work/error-triage/`, que é ignorado pelo Git. Selecionar apenas campos do contrato; não exportar bodies completos, headers, tokens, cookies, CPF/CNPJ, dados bancários, médicos ou de RH.

Se um vazamento real aparecer, interromper a cópia, registrar apenas tipo do dado/campo, `eventId`, release e superfície sanitizados, classificar como incidente separado e solicitar gate para correção. Não reproduzir o valor.

## 3. Agrupar sem inventar causa

Agrupar primeiro por fingerprint interno e comparar release, `errorCode`, source, rota/job e frames sanitizados. O mesmo fingerprint pode conter ocorrências relacionadas, mas ainda exige verificação. Fingerprints diferentes podem compartilhar causa sistêmica; não forçar união sem evidência.

Aplicar as definições de ocorrência, novo fingerprint, recorrência e regressão de `error-triage-sla.md`. Uma reaparição em nova release é apenas "fingerprint conhecido em nova release" até existir relação suficiente com correção anterior.

## 4. Executar `coala-error-triage`

A skill continua `explicit-only`, não consulta rede e não publica issue.

Preflight:

```bash
node --import tsx .agents/skills/coala-error-triage/scripts/triage-errors.mjs \
  --input .ai-work/error-triage/<export-sanitizado>.json \
  --dry-run
```

Depois de revisar schema, stack multiline e ausência de PII:

```bash
node --import tsx .agents/skills/coala-error-triage/scripts/triage-errors.mjs \
  --input .ai-work/error-triage/<export-sanitizado>.json \
  --issues .ai-work/error-triage/<inventario-local-opcional>.json
```

Revisar `normalized-events.json`, `groups.json`, `report.md` e `issue-drafts/`. O script recusa sobrescrever diretório existente. Não versionar nem anexar exports de produção sem nova decisão de segurança.

## 5. Classificar

Escolher impacto `EXPECTED`, `NOISE`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` ou `AMBIGUOUS`; e estado `NEW`, `KNOWN`, `RECURRENT`, `REGRESSION`, `RESOLVED` ou `NEEDS_INVESTIGATION`.

Separar explicitamente:

- **evidência**: o que logs, métricas e reprodução mostram;
- **inferência**: conclusão plausível sustentada por evidência;
- **hipótese**: explicação ainda não comprovada;
- **causa confirmada**: relação demonstrada por reprodução, código/dado ou outra evidência suficiente;
- **decisão**: escolha de mitigação ou correção.

## 6. Decidir se é acionável

Vira issue quando houver contrato violado e correção sistêmica possível. Exemplos: `CRITICAL`, falha terminal importante, regressão confirmada, fingerprint recorrente com impacto, vazamento ou falha de sanitização, envelope inseguro ou observação que demonstre lacuna de proteção.

Não vira issue automaticamente quando for regra de negócio esperada, scanner, auth deliberada, duplicate/retry recuperado, ruído de extensão ou correlação sem falha confirmada. Ainda assim, crescimento anormal desses grupos pode justificar investigação de produto/segurança.

## 7. Preparar issue e correção

O rascunho precisa conter:

- erro observado e evidência sanitizada;
- fingerprint/eventIds e releases;
- classe da falha;
- causa confirmada ou hipóteses abertas;
- contrato violado e superfícies afetadas;
- severidade/risco;
- menor correção sistêmica proposta;
- teste de regressão ou justificativa formal;
- plano de PR, promoção, rollout e monitoramento de recorrência.

Seguir `issue-protocol.md`. Uma issue não termina quando a linha muda: deve existir artefato permanente que impeça a classe de falha de voltar.

## 8. Recorrência pós-release

Depois da promoção, consultar a release corrigida e a seguinte por fingerprint, `errorCode`, rota/job e contrato. Registrar janela, volume de requests e filtros. Ausência em janela curta é somente "não observado", nunca "resolvido".

Uma regressão precisa relacionar evento posterior, release diferente da `fixedRelease` e contrato previamente protegido. Se faltar qualquer elemento, usar `RECURRENT` ou `NEEDS_INVESTIGATION` conforme a evidência.

## Handoff mínimo

Ao trocar o responsável, informar: classe/estado, prazo de SLA, release, fingerprint, eventIds, consulta reproduzível, impacto, exclusões aplicadas, hipóteses, ações já executadas e próximo gate. Nunca afirmar que uma consulta, teste, rollout ou contenção ocorreu sem evidência.
