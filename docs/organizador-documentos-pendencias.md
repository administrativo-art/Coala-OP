# Organizador Inteligente de Documentos de RH — Pendências para finalizar

> Documento de handoff. Lista **tudo o que falta** para o módulo ser considerado
> concluído e liberado para produção, com passos, arquivos, critério de aceite,
> esforço e risco por item. Complementa `docs/plano-correcao-organizador-documentos.md`
> (histórico do que já foi feito).
>
> **Estado atual (resumo):** o backend está funcionalmente completo — segurança
> (política de acesso, match determinístico, PII fora do path), distribuição
> determinística, catálogo único, subpastas virtuais, hash/duplicidade/versão
> transacional, motor de regras, lote/itens persistentes, storage temporário,
> arquivamento parcial idempotente, correção de tipo e colaborador, auditoria com
> `traceId`, limpeza de expirados. **`tsc` = 0 erros; `npm run test:unit` = 120/120.**
> O que falta é **infra, um pouco de UI e verificação em runtime** — nada exige
> nova lógica de negócio central.

## Legenda

- **P0** — bloqueia produção. Fazer antes de liberar.
- **P1** — funcionalidade do plano ainda aberta. Importante, não bloqueia o fluxo básico.
- **P2** — robustez, limpeza e evolução.
- Esforço: **P** (≤2h) · **M** (meio dia) · **G** (1–2 dias) · **GG** (>2 dias / depende de infra).

---

## P0 — Obrigatório antes de produção

### P0.1 — Verificar o fluxo ponta a ponta com os emuladores
**Por quê:** toda a fiação Firestore/Storage foi validada só por typecheck e testes de
lógica pura. Nenhum caminho foi exercido em runtime. Este é o maior risco aberto.
**Esforço:** M · **Risco:** alto se pulado.

**Passos:**
1. Subir os emuladores do Firebase (Firestore + Storage + Auth) e o app Next.
2. Percorrer, com um usuário com `dp.collaborators.edit`:
   - Abrir `/dashboard/dp/collaborators/{userId}/documents`.
   - Anexar 3–4 arquivos (PDF/JPG), incluindo um de **outro** colaborador (CPF divergente) e um **repetido**.
   - Conferir a prévia: tipo, match, trilha, nome, situação (ready/review/blocked).
   - Clicar **Arquivar prontos** → confirmar que só os `ready` foram arquivados.
   - Abrir um documento arquivado (URL assinada) e baixar.
   - Repetir o **mesmo arquivo** → esperar `EXACT_DUPLICATE` (não cria novo).
   - Enviar 2ª versão lógica (ex.: contracheque mesma competência, arquivo diferente) → esperar `v02`.
3. Testar **enforcement de acesso**: com um usuário só `dp.collaborators.view`, tentar
   abrir um contracheque (`HR_FINANCE`) e um ASO (`OCCUPATIONAL_HEALTH`) → esperar **403**
   e evento `ACCESS_DENIED` na subcoleção `audit`.
4. Conferir no Storage: o binário fica em `hr/pending-document-batches/...` durante a
   análise e migra para `hr/employee-documents/{id}/documents/{docId}/versions/{n}/original.ext`
   após o confirm; o temporário some.

**Critério de aceite:** todos os cenários acima passam; nenhum caminho físico contém
nome/CPF; documentos sigilosos negados a quem não tem clearance; duplicata exata bloqueada;
2ª versão numerada corretamente.

**Variáveis de ambiente necessárias:** `OPENAI_API_KEY` (senão cai no fallback por nome de
arquivo) e, opcionalmente, `OPENAI_DOCUMENT_MODEL` (default hardcoded `gpt-5.6-terra` em
`src/lib/hr/employee-document-ai.ts:334` — **confirmar se esse modelo é válido**).

---

### P0.2 — Agendar o cron de limpeza de lotes expirados
**Por quê:** o `analyze-upload` cria lote + itens + arquivos temporários a cada análise.
Lotes abandonados (usuário não confirma) acumulam lixo. O endpoint de limpeza existe, mas
**ninguém o chama**.
**Esforço:** P · **Risco:** baixo (só custo/lixo se ignorado).

