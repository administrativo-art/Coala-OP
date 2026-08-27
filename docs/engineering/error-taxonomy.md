# Taxonomia de erros do Coala-OP

Erros esperados de negócio e falhas inesperadas de sistema têm contratos diferentes. Status HTTP é apenas um sinal; severidade depende de impacto, terminalidade e possibilidade de recuperação.

| Categoria | HTTP típico | Reportável | Severidade | Retry | Mensagem pública |
|---|---:|---|---|---|---|
| `EXPECTED_BUSINESS` | 400/422 | não | low | não | regra de negócio segura |
| `AUTHENTICATION` | 401 | não | low | após nova sessão | autenticação necessária |
| `AUTHORIZATION` | 403 | não | low | não | acesso não permitido |
| `VALIDATION` | 400/422 | não | low | após correção | dados inválidos |
| `NOT_FOUND` | 404 | não | low | não | recurso não encontrado |
| `CONFLICT` | 409 | conforme origem | medium | após revalidação | estado mudou |
| `TRANSIENT_EXTERNAL` | 502/503/504 | somente terminal | medium | limitado e idempotente | serviço temporariamente indisponível |
| `PERMANENT_EXTERNAL` | 502/424 | sim | high | não automático | integração indisponível |
| `UNEXPECTED_APPLICATION` | 500 | sim | high | somente operação idempotente | falha inesperada com referência |
| `DATA_INTEGRITY` | 409/500 | sim | critical | não automático | operação interrompida |
| `SECURITY_INCIDENT` | 401/403/500 | sim | critical | não automático | mensagem neutra |
| `FINANCIAL_INCIDENT` | 409/500 | sim | critical | somente com idempotência | operação financeira não concluída |

Uma exceção esperada não vira incidente apenas por ter sido capturada. Mensagem pública vem de contrato estável, nunca de `cause`, `error.message` ou stack. Retry de mutação exige idempotência comprovada. Auditoria de negócio continua separada da observabilidade técnica.
