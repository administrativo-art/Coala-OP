# Plano de correção — Organizador Inteligente de Documentos de RH

> Execução em fases, na ordem obrigatória. Este documento é atualizado ao fim de cada fase.
> Princípio: **a IA interpreta; as regras validam; o sistema executa.** O cliente nunca é barreira de segurança.

## Tabela de fases

| Fase | Status | Arquivos alterados | Testes | Pendências |
|---|---|---|---|---|
| 0. Corrigir build | ✅ CONCLUÍDA | `api/rh/employee-profile/[employeeId]/route.ts` | typecheck 0 erros | — |
| 1.1 Enforcement de acesso | ✅ CONCLUÍDA | `lib/hr/employee-document-access.ts` (novo), `api/hr/employee-documents/access/route.ts`, `api/hr/employee-documents/route.ts` | `access-policy.test.ts` (11) | UI de download não distingue negado; ADMIN_ONLY não usado ainda |
| 1.2 Match determinístico | ✅ CONCLUÍDA (analyze) / 🟡 PARCIAL (arquivamento) | `lib/hr/employee-document-match.ts` (novo), `api/hr/employee-documents/analyze-upload/route.ts` | `employee-match.test.ts` (13) | Bloqueio *hard* no arquivamento direto depende da Fase 2/7 (item persistido com match reverificado) |
| 1.3 Remover PII do path | ✅ CONCLUÍDA | `lib/hr/employee-document-planning.ts` | `document-planning.test.ts` (5) | Migração de documentos legados — estratégia definida, execução pendente |
| 2. Persistir análise | ✅ CONCLUÍDA | `api/hr/employee-documents/route.ts` | via distribution/decision | `fieldConfidences` por campo depende de novo schema de IA (Fase futura) |
| 3. Distribuição 100% backend | ✅ CONCLUÍDA | `lib/hr/employee-document-distribution.ts`, `route.ts`, page.tsx | `distribution.test.ts` | — |
| 4. Unificar catálogo | ✅ CONCLUÍDA | `lib/hr/employee-document-catalog.ts`, `analyze-upload/route.ts` | `distribution.test.ts` | Migrar catálogo para Firestore (versionado) fica p/ depois; base legada de strings livres ainda existe mas não decide destino |
| 5. Subpastas virtuais/processos | ✅ CONCLUÍDA | `lib/hr/employee-document-distribution.ts` | `distribution.test.ts` | Entidades explícitas (VacationInstallment etc.) não persistidas; subpastas derivam de metadados |
| 6. Hash/duplicidade/versão | 🟡 PARCIAL | `lib/hr/employee-document-identity.ts`, `distribution.ts`, `route.ts` | `distribution.test.ts` | Versão é campo no doc (sem subcoleção `versions/` própria); concorrência de numeração sem transação |
| 7. Lote/itens persistentes | ✅ CONCLUÍDA | `lib/hr/employee-document-batch.ts`, `analyze-upload`, `confirm/route.ts` | `batch.test.ts` (8) | Sem retomada visual de lotes antigos (dado já persistido); numeração de versão sem transação global |
| 8. Storage temporário | ✅ CONCLUÍDA | `analyze-upload`, `confirm/route.ts`, `cleanup/route.ts` | — | Cron que chama `cleanup` ainda precisa ser agendado (endpoint pronto) |
| 9. Tela de revisão | 🟡 PARCIAL | `item/route.ts`, page.tsx | recompute testado | Backend corrige TIPO e COLABORADOR (re-verifica match, exige justificativa, audita); UI só expõe troca de tipo; falta *reanalisar* |
| 10. Motor de regras | ✅ CONCLUÍDA | `lib/hr/employee-document-decision.ts`, todas as rotas | `decision.test.ts` (12) | — |
| 11. Fila/idempotência | 🟡 PARCIAL | `confirm/route.ts` (lock transacional + guarda de status) | `batch.test.ts` | Idempotente e por-item (queue-ready), mas **síncrono** — Cloud Tasks não conectado (requer infra GCP) |
| 12. Auditoria/observabilidade | 🟡 PARCIAL | rotas | — | Eventos completos + `traceId` (lote→item→documento) + duração da análise; falta **tokens/custo** (exige capturar `usage` da OpenAI) |
| 13. Testes completos | 🟡 PARCIAL | `tests/unit/hr-documents/*` | 72 casos | Falta integração/emuladores (E2E) |