**Passos:**
1. Endpoint pronto: `POST /api/hr/employee-documents/cleanup` (arquivo
   `src/app/api/hr/employee-documents/cleanup/route.ts`). Remove lotes com `expiresAt < agora`
   (TTL padrão 7 dias, definido em `analyze-upload/route.ts` → `BATCH_TTL_MS`), apaga os
   binários temporários por prefixo e os docs de lote/itens. Restrito a admin.
2. Agendar um **Cloud Scheduler** (ou cron equivalente) chamando esse endpoint 1×/dia com
   um token de admin, ou converter para uma **Cloud Function agendada** (`onSchedule`).

**Critério de aceite:** lotes com `expiresAt` vencido somem (docs + temporários) após a
execução; a execução é idempotente e limitada (50 lotes/rodada).

---

### P0.3 — Revisar os perfis de acesso (impacto do novo enforcement)
**Por quê:** antes, qualquer `dp.view` baixava qualquer documento. Agora a política é
aplicada. Quem legitimamente via documentos sigilosos precisa ter a permissão certa, senão
passa a receber 403.
**Esforço:** P · **Risco:** operacional (gente perde acesso sem aviso).

**Mapa de política → permissão (fonte: `src/lib/hr/employee-document-access.ts`):**
- `HR_FINANCE` (contracheque, recibo/pagamento de férias, rescisório) → `dp.rh.can_view_salary`, admin, ou o **próprio titular**.
- `OCCUPATIONAL_HEALTH` (ASO, atestado) → RH elevado (`dp.rh_role` manager/admin ou `dp.collaborators.edit`); **sem titular, sem view básico**.
- `HR_RESTRICTED` (identificação, contratos, disciplinar, desligamento) → RH elevado.
- `HR_OPERATIONAL` (comprovante de endereço, vale-transporte, aviso de férias) → RH básico (`dp.collaborators.view`) + titular.

**Passos:** revisar os perfis (Configurações → permissões) e ajustar `dp.rh.can_view_salary`,
`dp.rh_role`, `dp.collaborators.edit` para quem precisa.
**Critério de aceite:** cada papel enxerga exatamente o que deve; validado no P0.1.

---

### P0.4 — Definir estratégia para documentos legados
**Por quê:** documentos arquivados **antes** desta refatoração têm:
- `storagePath` com o **nome do colaborador** (PII) — `hr/employee-documents/{id}/{cat}/{typeSlug}/{docId}/{nome}__...`;
- **sem** `contentHash`, `version`, `logicalKey`, `accessPolicyId`, `documentTypeCode` confiável.

Consequências: (a) o PII antigo permanece no Storage; (b) não entram na deduplicação;
(c) o enforcement de acesso cai no **fallback por `accessLevel` legado** (seguro, mas grosseiro).
**Esforço:** M–G (se migrar) · **Risco:** médio (PII + inconsistência de dedup).

**Opções:**
- **A (recomendada):** script de migração que, para cada doc legado, recomputa
  `accessPolicyId`/`documentTypeCode` a partir do que existir, e (opcional) recopia o binário
  para o novo path técnico e apaga o antigo. Requer backfill cuidadoso.
- **B:** deixar como está e **documentar** que legados usam fallback de acesso e ficam fora da
  dedup. Aceitável se o volume for pequeno.

**Critério de aceite:** decisão registrada; se migrar, nenhum `storagePath` legado com PII
permanece e todos os docs têm `accessPolicyId`.

---

### P0.5 — Confirmar regras e índices do Firestore para as novas coleções
**Por quê:** foram criadas `documentUploadBatches`, `documentUploadItems`,
`documentVersionCounters` (RH DB) e novos campos em `employeeDocuments`.
**Esforço:** P · **Risco:** médio (query falha / acesso indevido).

