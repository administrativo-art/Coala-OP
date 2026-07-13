# Organizador Inteligente de Documentos de RH — Pendências para finalizar

> Documento de handoff. Diz **exatamente o que falta** para o módulo ir a produção,
> com passos, arquivos, critério de aceite, esforço e risco. Complementa
> `docs/plano-correcao-organizador-documentos.md` (histórico do que foi feito).

## Estado atual (verificado)

- **Build:** `npx tsc --noEmit` → **0 erros**.
- **Testes:** `npm run test:unit` → **125/125** (unitários de lógica pura).
- **Backend funcionalmente completo:** política de acesso aplicada no backend, match
  determinístico por CPF/matrícula, PII fora do caminho físico, distribuição determinística
  (pasta/processo/subpasta/nome/acesso), catálogo único enriquecido, hash + duplicidade +
  versão **transacional**, motor de regras, lote/itens persistentes, storage temporário,
  arquivamento parcial **idempotente**, correção de **tipo e colaborador**, **reanálise** por
  item, **retomada de lote**, confiança por campo, tokens/custo, auditoria com `traceId`,
  limpeza de expirados.
- **Nunca foi executado em runtime.** Toda a validação até aqui é typecheck + testes de lógica
  pura. A fiação Firestore/Storage e os endpoints/UI **não foram exercidos** — este é o maior
  risco aberto.

---

## ✅ Para finalizar — caminho crítico (faça nesta ordem)

Só os itens **P0** bloqueiam produção. Em ordem:

1. **P0.1 — Testar o fluxo com emuladores** (anexar → analisar → corrigir → arquivar → baixar).
2. **P0.2 — Verificar o gate de "ready"** (o achado do `missingCriticalFields`, ver abaixo).
3. **P0.3 — Agendar o cron do `cleanup`**.
4. **P0.4 — Revisar os perfis de acesso**.
5. **P0.5 — Decidir a estratégia dos documentos legados**.
6. **P0.6 — Confirmar rules e índices** das novas coleções.

Feitos os P0, o fluxo principal está seguro. P1/P2 são evolução.

**Legenda de esforço:** **P** (≤2h) · **M** (meio dia) · **G** (1–2 dias) · **GG** (>2 dias / infra).

---

## P0 — Obrigatório antes de produção

### P0.1 — Verificar o fluxo ponta a ponta com os emuladores · M · risco ALTO
**Status local:** fluxo real executado com `firebase emulators:start`, `npm run dev:emu`, token novo
do Auth Emulator e IA `gpt-5.6-terra`. Passaram: upload/análise real → `ready`, arquivamento v01,
URL assinada/download, 403 com `ACCESS_DENIED`, duplicata exata (`EXACT_DUPLICATE`) e retificação
lógica como v02. Falta apenas o clique manual na UI caso o aceite exija validação visual além da API.

Antes do smoke test, nada tinha sido rodado em runtime; agora os endpoints críticos foram exercidos
com emuladores e IA real. A UI ainda precisa de validação visual manual.

**Passos:**
1. Subir emuladores (Firestore + Storage + Auth) e o app Next; definir `OPENAI_API_KEY`
   (sem ela cai no fallback por nome de arquivo) e conferir `OPENAI_DOCUMENT_MODEL`
   (default hardcoded `gpt-5.6-terra` em `src/lib/hr/employee-document-ai.ts` — **validar se o
   modelo existe**).
2. Com um usuário `dp.collaborators.edit`, em `/dashboard/dp/collaborators/{userId}/documents`:
   - Anexar 3–4 arquivos, incluindo um de **outro colaborador** (CPF divergente) e um **repetido**.
   - Conferir a prévia (tipo, match, trilha, nome, situação).
   - **Arquivar prontos** → só os `ready` viram documento; os demais ficam no lote.
   - Abrir/baixar um arquivado (URL assinada).
   - Reenviar o **mesmo arquivo** → `EXACT_DUPLICATE` (não duplica).
   - Enviar 2ª versão lógica (mesmo contracheque/competência, arquivo diferente) → `v02`.
   - **Corrigir tipo** de um item em revisão → recalcula destino e pode virar `ready`.
   - **Trocar colaborador** de um item (com justificativa) → re-verifica match; `confirm` arquiva
     sob o colaborador correto.
   - **Reanalisar** um item → reprocessa a partir do temporário.
   - Fechar e reabrir a tela → **lote pendente aparece para retomar** (`GET /batches`).
