# Taxonomia de erros do Coala-OP

Esta taxonomia separa falhas esperadas de incidentes técnicos. O status HTTP é apenas um sinal: severidade depende do impacto, da terminalidade, do domínio e da possibilidade de recuperação.

| Categoria | HTTP típico | Reportável | Severidade padrão | Retry | Alerta | Issue | Interrupção humana | Mensagem pública |
|---|---:|---|---|---|---|---|---|---|
| `EXPECTED_BUSINESS` | 400/422 | não | low | não | não | somente recorrência anormal | não | regra de negócio em linguagem segura |
| `AUTHENTICATION` | 401 | não | low | após nova sessão | não | somente padrão anormal | não | autenticação necessária |
| `AUTHORIZATION` | 403 | não | low | não | somente padrão anormal | somente suspeita de regressão | segurança quando ambíguo | acesso não permitido |
| `VALIDATION` | 400/422 | não | low | após correção | não | somente contrato incorreto | não | campos inválidos, sem detalhes internos |
| `NOT_FOUND` | 404 | não | low | não | não | somente recurso que deveria existir | não | recurso não encontrado |
| `CONFLICT` | 409 | conforme origem | medium | após revalidação | não por padrão | quando bloqueia fluxo | somente impacto alto | estado mudou; revise e tente novamente |
| `TRANSIENT_EXTERNAL` | 502/503/504 | somente terminal | medium | sim, com limite e idempotência | na falha terminal | quando recorrente ou terminal | high quando função importante para | serviço temporariamente indisponível |
| `PERMANENT_EXTERNAL` | 502/424 | sim | high | não automático | sim | sim | sim | integração indisponível; referência do evento |
| `UNEXPECTED_APPLICATION` | 500 | sim | high | somente operação idempotente | sim | sim | sim quando high/critical | falha inesperada; referência do evento |
| `DATA_INTEGRITY` | 409/500 | sim | critical | não automático | imediato | sim | imediato | operação interrompida com segurança |
| `SECURITY_INCIDENT` | 401/403/500 | sim | critical | não automático | imediato | sim, com acesso restrito | imediato | mensagem neutra, sem indicar defesa interna |
| `FINANCIAL_INCIDENT` | 409/500 | sim | critical | somente com idempotência comprovada | imediato | sim | imediato | operação não concluída; referência do evento |

## Regras de severidade

- `low`: esperado, recuperável e sem perda funcional relevante.
- `medium`: impacto moderado, alternativa disponível ou falha transitória ainda recuperável.
- `high`: função importante indisponível, integração terminal ou recorrência significativa.
- `critical`: possível perda/corrupção de dados, segurança ou movimentação financeira incorreta.

Um `404` esperado não é incidente. Um timeout seguido de retry bem-sucedido é normalmente `low`; retries esgotados em integração importante são `high`; pagamento potencialmente duplicado e corrupção de dados são `critical`.

## Princípios de resposta

- Mensagem pública vem de contrato estável (`safeMessage`), nunca de `cause` ou `error.message` bruto.
- Retry automático de mutação só é permitido com idempotência comprovada.
- Erros esperados não criam evento crítico automaticamente.
- Alertas representam falha terminal ou padrão anormal, não cada tentativa.
