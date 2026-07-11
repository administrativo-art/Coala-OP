# Auditoria — Organizador Inteligente de Documentos de RH

> Auditoria somente-leitura. Nenhum arquivo do módulo foi alterado.
> Evidências citadas como `arquivo:linha`. Data de referência: 2026-07-10.

---

## 1. Resumo executivo

**Conclusão geral: o módulo NÃO está pronto para produção.** O que existe é um **MVP de arquivamento de documentos por colaborador assistido por IA**, funcional no *caminho feliz de um contexto único*, mas que diverge estruturalmente do requisito "Organizador Inteligente" em pontos centrais: não há modelo de lote/itens, não há área temporária, não há verificação determinística de colaborador, não há versionamento nem detecção de duplicidade, e a política de acesso é armazenada mas **não é aplicada no backend**.

### Conclusão estimada por área

| Área | % | Observação |
|---|---|---|
| Tela de upload (contexto perfil) | ~75% | Multi-arquivo, drag&drop, análise → prévia → arquivar. Sem correção/reanálise. |
| Central geral (lote multi-colaborador) | ~10% | Só existe um **índice** de colaboradores; não importa lote misto. |
| Modelo de Lote/Item (`DocumentUploadBatch/Item`) | **0%** | Inexistente. |
| Storage temporário | **0%** | Grava direto no destino definitivo. |
| Validação técnica (hash/dup/páginas) | ~30% | Só MIME/tamanho/vazio. Sem hash, sem dedup. |
| Catálogo documental | ~40% | Existe, mas em duas fontes dessincronizáveis, sem templates/thresholds/versão. |
| Prompt IA | ~60% | Boas regras, mas sem versionamento, sem guarda de injeção, sem confiança por campo. |
| Schema de saída | ~55% | `json_schema` estrito, mas `extractedFields` recastado solto e **descartado no arquivamento**. |
| Match determinístico do colaborador | **~5%** | Feito **só pela IA**; backend não confere CPF/matrícula. |
| Distribuição determinística | ~35% | Pasta/nome vêm de `buildEmployeeDocumentPlan`, mas categoria/acesso vêm da IA via cliente. |
| Processos/subpastas | **0%** | Subpasta = slug do tipo; sem entidades de processo. |
| Nomenclatura | ~40% | Sem versão, **com nome do colaborador no caminho**, sem matrícula/competência. |
| Políticas de acesso | ~20% | Nível gravado mas **não aplicado**; conjunto divergente. |
| Duplicidade e versionamento | **0%** | Ausente por completo. |
| Motor de regras | ~40% | `decideStatus` existe, mas parte das decisões vem da IA e não é reaplicado no arquivamento. |
| Tela de resultados | ~45% | Prévia rica, mas sem ações de correção/reanálise/trocar colaborador. |
| Arquivamento parcial | ~30% | Arquiva só "prontos"; pendentes são **descartados** (sem lote persistente). |
| Arquivamento definitivo | ~55% | Grava Storage+Firestore+audit; sem transação/reconciliação/temp→final. |
| Filas/retry/idempotência | **0%** | Totalmente síncrono. |
| Segurança/privacidade | ~45% | Storage protegido e signed URL; mas acesso não respeita `accessLevel`. |
| Trilha de auditoria | ~35% | Poucos eventos; sem traceId nem eventos de ciclo. |
| Testes | **0%** | Nenhum teste do módulo. |

**Riscos críticos (detalhados na Seção 4):** documento arquivado no colaborador errado sem barreira determinística; exposição de documentos confidenciais/médicos a qualquer usuário com `dp.view`; nome completo do colaborador no caminho físico do Storage; perda dos campos extraídos pela IA (descartados no arquivamento).

---

## 2. Arquitetura encontrada

**Stack real diverge do esperado:** IA via **OpenAI Responses API** (não Genkit); banco RH via **Firebase Admin** (não Rules); processamento **síncrono** (sem fila).

**Frontend (App Router, client components):**
- `src/app/dashboard/dp/documents/page.tsx` — índice de colaboradores com resumos (`GET /summary`). Navega para a pasta individual. **Não é** central de importação de lote misto.
- `src/app/dashboard/dp/collaborators/[userId]/documents/page.tsx` — upload por colaborador: seleciona → `POST /analyze-upload` → prévia → `POST /` (manifesto) → lista/visualiza/exclui.
- Reachable via `src/components/sidebar.tsx:170` ("Documentos", gate `dp.collaborators.view || settings.manageUsers`).