3. **Enforcement de acesso:** com um usuário só `dp.collaborators.view`, tentar abrir um
   contracheque (`HR_FINANCE`) e um ASO/atestado (`OCCUPATIONAL_HEALTH`) → **403** + evento
   `ACCESS_DENIED` na subcoleção `audit`.
4. **Storage:** binário em `hr/pending-document-batches/...` durante a análise; após o `confirm`
   migra para `hr/employee-documents/{id}/documents/{docId}/versions/{n}/original.ext` e o
   temporário some.

**Aceite:** todos os cenários passam; nenhum caminho físico tem nome/CPF; sigiloso negado a
quem não tem clearance; duplicata bloqueada; versão numerada certo; correções recalculam.

---

### P0.2 — Verificar/ajustar o gate de "ready" (achado do `missingCriticalFields`) · P · risco MÉDIO
**Status local:** ajuste aplicado. Campo obrigatório presente sem confiança explícita não bloqueia
mais o `ready`; confiança baixa ou inválida continua gerando confirmação. O aceite funcional
continua dependendo do P0.1 com emuladores.

`missingCriticalFields` (`src/lib/hr/employee-document-catalog.ts`) trata **confiança ausente
como 0**: `(fieldConfidences[key] ?? 0) < confirmationThreshold`. Se a IA **não** devolver
`fieldConfidences` para um campo obrigatório **que está presente**, ele conta como faltante e o
item vira `CONFIRMATION_REQUIRED` — ou seja, **nunca fica `ready`** e nada arquiva automaticamente.

**O que fazer:**
1. No P0.1, confirmar que documentos válidos (ex.: contracheque com `referenceMonth`) chegam a
   `ready`. Se **tudo** cair em revisão, é este o motivo.
2. Garantir que o schema/So da IA popula `fieldConfidences` para os `requiredFields`
   (`src/lib/hr/employee-document-ai.ts`), OU ajustar o default (tratar confiança ausente como
   "aceitável" quando o valor existe). Comportamento atual documentado em
   `tests/unit/hr-documents/catalog.test.ts`.

**Aceite:** documento correto e legível com colaborador confirmado atinge `ready` sem
intervenção; campo realmente ausente/baixa confiança gera confirmação.

---

### P0.3 — Agendar o cron de limpeza · P · risco BAIXO
**Status local:** já existe `onSchedule` diário em `functions/src/index.ts` para remover lotes
expirados e arquivos temporários por prefixo.

`analyze-upload` cria lote + itens + arquivos temporários a cada análise; lotes abandonados
acumulam. O endpoint existe (`POST /api/hr/employee-documents/cleanup`), mas **ninguém o chama**.

**O que fazer:** agendar Cloud Scheduler (ou `onSchedule`) chamando o endpoint 1×/dia com token
de admin. Ele remove lotes com `expiresAt < agora` (TTL 7 dias, `BATCH_TTL_MS` em
`analyze-upload/route.ts`), apaga temporários por prefixo e docs de lote/itens (com auditoria,
via `recursiveDelete`). Idempotente, 50 lotes/rodada.

**Aceite:** lotes vencidos somem (docs + temporários) após a execução agendada.

---

### P0.4 — Revisar os perfis de acesso · P · risco OPERACIONAL
O enforcement passou a valer. Quem via sigiloso precisa da permissão certa, senão recebe 403.