**Passos:**
1. **Rules** (`firestore.rh.rules`): as novas coleções **não têm match** → como não há `allow`
   coringa, o acesso direto do cliente é **negado por padrão** (todo acesso é via API admin).
   ✅ Confirmar que continua assim (nenhuma regra permissiva coringa foi adicionada).
2. **Índices:** as queries usadas são de campo único:
   - `documentUploadItems where batchId ==` ;
   - `documentUploadBatches where expiresAt <` ;
   - `employeeDocuments where employeeId ==`.
   Campo único é auto-indexado pelo Firestore — **sem índice composto necessário**. Confirmar
   que não há `orderBy` combinado que exija índice (hoje a ordenação é feita em memória).
3. **Storage rules** (`storage.rules`): `hr/pending-document-batches/**` e `hr/employee-documents/**`
   caem no catch-all `allow read, write: if false` → acesso só por URL assinada / admin. ✅ Confirmar.

**Critério de aceite:** nenhuma query quebra por índice ausente; nenhuma coleção nova é
legível/gravável direto pelo cliente.

---

## P1 — Funcionalidades do plano ainda abertas

### P1.1 — Processamento assíncrono real (Fase 11: Cloud Tasks / Pub-Sub)
**Estado:** hoje a análise roda **síncrona** dentro do `analyze-upload` (o navegador espera).
O desenho já é **idempotente e por-item** (queue-ready), mas não há fila.
**Esforço:** GG (depende de infra GCP) · **Risco:** médio.

**Passos:**
1. Ao criar o lote, gravar os itens com `status: "analyzing"` e **enfileirar uma tarefa por item**
   (Cloud Tasks HTTP target ou Pub-Sub) carregando só `{ batchId, itemId }`.
2. Criar um **worker** `POST /api/hr/employee-documents/process-item` que: baixa o temp, roda IA,
   computa match/destino/decisão, atualiza o item, recalcula contadores do lote. Idempotente via
   guarda de status (`analyzing → ready/review/...` só uma vez) e chave
   `organizationId+itemId+analysisVersion`.
3. Configurar retry/backoff/limite de tentativas e um estado `failed` (dead-letter lógico).
4. A tela passa a **fazer polling** do lote/itens (ou realtime) em vez de esperar a resposta.

**Critério de aceite:** fechar o navegador não interrompe a análise; tarefa repetida não
duplica análise nem versão; falha transitória é reprocessada; falha permanente fica visível.
**Dependência:** provisionar fila + service account + OIDC no GCP.

---

### P1.2 — UI de correção completa (Fase 9)
**Estado:** o **backend** já corrige **tipo** e **colaborador** (`PATCH /api/hr/employee-documents/item`,
com re-verificação de match, justificativa e auditoria `ITEM_EMPLOYEE_CHANGED`). A **UI** só
expõe a troca de **tipo** (seletor no card de análise).
**Esforço:** M · **Risco:** baixo.

**Falta na UI (`src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx`):**
1. **Trocar colaborador:** um seletor/busca de colaborador nos itens em revisão/bloqueados que
   chame `PATCH /item` com `{ itemId, employeeId, reason }` e atualize o card. (A lista de usuários
   já está disponível via `useAuth().users`.)
2. **Reanalisar item:** botão que reprocessa um item (re-roda IA no arquivo do temporário).
   Requer um endpoint de reanálise por item (hoje só há análise no lote inteiro).
3. Mostrar `employeeMatchReason`, `decisionReason` e alertas de forma mais explícita.
4. (Opcional) **Retomar lotes pendentes:** tela que lista `documentUploadBatches` em
   `AWAITING_REVIEW`/`PARTIALLY_FILED` do colaborador para continuar depois (o dado já é
   persistido; falta só a UI).

**Critério de aceite:** nenhum item em revisão fica em beco sem saída; trocar tipo/colaborador
na tela recalcula o destino e persiste; reanálise funciona.

---