Status: ✅ CONCLUÍDA · 🟡 PARCIAL · 🔵 EM ANDAMENTO · ⬜ NÃO INICIADA · ⛔ BLOQUEADA

---

## Fase 0 — Corrigir o build

**Arquivos analisados:** `src/app/api/rh/employee-profile/[employeeId]/route.ts`.

**Problema real:** a auditoria reportou `TS2739 (Date vs Timestamp)` na atribuição de `updated_at`. Na verdade, o build **já estava limpo** na árvore atual (a linha usava `new Date() as unknown as ...`). Ainda assim, `new Date()` num campo tipado como `Timestamp` é semanticamente frágil.

**Solução:** usar um `Timestamp` real do Admin SDK (`Timestamp.now()`) reconciliado com o tipo declarado (que é o `Timestamp` do client SDK). O objeto `cache` é apenas devolvido no JSON da resposta (não é persistido), então não há conversão de data inconsistente na escrita.

**Resultado:** `npx tsc --noEmit` → **0 erros**.

**Critérios atendidos:** typecheck limpo; sem conversão inconsistente na persistência. **Pendências:** nenhuma.

---

## Fase 1 — Segurança crítica (P0)

### 1.1 Enforcement de acesso no backend

**Arquivos analisados:** `access/route.ts`, `route.ts`, `features/hr/lib/server-access.ts`, `lib/hr/employee-document-options.ts`, `types/index.ts` (PermissionSet).

**Problema real:** `access/route.ts` gerava a URL assinada apenas com `assertHrAccess("view")` — permissão ampla. O `accessLevel` do documento era armazenado mas **nunca consultado**. Qualquer usuário com `dp.view` baixava contracheque/atestado confidencial.

**Solução:** novo módulo puro `lib/hr/employee-document-access.ts`:
- Políticas estáveis: `HR_OPERATIONAL`, `HR_RESTRICTED`, `HR_FINANCE`, `OCCUPATIONAL_HEALTH`, `EMPLOYEE_VISIBLE`, `ADMIN_ONLY`.
- `DOCUMENT_TYPE_ACCESS_POLICY`: política **por código de tipo** (autoritativa); fallback do `accessLevel` legado; default seguro = `HR_RESTRICTED`.
- `canAccessUnderPolicy(policy, subject)`: decisão a partir de `isDefaultAdmin`, `manageUsers`, `dp.rh_role`, `dp.rh.can_view_salary`, `dp.collaborators.{view,edit}`, e `isOwner` (o próprio titular).
- Aplicado em `access/route.ts` **antes** de assinar a URL (nega → HTTP 403 + auditoria `ACCESS_DENIED`) e na **listagem** (`GET`), filtrando documentos que o usuário não pode ver.

Regras efetivas: contracheque/rescisório → financeiro/admin/titular; atestado/ASO → RH elevado (sem titular, sem view básico); aviso de férias → RH básico + titular.

**Testes:** `tests/unit/hr-documents/access-policy.test.ts` — 11 casos (contracheque negado a `dp.view`; financeiro/titular/admin liberados; ASO negado a financeiro e ao titular; férias liberado a `dp.view`; resolução por código/legado/default).

**Critérios atendidos:** usuário só com `dp.view` não acessa contracheque/ASO; financeiro não acessa ASO; negado recebe 403; tentativa auditada; enforcement no backend (independe do frontend). **Pendências:** a UI ainda não trata o 403 de forma diferenciada; `ADMIN_ONLY` fica disponível para uso futuro.

### 1.2 Match determinístico do colaborador

**Arquivos analisados:** `analyze-upload/route.ts`, `types/rh.ts` (Employee/field_values), `default-field-map.ts` (`employee.cpf`, `employee.birth_date`).