**Mapa política → permissão** (`src/lib/hr/employee-document-access.ts`):
- `HR_FINANCE` (contracheque, recibo/pagamento de férias, rescisório) → `dp.rh.can_view_salary`, admin, ou o **titular**.
- `OCCUPATIONAL_HEALTH` (ASO, atestado) → RH elevado (`dp.rh_role` manager/admin ou `dp.collaborators.edit`); sem titular, sem view básico.
- `HR_RESTRICTED` (identificação, contratos, disciplinar, desligamento) → RH elevado.
- `HR_OPERATIONAL` (endereço, vale-transporte, aviso de férias) → RH básico + titular.

**O que fazer:** ajustar `dp.rh.can_view_salary`, `dp.rh_role`, `dp.collaborators.edit` nos perfis.
**Aceite:** cada papel enxerga o que deve (validado no P0.1).

---

### P0.5 — Estratégia para documentos legados · M–G · risco MÉDIO
Documentos arquivados **antes** desta refatoração têm `storagePath` com o **nome do colaborador**
(PII) e sem `contentHash`/`version`/`logicalKey`/`accessPolicyId`/`documentTypeCode` confiável.
Consequência: PII antigo permanece; ficam fora da dedup; acesso cai no fallback por `accessLevel`.

**Opções:**
- **A (recomendada):** script de migração que recomputa `accessPolicyId`/`documentTypeCode` e
  (opcional) recopia o binário para o path técnico novo e apaga o antigo.
- **B:** manter e **documentar** (legados usam fallback de acesso e ficam fora da dedup).

**Aceite:** decisão registrada; se migrar, nenhum `storagePath` legado com PII permanece.

---

### P0.6 — Confirmar rules e índices · P · risco MÉDIO
**Status local:** confirmado por inspeção estática. As novas coleções não têm `match` direto nas
rules do RH DB, o Storage cai no `deny-all`, e as queries novas são de campo único.

Novas coleções (RH DB): `documentUploadBatches`, `documentUploadItems`, `documentVersionCounters`.

**O que checar:**
1. **Firestore rules** (`firestore.rh.rules`): as novas coleções **não têm match** → sem `allow`
   coringa, acesso direto do cliente é negado por padrão (tudo via API admin). Confirmar que
   segue assim.
2. **Índices:** as queries são de campo único (`where employeeId ==`, `where batchId ==`,
   `where expiresAt <`) → auto-indexadas. Sem índice composto necessário (a ordenação por
   `createdAt` no `batches` é feita em memória). Confirmar que nenhuma query quebra.
3. **Storage rules** (`storage.rules`): `hr/pending-document-batches/**` e `hr/employee-documents/**`
   caem no catch-all `allow read, write: if false` → só admin/URL assinada. Confirmar.

**Aceite:** nenhuma query falha por índice; nenhuma coleção nova é lida/gravada direto pelo cliente.

---

## P1 — Funcionalidades ainda abertas (não bloqueiam o fluxo básico)

### P1.1 — Processamento assíncrono real (Cloud Tasks/Pub-Sub) · GG (infra)
Hoje a análise roda **síncrona** no `analyze-upload` (o navegador espera). O desenho já é
idempotente e por-item (queue-ready), mas não há fila.
**O que fazer:** enfileirar 1 tarefa por item (`{batchId, itemId}`); worker
`POST /process-item` que baixa o temp, roda IA e atualiza o item (idempotente por status);
retry/backoff/dead-letter; a tela passa a fazer polling do lote.
**Dependência:** provisionar fila + service account + OIDC no GCP.

### P1.2 — Schema discriminado por tipo da IA · G
Confiança por campo já existe. Falta a **union discriminada por `documentTypeCode`**
(`src/lib/hr/employee-document-ai.ts`) para extração dirigida por tipo, com `requiredFields`
consistentes por documento.