### P1.3 — Confiança por campo e schema discriminado da IA (Fases 2/10)
**Estado:** a IA retorna `extractedFields` como objeto plano (validado por JSON Schema estrito),
**sem confiança por campo** e **sem union discriminada por tipo**. O plano pedia `{ value,
confidence, page, status }` por campo e schema específico por tipo.
**Esforço:** G · **Risco:** baixo (melhora qualidade/observabilidade).

**Passos (`src/lib/hr/employee-document-ai.ts`):**
1. Evoluir o `EMPLOYEE_DOCUMENT_ANALYSIS_SCHEMA` para incluir confiança por campo (ou uma
   `fieldConfidences: Record<string, number>`), mantendo o `strict: true`.
2. (Opcional) schemas específicos por tipo (union discriminada) para extração dirigida.
3. Persistir `fieldConfidences` no item/documento; usar `missingCriticalFields` no motor de
   decisão (hoje passa `[]`), lendo `requiredFields` do catálogo enriquecido.
4. Versionar `promptVersion`/`schemaVersion` e gravá-los no item.

**Critério de aceite:** campos críticos ausentes/baixa confiança geram `CONFIRMATION_REQUIRED`
de forma automática; a confiança por campo aparece na prévia.

---

### P1.4 — Observabilidade: tokens e custo (Fase 12)
**Estado:** já há `traceId` (lote→item→documento) e `analysisDurationMs`. Falta capturar
**tokens/custo** da OpenAI.
**Esforço:** P–M · **Risco:** baixo.

**Passos:** em `createOpenAiResponse` (`employee-document-ai.ts`), ler `usage` da resposta e
propagar `inputTokens`/`outputTokens`; estimar custo por modelo; gravar no item e no evento
`ITEM_ANALYZED`.
**Critério de aceite:** cada análise registra tokens e custo estimado.

---

### P1.5 — Testes de integração / E2E (Fase 13)
**Estado:** 72 testes unitários de lógica pura. Faltam integração com emuladores.
**Esforço:** G · **Risco:** médio (sem rede de segurança de fluxo).

**Cenários mínimos (emulador):** documento correto; documento de outro colaborador (bloqueia);
lote com tipos e colaboradores diferentes; duplicata exata; nova versão; tipo desconhecido;
ilegível; múltiplos documentos; arquivamento parcial; duas confirmações simultâneas; acesso
entre perfis; cliente tentando forçar pasta/acesso/employeeId; falha entre Storage e Firestore;
retomada de lote.
**Critério de aceite:** suíte de integração roda no CI com emuladores e cobre os 15+ cenários.

---

## P2 — Robustez, limpeza e evolução

### P2.1 — Remover código morto do fluxo antigo de arquivamento
**Arquivo:** `src/app/api/hr/employee-documents/route.ts`. O `POST` ainda tem o caminho de
**manifesto** e de **arquivo único** (server-autoritativo), mas o frontend agora arquiva via
`/confirm`. O caminho de manifesto ficou **órfão**. Avaliar remover o `POST` (manter GET/PATCH/DELETE)
ou reduzi-lo ao single-file. **Esforço:** P · **Risco:** baixo (confirmar que nada mais chama).

### P2.2 — Histórico de versões em subcoleção própria
Hoje `version`/`versionResolution` ficam no doc e o binário em `versions/{n}/`. Falta uma
subcoleção `employeeDocuments/{id}/versions/{versionId}` com `CURRENT/SUPERSEDED`, `supersedesVersionId`,
`replacementReason`, e o ponteiro `currentVersionId` no doc. A **numeração já é transacional**
(`documentVersionCounters`). **Esforço:** M.

### P2.3 — Consolidar o catálogo em fonte única de verdade (Fase 4 avançada)
Ainda coexistem `EMPLOYEE_DOCUMENT_TYPES_BY_CATEGORY` (strings livres, legado) e o catálogo
codificado enriquecido (`employee-document-catalog.ts`). O legado **não decide destino**, mas
ainda existe. Avaliar migrar o catálogo para **Firestore versionado** (`configVersion`) e
remover a lista de strings livres. **Esforço:** G.