**Backend (`src/app/api/hr/employee-documents/`):**
- `analyze-upload/route.ts` — análise **stateless** da IA. `multipart` → fluxo novo (`analyzeFreeBatch`); `application/json` → fluxo legado por grupos manuais (`analyzeLegacyGroupedBatch`, **morto**).
- `route.ts` — `GET` lista por `employeeId`; `POST` arquiva (manifesto ou single) via `saveEmployeeDocument` (linha 54); `PATCH` muda status; `DELETE` soft-delete + remove do Storage.
- `access/route.ts` — signed URL (5 min) + audit de view/download.
- `summary/route.ts` — agrega contagens varrendo a coleção inteira.

**Camada de domínio (`src/lib/hr/`):**
- `employee-document-ai.ts` — chamada OpenAI, `json_schema` estrito, fallback por nome de arquivo.
- `employee-document-options.ts` — catálogo (14 categorias + 24 tipos codificados + tipos livres por categoria).
- `employee-document-planning.ts` — `buildEmployeeDocumentPlan` (pasta/nome/trilha determinísticos).

**Banco:** coleção única `employeeDocuments` (RH DB, `hrDbAdmin`) + subcoleção `audit`. Sem `organizationId` (app single-tenant).

**Storage:** destino definitivo direto `hr/employee-documents/{employeeId}/{category}/{typeSlug}/{documentId}/{fileName}` (`planning.ts:70-77`). Sem área temporária. Protegido por `storage.rules:40` (deny-all).

---

## 3. Matriz de conformidade

