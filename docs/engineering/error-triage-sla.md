# SLA provisório de triagem de erros

## Vigência e limite

Esta política é uma proposta experimental para os primeiros 30 dias após a ativação dos sinais. Ela mede reconhecimento humano, triagem e contenção/decisão; não promete prazo absoluto de resolução definitiva.

A cobertura de referência é `06:00–23:00 BRT`. A Fase A não possui notification channel, paging ou responsáveis formalmente nomeados; portanto, os prazos abaixo **não constituem SLA operacional ativo**. Eles servem para desenhar a futura operação quando houver canal, titular e fallback testados. Não existe compromisso `CRITICAL` 24x7 nem paging `CRITICAL`.

## Prazos propostos, ainda inativos

| Classe | Reconhecimento | Contenção ou decisão | Notificação inicial |
|---|---|---|---|
| `CRITICAL` | até 15 min dentro da cobertura | contenção inicial em até 1 h | imediata |
| `HIGH` | até 1 hora útil | decisão de mitigação no mesmo dia útil | por impacto, terminalidade ou recorrência; não por todo evento isolado |
| `MEDIUM` | até o próximo dia útil | decisão/plano em até 5 dias úteis | fila de triagem, sem paging |
| `LOW` | revisão semanal | decisão quando houver tendência ou contrato violado | sem paging |
| `AMBIGUOUS` | conforme impacto potencial | coletar evidência antes de reclassificar | somente se o risco potencial justificar |

## Significado das classes

- `CRITICAL`: segurança, integridade de dados, incidente financeiro, indisponibilidade comprovada ou falha equivalente que exija contenção imediata.
- `HIGH`: falha inesperada com impacto relevante, falha terminal de job importante, integração crítica interrompida ou recorrência acionável.
- `MEDIUM`: impacto moderado/transitório, dívida operacional recorrente sem incidente imediato ou evidência que exige caracterização.
- `LOW`: esperado, recuperável ou ruído conhecido sem tendência anormal.
- `AMBIGUOUS`: evidência insuficiente; não autoriza inventar causa.

Status HTTP e `WARNING` isolados não definem severidade. `401`, `403`, `404`, validação de negócio e tentativa intermediária de retry são avaliados pelo contrato e impacto.

## Estados temporais

- **ocorrência**: um evento individual, identificado por `eventId` quando for `SystemErrorEvent`.
- **novo fingerprint**: fingerprint ainda não observado no conjunto histórico consultado. A afirmação deve citar janela e filtros.
- **fingerprint conhecido em nova release**: mesmo fingerprint em release diferente, sem concluir regressão.
- **recorrência**: evento posterior a uma correção/fechamento, mas sem evidência suficiente para relacioná-lo a uma release diferente da correção.
- **regressão**: ocorrência posterior à correção em release diferente da `fixedRelease`, relacionada a contrato que era considerado protegido. Exige `fixedAt`/`closedAt`, `fixedRelease` e evidência temporal compatível.

A reaparição de um fingerprint, sozinha, não prova regressão nem causa comum. Ausência em um export não prova resolução.

## Quando vira issue

Um grupo vira rascunho de issue quando houver bug acionável: contrato violado, evidência sanitizada suficiente, impacto/superfície caracterizados e deduplicação por fingerprint concluída. Todo `CRITICAL`, falha terminal importante, regressão confirmada e recorrência com impacto deve ser avaliado para issue. Um alerta não publica issue automaticamente.

O rascunho deve seguir `issue-protocol.md` e separar evidência, inferência, hipótese e causa confirmada. A correção só conclui o ciclo com proteção permanente, teste de regressão ou justificativa formal, rollout e janela de recorrência aplicável.

## Revisão em 30 dias

Reavaliar volume por severidade/source/rota normalizada, falsos positivos, falsos negativos, tempo real de reconhecimento, falhas de canal, cardinalidade/custo e os thresholds provisórios. A revisão deve manter, apertar ou remover cada regra com evidência, nunca por conveniência isolada.