**Problema real:** o `employeeMatchStatus` vinha da IA e era aceito sem comparar CPF/matrícula com o cadastro.

**Solução:** novo módulo puro `lib/hr/employee-document-match.ts`:
- `normalizeCpf`, `isValidCpf` (dígito verificador), `normalizePersonName`.
- `matchEmployeeAgainstExpected({ extracted, expected })` → `MATCH | POSSIBLE_MATCH | MISMATCH | UNKNOWN`, na ordem CPF → matrícula → código interno → nome+corroborante → nome semelhante. **CPF válido que difere do esperado → MISMATCH.**
- Integração no `analyze-upload`: `loadExpectedIdentity()` lê CPF/matrícula/nome/nascimento reais do RH (`employees` por `auth_uid`), e o **backend** calcula o match, substituindo o da IA. O `aiEmployeeMatchStatus` é preservado só para observabilidade.
- `decideStatus` endurecido: **somente `MATCH` pode ficar `ready`**; `MISMATCH` → `blocked`; `UNKNOWN/POSSIBLE_MATCH` → `review`.

**Testes:** `tests/unit/hr-documents/employee-match.test.ts` — 13 casos (CPF correto → MATCH; CPF de outro → MISMATCH; só matrícula → MATCH; nome só → POSSIBLE_MATCH; nome+admissão → MATCH; homônimo → POSSIBLE_MATCH; sem identificador → UNKNOWN; CPF inválido cai para matrícula; validação/normalização de CPF).

**Critérios atendidos:** arquivo com CPF de outra pessoa nunca fica `ready` (vira `blocked`); CPF correto associa ao colaborador; homônimos → revisão; sem identificador não fica pronto; testes cobrem CPF/matrícula/nome/homônimo/divergência. **Pendências (🟡):** o bloqueio *hard* no **arquivamento direto** (POST forjado ao endpoint de arquivamento, sem passar pela prévia) depende do item persistido com match reverificado no servidor — **Fase 2/7**. Hoje o fluxo normal já está protegido porque só `ready` (=MATCH) é arquivável e `MISMATCH` nunca chega como `ready`.

### 1.3 Remover PII do caminho do Storage

**Arquivos analisados:** `lib/hr/employee-document-planning.ts` e seus consumidores (`route.ts`, `analyze-upload/route.ts`).

**Problema real:** `buildEmployeeDocumentPlan` inseria o slug do **nome completo** do colaborador no `storagePath` e no `fileName`.

**Solução:** o caminho físico passou a usar **apenas identificadores técnicos**: `hr/employee-documents/{employeeId}/documents/{documentId}/original.{ext}`. O nome de download deixou de conter o nome do colaborador (`{typeSlug}__{originalSlug}__{shortId}.{ext}`) — sem CPF, sem nome completo. A trilha de exibição (UI) permanece legível, pois não é caminho físico.

**Testes:** `tests/unit/hr-documents/document-planning.test.ts` — 5 casos (path técnico exato; ausência de nome no path/subfolder; ausência de nome no download; trilha de exibição preservada).

**Critérios atendidos:** nenhum `storagePath`/`fileName` contém nome completo ou CPF. **Pendências:** documentos **legados** mantêm o path antigo gravado no Firestore (continuam acessíveis, pois o path é lido do próprio documento); uma migração para reescrever paths antigos fica planejada (não executada nesta fase).

---

## Resultado dos comandos (fim da Fase 1)

- `npx tsc --noEmit` → **0 erros**.
- `npm run test:unit` → **89 testes, 89 passam, 0 falham** (29 novos do módulo + 60 existentes).
- `next lint` → não executado (projeto em migração para ESLint v9; prompt interativo).
- `next build` → não executado nesta rodada (typecheck já cobre a compilação de tipos).

## Impactos no acervo existente