### P1.3 — Testes de integração/E2E com emuladores · G
Os 125 testes são unitários de lógica pura. Falta suíte de integração cobrindo: documento
correto; de outro colaborador (bloqueia); lote com tipos/colaboradores diferentes; duplicata;
nova versão; tipo/colaborador desconhecido; ilegível; múltiplos documentos; arquivamento
parcial; duas confirmações simultâneas; acesso entre perfis; cliente tentando forçar
pasta/acesso/employeeId; falha Storage↔Firestore; retomada de lote.

---

## P2 — Robustez e limpeza

- **Remover código morto** (`P`): o `POST` de **manifesto** em
  `src/app/api/hr/employee-documents/route.ts` ficou órfão (a UI arquiva por `/confirm`).
  Avaliar remover o `POST` (manter GET/PATCH/DELETE) ou reduzir ao single-file.
- **Histórico de versões em subcoleção** (`M`): hoje `version` fica no doc e o binário em
  `versions/{n}/`; a numeração já é transacional. Falta `employeeDocuments/{id}/versions/{vId}`
  com `CURRENT/SUPERSEDED`, `supersedesVersionId`, `replacementReason`, `currentVersionId`.
- **Catálogo no Firestore** (`G`): ainda coexiste a lista de strings livres legada
  (`EMPLOYEE_DOCUMENT_TYPES_BY_CATEGORY`) — não decide destino, mas existe. Migrar o catálogo
  codificado para Firestore versionado (`configVersion`) e remover o legado.
- **Central multi-colaborador** (`G`): o modelo de lote já suporta `entryPoint: GENERAL_INBOX`
  e itens de colaboradores diferentes; falta a **tela** de importação central em
  `/dashboard/dp/documents` (hoje é só um índice).
- **Custo de Storage temp→definitivo** (`P`): o `confirm` copia e apaga o temp (dobra IO na
  janela). Avaliar `move`/rename quando possível.

---

## Anexo — endpoints e arquivos

**Endpoints** (`src/app/api/hr/employee-documents/`):
- `analyze-upload/route.ts` — cria lote+itens, sobe ao temporário, analisa (IA + regras).
- `confirm/route.ts` — arquiva itens `ready` (server-autoritativo, versão transacional, idempotente).
- `item/route.ts` — `PATCH`: corrige tipo e/ou colaborador (re-verifica match, exige justificativa).
- `reanalyze/route.ts` — `POST`: reanalisa um item a partir do temporário.
- `batches/route.ts` — `GET`: lotes retomáveis do colaborador.
- `cleanup/route.ts` — `POST`: remove lotes/temporários expirados (admin/cron).
- `access/route.ts` — URL assinada com enforcement de política + auditoria.
- `route.ts` — GET (lista com política), POST (manifesto legado — ver P2), PATCH (status), DELETE.
- `summary/route.ts` — resumo por colaborador.

**Domínio** (`src/lib/hr/`): `employee-document-catalog.ts`, `-access.ts`, `-match.ts`,
`-distribution.ts`, `-decision.ts`, `-batch.ts`, `-identity.ts`, `-planning.ts`, `-ai.ts`.

**Testes:** `tests/unit/hr-documents/` — match, access-policy, planning, distribution, decision,
batch, catalog.

---

## Checklist final "pronto para produção"

- [ ] P0.1 Fluxo validado com emuladores (anexar → analisar → corrigir → arquivar → baixar → excluir).
- [ ] P0.1 Enforcement de acesso valida (403 + `ACCESS_DENIED` para sigiloso sem clearance).
- [ ] P0.1 Duplicata exata bloqueia; 2ª versão numera certo; correções recalculam.
- [ ] P0.1 `OPENAI_API_KEY`/`OPENAI_DOCUMENT_MODEL` válidos.
- [ ] P0.2 Documento correto chega a `ready` (gate do `missingCriticalFields` OK).
- [ ] P0.3 Cron do `cleanup` agendado.
- [ ] P0.4 Perfis de acesso revisados.
- [ ] P0.5 Estratégia de legados decidida.
- [ ] P0.6 Rules/índices confirmados.
