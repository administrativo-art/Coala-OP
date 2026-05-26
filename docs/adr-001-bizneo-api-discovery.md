# ADR-001 — Discovery Técnico da API Bizneo

**Status:** Parcialmente preenchido — itens marcados com ⚠️ PENDENTE requerem validação manual.  
**Data:** Mai/2026  
**Módulo:** Coala RH · Fase -1

---

## Contexto

Antes de implementar o `field_map` e a CF `syncFromBizneo`, precisamos confirmar os contratos da API Bizneo HR para o tenant `coala.bizneohr.com`. Parte das informações já está disponível no codebase existente (`syncBizneoUsersMonthly`). O restante precisa ser validado com uma conta com acesso à API.

---

## Perguntas e Respostas

### D-01 — Autenticação

| Pergunta | Status | Observação |
|----------|--------|------------|
| Mecanismo de auth | ✅ Confirmado | Token estático via query param `?token={BIZNEO_TOKEN}` |
| Renovação automática | N/A | Token estático — não expira por design |
| Variável de ambiente | ✅ | `BIZNEO_TOKEN` configurada no projeto `smart-converter-752gf` |

```
GET https://coala.bizneohr.com/api/v1/users?token={BIZNEO_TOKEN}&page_size=100&page=1
```

---

### D-02 — Endpoints disponíveis

| Endpoint | Status | Observação |
|----------|--------|------------|
| `GET /api/v1/users` | ✅ Confirmado | Usado por `syncBizneoUsersMonthly` |
| `GET /api/v1/users/{id}` | ✅ Confirmado | Usado por `syncBizneoUsersMonthly` para detalhe |
| `GET /api/v1/users/{id}/custom_fields` | ⚠️ PENDENTE | Necessário para campos customizados |
| `GET /api/v1/custom_fields` | ⚠️ PENDENTE | Lista de campos disponíveis |
| `GET /api/v1/users/{id}/contracts` | ⚠️ PENDENTE | Contratos e datas de vigência |
| `GET /api/v1/absences` | ⚠️ PENDENTE | Verificar se relevante para o MVP |

---

### D-03 — Paginação

| Pergunta | Status | Observação |
|----------|--------|------------|
| Estratégia | ✅ Confirmado | Offset por `page` + `page_size` |
| Limite por página | ✅ Confirmado | `page_size=100` funciona |
| Campo de total | ✅ Confirmado | `data.pagination.total_pages` |
| Cursor disponível? | ⚠️ PENDENTE | Cursor seria mais eficiente para sync incremental |

```typescript
// Padrão de paginação já validado em syncBizneoUsersMonthly:
const totalPages = data.pagination?.total_pages;
if (!totalPages || page >= totalPages) break;
page += 1;
```

---

### D-04 — Campos customizados via API

| Pergunta | Status | Observação |
|----------|--------|------------|
| Campos customizados acessíveis via API? | ⚠️ PENDENTE | Testar `GET /users/{id}/custom_fields` |
| IDs dos campos são estáveis? | ⚠️ PENDENTE | Confirmar se ID muda ao recriar campo |
| Valores incluídos na resposta de `/users/{id}`? | ⚠️ PENDENTE | Ou precisa de endpoint separado? |
| Formato de retorno dos valores? | ⚠️ PENDENTE | `{field_id, value}` ou outro? |

**IDs conhecidos do codebase atual (referências no código):**
```
cf_15642_endereco         → employee.address
cf_15642_vt_diario        → employee.vt_daily_value
cf_15645_uniforme_camisa  → employee.uniform_shirt_size
```
> Esses IDs aparecem em comentários/exemplos — confirmar se são reais ou apenas exemplos do plano.

**Plano B se campos customizados não forem acessíveis via API:**
- Exportar CSV do Bizneo manualmente
- CF de parsing de CSV no Cloud Storage → popula `field_values`
- Sync manual periódico até que a API suporte campos customizados

---

### D-05 — Rate limit, quotas e retry

| Pergunta | Status | Observação |
|----------|--------|------------|
| Existe rate limit documentado? | ⚠️ PENDENTE | Testar via headers `X-RateLimit-*` |
| Limite de requests/min? | ⚠️ PENDENTE | |
| Headers de rate limit na resposta? | ⚠️ PENDENTE | |
| Comportamento no 429? | ⚠️ PENDENTE | Retry-After header? |

**Estratégia de retry implementada no `bizneoClient` (independente dos limites):**
```typescript
// Exponential backoff: 1s, 2s, 4s, 8s — 4 tentativas
const RETRY_DELAYS = [1000, 2000, 4000, 8000];
```

---

### D-06 — Webhooks

| Pergunta | Status | Observação |
|----------|--------|------------|
| Bizneo oferece webhooks? | ⚠️ PENDENTE | Verificar painel de integrações do Bizneo |
| Eventos disponíveis? | ⚠️ PENDENTE | onUserUpdate, onContractChange? |
| Autenticação do webhook (HMAC)? | ⚠️ PENDENTE | |

**Impacto:** Se webhooks estiverem disponíveis, substituir polling diário por `onBizneoWebhook` CF. Reduz latência de sync de 24h para <1min.

---

## Decisão

**Go/No-go para a Fase 0:**

Com os itens confirmados (D-01, D-02, D-03) é possível:
- ✅ Iniciar Fase 0 (schema TypeScript, Security Rules, `rh_access_cache`)
- ✅ Iniciar Fase 1 (componentes de perfil com dados mock)
- ✅ Implementar `bizneoClient` com os endpoints básicos (`/users`, `/users/{id}`)

Ainda bloqueado até D-04 ser confirmado:
- ⚠️ Mapeamento definitivo de `bizneo_id` no `field_map` (F0-02)
- ⚠️ Sync completo de campos customizados (3A-02)

**Fallback ativo:** `field_map` v1.0 usa `bizneo_id: "PENDING_DISCOVERY"` para campos customizados. O sync de campos básicos (nome, email, admissão, nascimento) funciona imediatamente via `/users/{id}`.

---

## Como validar os itens PENDENTE

```bash
# Requer BIZNEO_TOKEN configurado no ambiente local

# D-02: Testar endpoints
curl "https://coala.bizneohr.com/api/v1/users/17006830/custom_fields?token=$BIZNEO_TOKEN" | jq

# D-04: Ver estrutura dos campos
curl "https://coala.bizneohr.com/api/v1/custom_fields?token=$BIZNEO_TOKEN" | jq

# D-05: Inspecionar headers de rate limit
curl -I "https://coala.bizneohr.com/api/v1/users?token=$BIZNEO_TOKEN&page_size=1&page=1"

# D-06: Verificar documentação de webhooks
# → Acessar painel admin do Bizneo em coala.bizneohr.com/admin/integrations
```

Quando cada item for confirmado, atualizar este ADR com o resultado e marcar como ✅.

---

*ADR-001 · Coala RH · Mai/2026*