### P2.4 — Custo dobrado de Storage no fluxo temp→definitivo
`analyze-upload` sobe ao temporário; `confirm` **copia** para o definitivo e apaga o temp. É
correto, mas dobra IO/armazenamento durante a janela. Aceitável; monitorar. Alternativa: mover
(rename) em vez de copiar quando bucket/rota permitir. **Esforço:** P.

### P2.5 — Central geral de importação multi-colaborador (Fase 4B do plano original)
Hoje o upload é sempre **dentro do perfil** de um colaborador (`entryPoint: EMPLOYEE_PROFILE`).
O modelo de lote já suporta `entryPoint: GENERAL_INBOX` e itens com colaboradores diferentes
(o `confirm` arquiva por colaborador do item). Falta a **tela** de importação central em
`/dashboard/dp/documents` (hoje é só um índice). **Esforço:** G.

### P2.6 — Endurecer o anti-tamper residual do match
O `confirm` já reverifica o match no servidor **lendo o item persistido** (não o cliente) — o
anti-tamper do fluxo normal está fechado. O resíduo teórico é o CPF *extraído* ter sido gravado
a partir da IA no `analyze` (que roda no servidor, ok). Não há ação obrigatória; documentar que
a fonte do CPF é a IA server-side, não o cliente. **Esforço:** P (só doc).

---

## Checklist final "pronto para produção"

- [ ] P0.1 Fluxo validado com emuladores (anexar → analisar → confirmar → baixar → excluir).
- [ ] P0.1 Enforcement de acesso validado (403 + `ACCESS_DENIED` para sigiloso sem clearance).
- [ ] P0.1 Duplicata exata bloqueia; 2ª versão numera correto.
- [ ] P0.1 `OPENAI_API_KEY` e `OPENAI_DOCUMENT_MODEL` válidos em produção.
- [ ] P0.2 Cron do `cleanup` agendado.
- [ ] P0.3 Perfis de acesso revisados.
- [ ] P0.4 Estratégia de legados decidida (migrar ou documentar).
- [ ] P0.5 Rules/índices confirmados (novas coleções negadas ao cliente; sem índice faltando).
- [ ] P1.2 UI: pelo menos trocar colaborador exposto na tela (backend pronto).
- [ ] P1.5 Suíte de integração mínima no CI.

Quando os itens **P0** estiverem marcados, o módulo pode ir a produção com o fluxo principal
seguro. Os demais (P1/P2) são evolução incremental.

---

## Anexo — endpoints e arquivos-chave

**Endpoints** (`src/app/api/hr/employee-documents/`):
- `analyze-upload/route.ts` — cria lote+itens, sobe ao temporário, analisa (IA + regras).
- `confirm/route.ts` — arquiva itens `ready` (server-autoritativo, versão transacional, idempotente).
- `item/route.ts` — `PATCH`: corrige tipo e/ou colaborador (re-verifica match).
- `cleanup/route.ts` — remove lotes/temporários expirados (admin/cron).
- `access/route.ts` — URL assinada com enforcement de política + auditoria.
- `route.ts` — GET (lista com política), POST (arquivamento legado — ver P2.1), PATCH (status), DELETE.
- `summary/route.ts` — resumo por colaborador.

**Domínio** (`src/lib/hr/`):
- `employee-document-catalog.ts` — catálogo enriquecido (fonte única de regras).
- `employee-document-access.ts` — políticas e enforcement.
- `employee-document-match.ts` — match determinístico (CPF/matrícula/nome).
- `employee-document-distribution.ts` — processo, destino, nomenclatura, duplicidade/versão.
- `employee-document-decision.ts` — motor de regras.
- `employee-document-batch.ts` — máquina de estados do lote.
- `employee-document-identity.ts` — identidade RH, `employeeCode`, hash.
- `employee-document-planning.ts` — path técnico (sem PII), extensão.
- `employee-document-ai.ts` — chamada OpenAI + schema estrito + fallback.

**Testes:** `tests/unit/hr-documents/` (match, access-policy, planning, distribution, decision, batch).