| ID | Requisito | Status | Evidência | Impacto | Ação necessária |
|---|---|---|---|---|---|
| E5 | Modelo `DocumentUploadBatch`/`DocumentUploadItem` | **NÃO IMPLEMENTADO** | grep sem resultado; `route.ts:27` coleção única `employeeDocuments` | Sem rastreio de lote, contadores, estados | Criar coleções batch/item |
| E4B | Central geral (lote de vários colaboradores) | **NÃO IMPLEMENTADO** | `dp/documents/page.tsx` é índice; upload sempre `form.set("employeeId", userId)` (`[userId]/documents/page.tsx:217`) | Não atende multi-colaborador | Construir importador central |
| E6 | Storage temporário antes de confirmar | **NÃO IMPLEMENTADO** | `route.ts:92` grava direto em `plan.storagePath` | Sem estágio de revisão físico; risco de órfãos | Introduzir área `pending-*` |
| E12 | Match determinístico do colaborador (CPF/matrícula) no backend | **DIVERGENTE/DEFEITUOSO** | `analyze-upload/route.ts:111` usa `ai.employeeMatchStatus`; `saveEmployeeDocument` não confere CPF | **Documento no colaborador errado** | Match determinístico por CPF/matrícula |
| E13 | Distribuição determinística (pasta/processo/nome/acesso) | **PARCIAL** | `planning.ts` determina pasta/nome; mas categoria/acesso vêm da IA via cliente (`[userId]/documents/page.tsx:241-247`) | IA influencia destino real | Backend recalcular a partir do código do tipo |
| E14 | Processos e subpastas por metadados | **NÃO IMPLEMENTADO** | subpasta = `typeSlug` (`planning.ts:70`); sem entidade de processo | Sem agrupamento por processo (férias/admissão) | Modelar processos |
| E15 | Nomenclatura (versão, sem nome no caminho) | **PARCIAL/DEFEITUOSO** | `planning.ts:64,69,77` usa `employeeName` no path e filename; sem `vNN` | Vazamento de PII no path; sem versão | Usar matrícula; remover nome do path; versionar |
| E16 | Política de acesso aplicada no backend | **DEFEITUOSO** | `access/route.ts:12` só `assertHrAccess("view")`; ignora `accessLevel` | **Exposição de confidencial/médico** | Enforcement por `accessLevel` + papel |
| E7/E17a | Hash e duplicidade exata | **NÃO IMPLEMENTADO** | nenhum `createHash` no módulo | Reprocessa/duplica; custo de IA | Calcular hash e bloquear duplicata |
| E17b/c | Duplicidade lógica e versionamento | **NÃO IMPLEMENTADO** | `saveEmployeeDocument` faz `doc(id).set`; sem versão | Sobrescrita lógica; sem histórico | Documento lógico + versões |
| E8 | Catálogo fechado completo (templates, thresholds, dup keys, versão) | **SOMENTE ESTRUTURA** | `options.ts:171-371` só tem code/label/category/folderCode/access/aliases/hints | Regras de negócio ausentes | Enriquecer catálogo (Firestore + versão) |
| E9 | Prompt versionado, sem injeção | **PARCIAL** | `employee-document-ai.ts:253-293` sem versão registrada; conteúdo do doc entra sem guarda | Sem rastreio; risco de injeção | Versionar prompt; registrar no item |
| E10 | Schema estrito + confiança por campo | **PARCIAL** | schema `:76-128` sem `fieldConfidence`; `normalizeAiResult:393` recasta `Record<string,unknown>` | Sem confiança por campo; validação fraca | Union discriminada + confiança por campo |
| E11 | Uma análise por item, com custo/tokens | **PARCIAL** | 1 chamada/arquivo (`analyzeFreeBatch:87`); sem log de tokens/custo | Sem observabilidade de custo | Registrar tokens/duração/tentativas |
| E19 | Tela de resultados com ações (corrigir/trocar tipo/colaborador/reanalisar) | **PARCIAL** | prévia em `[userId]/documents/page.tsx:353-424`; sem edição | Item em revisão é beco sem saída | Implementar ações + recálculo |
| E20 | Arquivamento parcial com lote persistente | **PARCIAL** | `uploadBatch:237` filtra "ready"; pendentes descartados (`:256-257`) | Perde pendentes; sem `PARTIALLY_FILED` | Persistir lote + retomar depois |
| E21 | Arquivamento definitivo consistente (transação/reconciliação) | **PARCIAL** | loop `route.ts:143-164` sem transação; falha no meio deixa parcial | Inconsistência Storage/Firestore | Reserva de versão + reconciliação |
| E22 | Fila, retry, idempotência | **NÃO IMPLEMENTADO** | análise síncrona no request | Fechar aba aborta; sem retry | Cloud Tasks/PubSub + idempotência |
| E23a | Storage protegido / signed URL | **IMPLEMENTADO** | `storage.rules:40-42`; `access/route.ts:19` | — | — |
| E23b | Isolamento por organização | **NÃO VERIFICÁVEL/N-A** | sem `organizationId` no módulo (app single-tenant) | — | Confirmar premissa single-tenant |
| E24 | Trilha de auditoria completa | **PARCIAL** | audit só `uploaded/status_*/deleted/viewed/downloaded` (`route.ts:106,199,214`; `access:23`) | Faltam eventos de ciclo, traceId | Ampliar eventos + traceId |
| E25 | Testes | **NÃO IMPLEMENTADO** | nenhum `*.test.ts` do módulo | Sem rede de segurança | Cobrir cenários 1-15 |
| E2 | Taxonomia de 14 pastas | **IMPLEMENTADO** | `options.ts:1-16` (inclui "Pendentes de classificação"; VT como subtipo de Benefícios) | — | — |
| E3 | Upload multi-arquivo sem campos prévios | **IMPLEMENTADO** | `[userId]/documents/page.tsx:494-517` (drag&drop, accept, sem tipo/pasta) | — | — |

---

## 4. Pontos críticos (prioridade máxima)

**C1 — Documento no colaborador errado (sem barreira determinística). [P0]**
O `employeeMatchStatus` vem exclusivamente da IA (`analyze-upload/route.ts:111`) e o arquivamento (`saveEmployeeDocument`, `route.ts:54`) grava sob o `employeeId` do manifesto **sem comparar o CPF extraído com o cadastro**. Um falso `MATCH` do modelo arquiva no perfil errado silenciosamente. Não há verificação de CPF/matrícula no backend em nenhum ponto.

**C2 — Exposição de documentos confidenciais/médicos. [P0]**
`access/route.ts:12` gera signed URL apenas com `assertHrAccess("view")`, que é amplo (`server-access.ts:10-20`: qualquer `dp.view`/`dp.collaborators.view`). O campo `accessLevel` (`confidential` para contracheque/ASO/atestado, `options.ts:250,268,313`) **nunca é consultado**. Qualquer usuário com visão de DP baixa contracheques e atestados médicos.

**C3 — PII no caminho físico do Storage. [P0/P1]**
`planning.ts:64,69,77` insere o slug do **nome completo** do colaborador no `storagePath` e no `fileName`. O requisito E15/E23 proíbe nome completo no caminho. Vaza PII em logs/URLs.