- **Listagem/leitura mais restrita:** usuários sem clearance deixam de ver documentos sigilosos que antes eram acessíveis. Reveja os perfis (`dp.rh.can_view_salary`, `dp.rh_role`, `dp.collaborators.edit`) para garantir que quem precisa continua com acesso.
- **Menos itens "prontos":** com o match determinístico, só documentos com colaborador confirmado (CPF/matrícula) ficam `ready`; os demais vão para revisão. Colaboradores sem CPF cadastrado no RH nunca auto-prontificam — cadastre o CPF para habilitar o MATCH.
- **Novos uploads** usam o novo esquema de path; **documentos antigos** seguem acessíveis pelo path gravado.

## Riscos restantes (P0/P1)

1. **Arquivamento direto forjado** ainda não reverifica o match no servidor (mitigado pelo fluxo normal; fecha na Fase 2/7).
2. **Distribuição** ainda aceita categoria/acesso do manifesto do cliente (Fase 3).
3. **Dados extraídos** ainda são descartados no arquivamento (Fase 2).
4. **Sem hash/versão/lote persistente** (Fases 6/7).

---

## Rodada 2 — Fases 2, 3, 4, 5, 6, 10, 12 (núcleo determinístico)

**Módulos novos (puros, testáveis):**
- `lib/hr/employee-document-catalog.ts` (Fase 4) — fonte única enriquecida: por código, `accessPolicyId`, `processCategory`, `duplicateStrategy`, `duplicateKeys`, templates de nome, limiares. `getDocumentTypeConfig(code)`.
- `lib/hr/employee-document-distribution.ts` (Fases 3/5/6) — `resolveDocumentProcess` (subpasta virtual por metadados), `buildDocumentNames` (templates), `resolveDocumentDestination`, `resolveDuplicateAndVersion` (hash exato + chave lógica + versão).
- `lib/hr/employee-document-decision.ts` (Fase 10) — `decideDocumentAction`: uma decisão determinística; a IA nunca decide arquivar.
- `lib/hr/employee-document-identity.ts` — `loadExpectedIdentity`, `employeeCodeFrom`, `hashBuffer` (SHA-256).

**Endpoints:**
- `analyze-upload/route.ts` reescrito: usa catálogo + destino determinístico + motor de decisão; **removido o fluxo legado de grupos manuais** (código morto) e o dispatch por content-type. Prévia agora traz `destinationPreview`, `displayName`, `decisionReason`.
- `route.ts` (`saveEmployeeDocument`) **server-autoritativo**: recalcula tipo→destino/nome/acesso; **reverifica o match** (bloqueia `MISMATCH`); calcula **hash** e **duplicidade/versão**; **persiste a análise** (extractedFields, match, contentHash, logicalKey, version, accessPolicyId, destino); **audita** `DOCUMENT_FILED`/`DUPLICATE_BLOCKED`. Arquivamento por item com **falha isolada** (um item que falha não bloqueia os outros → base do parcial). Ignora pasta/acesso/nome vindos do cliente.
- `page.tsx` (perfil): manifesto agora envia só `documentTypeCode` + `extractedFields`; trata falhas parciais na mensagem.

**Nomenclatura (exemplos do plano, cobertos por teste):**
- `COL-00124__CONTRACHEQUE__2026-07__v01`
- `COL-00124__AVISO-FERIAS__PA-2025-2026__P01__2026-07-30__v01`
- Trilha férias: `Férias › Período aquisitivo 2025-2026 › Parcela 01 › Aviso de férias`

**Verificação (fim da Rodada 2):** `tsc --noEmit` → **0 erros**; `npm run test:unit` → **112/112** (64 do módulo).

### O que falta (honesto)
- **Fase 7** (coleções `documentUploadBatches`/`documentUploadItems` e retomada de lote), **Fase 8** (storage temporário + limpeza de órfãos), **Fase 9** (ações de correção na UI: alterar tipo/colaborador/reanalisar com recálculo), **Fase 11** (fila Cloud Tasks + idempotência) — são infra/UX-pesadas e **não bloqueiam a segurança**, que já está fechada no backend.
- **Anti-tamper total do match no arquivamento:** hoje o servidor reverifica o match contra o CPF real do colaborador, mas usa o CPF *extraído informado no manifesto* (claim do cliente). O fechamento 100% (sem confiar em nenhum campo do cliente) exige o item persistido no `analyze` (Fase 7), lido no arquivamento em vez do manifesto.
- **Versionamento** grava `version`/`versionResolution` no próprio doc e caminho `versions/{n}/`. **Numeração agora é transacional** (`documentVersionCounters/{hash(logicalKey)}` reservado em `runTransaction`), evitando colisão em confirmações concorrentes. Falta apenas a subcoleção de versões independente (histórico separado).