**C4 — Campos extraídos pela IA são descartados no arquivamento. [P1]**
O payload persistido (`route.ts:97-104`) **não grava** `extractedFields`, `confidence`, `employeeMatchStatus`, `warnings` nem modelo. Toda a extração (CPF, competência, datas) é apenas exibida na prévia e perdida. Sem isso, duplicidade lógica, versionamento por competência e agrupamento por processo ficam impossíveis.

**C5 — Sem duplicidade/versionamento → sobrescrita silenciosa. [P1]**
Sem hash e sem versão. Reenvio do mesmo contracheque cria/sobrescreve registros sem histórico. `doc(id).set` (`route.ts:105`) sobrescreve o documento inteiro.

**C6 — Arquivamento em lote sem transação. [P2]**
O loop `route.ts:143-164` grava item a item; uma falha no meio retorna 403 mas deixa itens já persistidos, sem `PARTIALLY_FILED` nem reconciliação.

---

## 5. Funcionalidades implementadas corretamente (com evidência)

- **Taxonomia de 14 pastas** conforme especificado, com "Pendentes de classificação" substituindo "Outros" e vale-transporte como subtipo de Benefícios — `options.ts:1-16,77-89`.
- **Upload multi-arquivo com drag&drop**, accept PDF/DOC/DOCX/JPG/PNG, remoção antes do envio, sem exigir tipo/pasta/acesso — `[userId]/documents/page.tsx:494-537`.
- **Análise por IA com schema estrito** e enum fechado de códigos — `employee-document-ai.ts:90,362-364`.
- **Catálogo fechado no nível do schema** (a IA só pode retornar código do catálogo ou `UNKNOWN_DOCUMENT`) — `employee-document-ai.ts:11,90`.
- **Fallback resiliente** quando falta `OPENAI_API_KEY` — `employee-document-ai.ts:218-251,414`.
- **Storage privado + signed URL de 5 min + auditoria de acesso** — `access/route.ts:19-24`; `storage.rules:40-42`.
- **Soft-delete** com remoção do binário e auditoria — `route.ts:204-216`.
- **Prompt com limitação de dados clínicos** — `employee-document-ai.ts:264`.

---

## 6. Funcionalidades parciais (o que falta)

- **Prévia de resultados** (`[userId]/documents/page.tsx:353-424`): mostra tipo/confiança/trilha/nome/match, mas **sem ações** de confirmar/corrigir/trocar tipo/trocar colaborador/reanalisar. Itens em "revisão"/"bloqueado" não têm saída.
- **Arquivamento parcial** (`uploadBatch:231-265`): arquiva só "ready"; os demais são **descartados** ao limpar o estado — não há lote persistente para retomar.
- **Validação técnica** (`analyze-upload/route.ts:90-92`): só MIME/vazio/tamanho, apenas no backend (ok), mas sem hash, contagem de páginas, PDF protegido, corrupção.
- **Auditoria** (`route.ts:106,199,214`): eventos básicos; faltam `ANALYSIS_STARTED`, `DESTINATION_RESOLVED`, `DOCUMENT_REPLACED`, `ACCESS_DENIED`, `traceId`, tentativa.
- **Distribuição determinística** (`planning.ts`): pasta/nome/trilha são determinísticos, mas a **categoria e o acesso entram pelo manifesto do cliente** (`route.ts:144-146`), então a decisão de destino ainda depende da IA repassada pelo front.

---

## 7. Funcionalidades não implementadas

- Modelo de **Lote/Item** (`DocumentUploadBatch`/`DocumentUploadItem`) e seus contadores/estados.
- **Central geral** de importação com documentos de vários colaboradores.
- **Storage temporário** e limpeza de órfãos.
- **Match determinístico** por CPF/matrícula/nome no backend.
- **Processos e subpastas** (férias/admissão/afastamento/desligamento) por metadados.
- **Duplicidade exata (hash)** e **duplicidade lógica** por chaves.
- **Versionamento** (documento lógico, `v01/v02`, versão atual/substituída).
- **Confiança por campo** e **union discriminada por tipo** no schema.
- **Fila assíncrona**, retry, backoff, idempotência, dead-letter.
- **Enforcement de política de acesso** por tipo/papel.
- **Testes** (unitários, integração, regras, schema, prompt).

---

## 8. Implementações divergentes

- **IA:** usa **OpenAI Responses** (`employee-document-ai.ts:9,335`), não Genkit. Genkit existe mas só para `analyze-consumption`/`analyze-goals` (`src/ai/flows/*`). Modelo default `gpt-5.6-terra` fixo em código com override por env (`:334`).
- **Persistência:** coleção plana `employeeDocuments` em vez de lote/itens.
- **Fluxo:** duas etapas HTTP no cliente (`analyze` → `archive`) em vez de pipeline assíncrono orientado a item.
- **Políticas de acesso:** conjunto `unrestricted/partial/restricted/confidential` (`options.ts:164-169`) em vez de `HR_OPERATIONAL/HR_FINANCE/OCCUPATIONAL_HEALTH/...`.
- **Catálogo duplicado:** `EMPLOYEE_DOCUMENT_TYPES_BY_CATEGORY` (≈90 strings livres, `options.ts:21-155`) **vs** `EMPLOYEE_DOCUMENT_TYPE_CATALOG` (24 códigos, `:181-371`) — duas fontes de verdade mantidas manualmente em sincronia; muitas categorias não têm código correspondente.

---

## 9. Código não conectado ou morto

- **`analyzeLegacyGroupedBatch`** (`analyze-upload/route.ts:153-234`): fluxo antigo com seleção manual de categoria/tipo/acesso por grupo. Acionado só quando o content-type **não** é multipart; o frontend sempre envia multipart (`[userId]/documents/page.tsx:216-221`). **Morto** (grep por `groups:` no cliente sem resultado). Contém a lógica de "seleção manual de tipo" que o novo fluxo deveria substituir.
- **`confidenceForFileName`** (`analyze-upload/route.ts:47-54`): usado apenas pelo fluxo legado morto.
- **Status `pending`/`expired`**: `route.ts` sempre grava `status:"received"`; `pending` nunca é produzido e `expired` é só legado (`route.ts:30`). Contadores de `summary` para esses campos são sempre 0.
- **`buildEmployeeDocumentPlan` no `analyze-upload`**: calcula `storagePath` de destino já na análise (`:98-106`) e devolve ao cliente, mas o path só é usado como preview; o arquivamento recalcula — duplicação inofensiva, mas indica ausência de fonte única.

---

## 10. Resultado dos comandos

- **`npx tsc --noEmit`**: **1 erro**, em código novo da área RH:
  `src/app/api/rh/employee-profile/[employeeId]/route.ts(78,7): error TS2739: Type 'Date' is missing ... from type 'Timestamp'` (atribuição de `new Date()` onde se espera `Timestamp`, ~`route.ts:70-84`). Quebra o build. **É adjacente** ao organizador (rota de perfil), mas está na mesma leva de trabalho não commitada.
- **`next lint`**: não executável de forma não-interativa (projeto em migração para ESLint v9 — `next lint` abre prompt interativo).
- **Testes / emuladores / build**: **nenhum teste do módulo** encontrado; build não roda limpo por causa do erro de TS acima.

*(Observação: nada foi corrigido, conforme instruído.)*

---

## 11. Plano de correção priorizado

### P0 — risco crítico/segurança
1. **Enforcement de acesso por documento.** Objetivo: bloquear leitura de confidencial/médico sem papel adequado. Arquivos: `access/route.ts`, `server-access.ts`. Alteração: derivar política do `accessLevel` do doc + papel do usuário antes de emitir signed URL; auditar `ACCESS_DENIED`. Aceite: usuário `dp.view` sem clearance recebe 403 em contracheque/ASO.
2. **Match determinístico do colaborador.** Objetivo: impedir arquivo no colaborador errado. Arquivos: novo `employee-match.ts`, `route.ts`. Alteração: extrair/persistir CPF e comparar com cadastro; `MISMATCH` bloqueia arquivamento independentemente da IA. Aceite: doc com CPF de outro colaborador nunca arquiva.
3. **Remover PII do caminho físico.** Arquivos: `planning.ts`. Alteração: usar matrícula/ID em vez de nome no `storagePath`/`fileName`. Aceite: nenhum nome completo no path.

### P1 — impede o fluxo principal correto
4. **Persistir metadados da IA + hash + duplicidade.** Arquivos: `route.ts` (payload), novo campo `contentHash`. Aceite: reenvio idêntico detectado; competência/CPF gravados.
5. **Versionamento.** Arquivos: modelo de documento lógico + versões. Aceite: 2º contracheque da mesma competência vira `v02`, preservando `v01`.
6. **Distribuição 100% no backend.** Arquivos: novo `resolveDestination.ts`, `route.ts`. Alteração: backend recalcula categoria/acesso/nome do **código do tipo**, ignorando o manifesto do cliente para esses campos. Aceite: cliente não consegue forçar pasta/acesso.