---

## Rodada 3 — Fases 7, 8, 9, 11 (lote persistente, temporário, correção, idempotência)

**Novo modelo (Fase 7):** coleções `documentUploadBatches` e `documentUploadItems` (RH DB). Máquina de estados pura em `lib/hr/employee-document-batch.ts` (`computeBatchCounters`, `deriveBatchStatus`, `canFileItem`), testada.

**Novo fluxo:**
- `analyze-upload` agora **cria o lote + itens** e sobe cada arquivo à **área temporária** `hr/pending-document-batches/{batchId}/items/{itemId}/original.{ext}` (Fase 8). Persiste em cada item: match do backend, tipo, destino, decisão, hash, campos extraídos. Retorna `batchId`.
- **`confirm/route.ts`** (novo): arquiva a partir dos **itens persistidos** — o cliente só aponta `batchId`/`itemIds`, **não envia tipo/pasta/acesso nem arquivo**. Isso **fecha o anti-tamper do match** (a decisão vem do servidor, não do cliente). Move temp→definitivo (`copy` + delete), resolve duplicidade/versão, cria o documento, atualiza contadores/estado do lote (**arquivamento parcial**), e é **idempotente** (lock transacional `ready→filing` + guarda de status). Um item que falha não bloqueia os outros.
- **`item/route.ts`** (Fase 9, `PATCH`): corrige o **tipo** de um item; o backend recalcula destino/nome/acesso e **re-decide** (um item em revisão pode virar `ready`). UI: seletor de tipo nos itens não-prontos, que atualiza o card na hora.

**Fase 11 (parcial):** o processamento por item é idempotente e desacoplado (pronto para fila), mas permanece **síncrono** — Cloud Tasks não foi conectado (exige provisionamento GCP: fila, service account, OIDC), o que não é verificável aqui.

**Verificação (fim da Rodada 3):** `tsc --noEmit` → **0 erros**; `npm run test:unit` → **120/120** (72 do módulo).

### Restante honesto
- **Fase 11 real** (Cloud Tasks/Pub-Sub) — infra GCP (o fluxo já é idempotente e queue-ready).
- **Fase 9 completa** — trocar colaborador e reanalisar na UI (trocar tipo já feito).
- **Fase 8** — agendar um cron para chamar `POST /api/hr/employee-documents/cleanup` (endpoint pronto e idempotente).
- **Fase 12** — métricas de tokens/custo (capturar `usage` da resposta da OpenAI).
- **Fase 13** — testes de integração/emuladores (E2E).
- **Limitação:** a lógica pura está testada e tudo compila; a fiação Firestore/Storage **não foi executada em runtime** aqui (precisa do app + emuladores).

---

## Endpoints do módulo (referência)

| Método | Rota | Papel |
|---|---|---|
| POST | `/api/hr/employee-documents/analyze-upload` | Cria lote + itens, sobe ao temporário, analisa (IA + regras). |
| POST | `/api/hr/employee-documents/confirm` | Arquiva itens `ready` do lote (server-autoritativo, idempotente). |
| PATCH | `/api/hr/employee-documents/item` | Corrige o tipo de um item; recalcula destino/decisão. |
| POST | `/api/hr/employee-documents/cleanup` | Remove lotes/temporários expirados (admin/cron). |
| GET/POST/PATCH/DELETE | `/api/hr/employee-documents` | Lista (com política), arquiva single, muda status, exclui. |
| POST | `/api/hr/employee-documents/access` | URL assinada com enforcement de política + auditoria. |
| GET | `/api/hr/employee-documents/summary` | Resumo por colaborador. |