### P2 — requisito funcional importante
7. **Modelo de lote/itens + arquivamento parcial persistente** (`PARTIALLY_FILED`, retomar depois).
8. **Ações na tela de resultados** (corrigir tipo/colaborador, reanalisar) com recálculo.
9. **Storage temporário** + limpeza de órfãos.
10. **Corrigir erro de TS** em `employee-profile/[employeeId]/route.ts:78`.

### P3 — melhoria/observabilidade
11. Fila assíncrona (Cloud Tasks) + retry/idempotência.
12. Versionar prompt e schema; registrar tokens/custo; confiança por campo.
13. Unificar catálogo em fonte única (Firestore + versão); remover fluxo legado morto.
14. Ampliar auditoria (traceId, eventos de ciclo).
15. Suíte de testes dos 15 cenários.

---

## 12. Checklist final

- [x] Taxonomia de 14 pastas (`options.ts:1-16`)
- [x] Upload multi-arquivo, drag&drop, sem campos prévios (`[userId]/documents/page.tsx:494-537`)
- [x] Análise IA com schema estrito e catálogo fechado (`employee-document-ai.ts:90,362`)
- [x] Storage privado + signed URL (`access/route.ts`; `storage.rules:40`)
- [x] Soft-delete + auditoria básica (`route.ts:204-216`)
- [~] Prévia de resultados (sem ações de correção) (`[userId]/documents/page.tsx:353`)
- [~] Arquivamento parcial (descarta pendentes) (`uploadBatch:256`)
- [~] Distribuição determinística (categoria/acesso via cliente) (`route.ts:144`)
- [~] Validação técnica (só MIME/tamanho) (`analyze-upload/route.ts:90`)
- [~] Prompt IA (sem versão/injeção/confiança por campo) (`employee-document-ai.ts:253`)
- [~] Schema de saída (`extractedFields` recastado e descartado) (`:393`; `route.ts:97`)
- [~] Auditoria (eventos incompletos) (`route.ts:106`)
- [ ] Modelo de Lote/Item
- [ ] Central geral multi-colaborador
- [ ] Storage temporário
- [ ] Processos e subpastas
- [ ] Duplicidade (hash/lógica) e versionamento
- [ ] Fila/retry/idempotência
- [ ] Testes do módulo
- [!] Match do colaborador só pela IA — arquivo no perfil errado (`analyze-upload/route.ts:111`)
- [!] Acesso não respeita `accessLevel` — exposição de confidencial/médico (`access/route.ts:12`)
- [!] Nome completo do colaborador no path físico (`planning.ts:64,77`)
- [!] Erro de TypeScript quebrando o build (`employee-profile/[employeeId]/route.ts:78`)

---

## Respostas diretas

1. **O fluxo principal está completo?** Não. Funciona ponta a ponta em um contexto (perfil), mas sem match determinístico, versionamento, duplicidade e correção.
2. **O upload em lote está completo?** Parcial. Multi-arquivo funciona; não há modelo de lote persistente nem retomada.
3. **A IA está limitada ao papel correto?** Quase — o prompt e o schema restringem bem (não define pasta/nome/caminho), **mas** a IA decide o `employeeMatchStatus`, o que deveria ser determinístico.
4. **A distribuição é realmente determinística?** Não totalmente — o cálculo é determinístico, mas categoria/acesso chegam do cliente (originados da IA).
5. **O sistema impede documento no colaborador errado?** **Não.** Depende do julgamento do modelo; o backend não confere CPF.
6. **O versionamento está seguro?** Não existe.
7. **O arquivamento parcial funciona?** Só arquiva os "prontos"; os pendentes são descartados, sem lote persistente.
8. **As permissões estão protegidas no backend?** Parcialmente — autenticação e escrita sim; **leitura por nível de sigilo não** é aplicada.
9. **O módulo está pronto para produção?** **Não.**
10. **Próxima correção mais importante?** **P0-1 / P0-2:** aplicar política de acesso por documento e implementar o match determinístico por CPF/matrícula — são os dois que causam vazamento de dado sensível e documento no colaborador errado.
