# Plano Mestre Integrado — Coala OP  
**Versão:** 3.2 **Data:** 2026-04-26 **Status:** Baseline aprovada para quebra em epics/issues **Stack:** Next.js 14 · Firebase Firestore (multi-db) · Cloud Functions · TypeScript  
**Mudanças desde v3.1:**  
**Mudanças desde v3.1:**  
1. **Renumeração contínua** — Security Rules vira Etapa 3, todas as etapas seguintes deslocadas. Não há mais 2.5.  
2. **PermissionSet com source of truth explícito** — Plano Técnico de Formulários é canônico para campos granulares; mestre usa agrupadores conceituais.  
3. **Modelo de tarefas sem task_sections** — task_statuses é o mecanismo de fluxo; section_id em tasks significa seção de origem do formulário.  
4. **Idempotência refinada** — captura de already-exists, aborted, failed-precondition; retorno { task_id, created }.  
5. **Feature flags e kill switches** — seção dedicada com flags de ativação progressiva e kill switches por módulo.  
  
## Estrutura Macro  
```
Plano macro Coala OP
  ↓
mantém Log, RH, Login, Organograma e Recrutamento

Plano de Formulários (motor unificado)
  ↓
substitui e expande a antiga Fase 3 — Checklist Operacional

```
  
## Categorização MVP / Pós-MVP  
Critério único do MVP: **o checklist atual deve rodar no novo motor sem regressão e o sistema legado pode ser desligado**. Tudo o mais é Pós-MVP.  
## MVP (obrigatório para desligar o legado)  
* Etapa 1 — Alinhamento e Preparação  
* Etapa 2 — Log de Ações Transversal  
* Etapa 3 — Security Rules e Acesso Server-side  
* Etapa 4 — RH mínimo e PermissionSet expandido  
* Etapa 5 — Fundação do Módulo de Formulários  
* Etapa 6 — Migração do Checklist (com dual-write)  
* Etapa 7 — Execução robusta de Formulários  
* Etapa 13 — Testes, Rollout e Estabilização (parte 1: rollout do MVP)  
## Pós-MVP — prioridade alta  
* Etapa 8 — Tarefas geradas por Formulários  
* Etapa 9 — Analytics e KPIs built-in  
* Etapa 10 — Limitador de Login  
## Pós-MVP — prioridade média  
* Etapa 11 — Organograma Visual  
* Etapa 12 — Recrutamento  
* Etapa 13 — Estabilização contínua  
## Pós-MVP — backlog  
* KPI Builder avançado (Nível C)  
* Dashboards cross-módulo  
* Offline completo  
* Integração Bizneo  
  
## 13 Etapas de Implementação  

| # | Etapa | Dependência | Estimativa | Categoria |
| -- | ----------------------------------- | ------------- | ---------- | -------------- |
| 1 | Alinhamento e Preparação | — | 1–2d | MVP |
| 2 | Log de Ações Transversal | — | 1–2d | MVP |
| 3 | Security Rules e Acesso Server-side | Etapa 2 | 2–3d | MVP |
| 4 | RH mínimo e PermissionSet expandido | Etapa 2 | 4–5d | MVP |
| 5 | Fundação do Módulo de Formulários | Etapas 3 + 4 | 1 sem | MVP |
| 6 | Migração do Checklist (dual-write) | Etapa 5 | 1 sem | MVP |
| 7 | Execução robusta de Formulários | Etapa 6 | 1 sem | MVP |
| 8 | Tarefas geradas por Formulários | Etapa 7 | 1 sem | Pós-MVP alta |
| 9 | Analytics e KPIs built-in | Etapa 7 | 1 sem | Pós-MVP alta |
| 10 | Limitador de Login | Etapas 2 + 4 | 3–5d | Pós-MVP alta |
| 11 | Organograma Visual | Etapa 4 | 1–2 sem | Pós-MVP média |
| 12 | Recrutamento | Etapas 4 + 11 | 2–3 sem | Pós-MVP média |
| 13 | Testes, Rollout e Estabilização | Todas | 3–5d | MVP + contínua |
  
Etapas 8, 9 e 10 podem rodar em paralelo após suas dependências.  
  
## Etapa 1 — Alinhamento e Preparação  
* Revisar acessos aos bancos (coala, coala-rh, coala-checklist)  
* Confirmar estrutura de pastas e convenções (snake_case, services/repositories)  
* Definir workspace_id centralizado em src/lib/workspace.ts  
* Criar src/types/forms.ts com todos os tipos do Plano Técnico de Formulários  
* Expandir src/types/index.ts com extensões de Task, FormOrigin, TaskProject  
* Criar src/lib/feature-flags.ts com a estrutura de flags da Etapa 13  
## Princípio arquitetural — Navegação Server-side  
Toda navegação dinâmica que dependa de dados (sidebar, breadcrumbs, seletores de projeto/tipo, filtros) **deve passar por endpoints dedicados** que server-side resolvem o multi-db. Componentes client-side **não fazem queries diretas** ao Firestore para montar navegação.  
**Razões:**  
**Razões:**  
* Multi-db: o client não deveria precisar saber em qual banco cada coleção vive.  
* Permissões: filtragem por permissão do usuário acontece server-side.  
* Evolução: mudanças de schema/banco não quebram componentes.  
**Endpoints já definidos:**  
* GET /api/forms/navigation — projetos → tipos → subtipos para a sidebar  
* GET /api/hr/navigation — estrutura organizacional para seletores  
* GET /api/tasks/navigation — projetos de tarefas e fluxos  
Formalize isso no documento de convenções do repositório antes de começar a Etapa 5.  
  
## Etapa 2 — Log de Ações Transversal  
**Banco:** coala  
## Coleção actionLogs  

| Campo        | Tipo      | Descrição                               |
| ------------ | --------- | --------------------------------------- |
| id           | string    | Auto                                    |
| workspace_id | string    | Multi-tenant                            |
| user_id      | string    | UID do ator                             |
| username     | string    | Denormalizado                           |
| module       | string    | auth, checklist, forms, recruitment, hr |
| action       | string    | login, claim, approve, template_created |
| metadata     | Record    | Dados contextuais                       |
| ip_address   | string?   | IP quando disponível                    |
| timestamp    | timestamp | Data/hora                               |
| ttl          | timestamp | Expiração (padrão: 90 dias)             |
  
****Helper logAction() — src/lib/log-action.ts****  
```
export async function logAction(params: {
  user_id: string;
  username: string;
  module: string;
  action: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  ttl_days?: number; // padrão: 90
}): Promise<void>

```
appendChecklistAudit() existente passa a chamar logAction() internamente.  
**Cloud Function:** scheduler diário deleta documentos onde ttl < now().  
**Cloud Function:** scheduler diário deleta documentos onde ttl < now().  
  
## Etapa 3 — Security Rules e Acesso Server-side  
**Pré-requisito de qualquer escrita real no novo modelo.**  
Multi-db + multi-tenant + permissões granulares por projeto é a superfície onde vazamentos acontecem. Esta etapa define explicitamente o modelo de acesso antes de qualquer dado de produção ser gravado.  
## Matriz de acesso por banco  

| Banco | Acesso direto do client | Acesso server-side (API routes) |
| --------------- | ------------------------------------------ | ------------------------------- |
| coala | Limitado: users/{self}, leitura de configs | Total via Admin SDK |
| coala-rh | Nenhum | Total via Admin SDK |
| coala-checklist | Nenhum | Total via Admin SDK |
  
**Princípio:** o client conversa com API routes. Firestore SDK no client é restrito a leituras de presença (own user doc, configurações públicas do workspace).  
## Security Rules — banco coala  
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthed() { return request.auth != null; }
    function inWorkspace(ws) {
      return isAuthed() &&
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.workspace_id == ws;
    }

    // Self-read apenas
    match /users/{uid} {
      allow read: if isAuthed() && request.auth.uid == uid;
      allow write: if false; // server-side only
    }

    // Action logs: bloqueio total client-side
    match /actionLogs/{id} { allow read, write: if false; }

    // Tudo de forms/tasks: server-side only
    match /form_projects/{id} { allow read, write: if false; }
    match /form_types/{id} { allow read, write: if false; }
    match /form_subtypes/{id} { allow read, write: if false; }
    match /form_kpis/{id} { allow read, write: if false; }
    match /form_kpi_dashboards/{id} { allow read, write: if false; }
    match /tasks/{id} { allow read, write: if false; }
    match /task_projects/{id} { allow read, write: if false; }
    match /task_statuses/{id} { allow read, write: if false; }
  }
}

```
## Security Rules — banco coala-rh  
Bloqueio total. Todo acesso passa por /api/hr/*.  
## Security Rules — banco coala-checklist  
Bloqueio total. Todo acesso passa por /api/forms/*.  
## Validação de permissão server-side  
Toda API route segue o padrão:  
```
// src/lib/auth-server.ts
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const session = await verifySessionCookie(req);
  if (!session) throw new HttpError(401);
  const user = await getUserDoc(session.uid);
  if (!user) throw new HttpError(401);
  return user;
}

// src/features/forms/lib/access.ts
export function assertFormPermission(
  user: AuthUser,
  projectId: string,
  level: 'view' | 'operate' | 'manage'
): void {
  const perm = user.permissions?.forms?.projects?.[projectId];
  if (!perm) throw new HttpError(403);
  if (level === 'view' && !perm.view) throw new HttpError(403);
  if (level === 'operate' && !perm.operate) throw new HttpError(403);
  if (level === 'manage' && !perm.manage) throw new HttpError(403);
}

```
**Critério de saída:** zero coleção operacional acessível via Firestore SDK no client. Verificável por teste de integração que tenta ler/escrever direto e espera permissão negada.  
  
## Etapa 4 — RH Mínimo e PermissionSet Expandido  
**Banco:** coala-rh  
## PermissionSet — agrupadores conceituais  
**Source of truth:** o PermissionSet **granular completo** está definido no **Plano Técnico de Formulários**, que é canônico para implementação. Os campos abaixo são **agrupadores conceituais** usados no plano mestre para discussão arquitetural. O código TypeScript real expande view/operate/manage nos campos granulares definidos no plano técnico (ex.: forms.projects[id].templates.create, forms.projects[id].executions.claim, etc.). Em caso de conflito entre os dois documentos, **o Plano Técnico de Formulários prevalece**.  
```
// Modelo conceitual — não usar literalmente em código sem consultar o Plano Técnico
hr?: {
  org_chart: { view: boolean; manage: boolean };
  roles: { view: boolean; manage: boolean };
  functions: { view: boolean; manage: boolean };
};
recruitment?: {
  view: boolean; manage: boolean;
  pipeline: { view: boolean; manage: boolean };
  templates: { view: boolean; manage: boolean };
  talent_pool: { view: boolean; manage: boolean };
  hire: boolean;
};
forms?: {
  projects?: Record<string, { view: boolean; operate: boolean; manage: boolean }>;
  global?: { create_projects: boolean; view_all_projects: boolean };
};

```
## Cloud Functions  
* onRolePermissionsUpdate — propaga PermissionSet do cargo para todos os usuários com aquele jobRoleId  
* onUserRoleChange — ao trocar cargo, copia PermissionSet do novo cargo  
## API Routes  
```
GET    /api/hr/roles
POST   /api/hr/roles
PATCH  /api/hr/roles/:id
POST   /api/hr/roles/:id/propagate
GET    /api/hr/functions
POST   /api/hr/functions
PATCH  /api/hr/functions/:id
PATCH  /api/hr/employees/:uid/role
PATCH  /api/hr/employees/:uid/functions

```
  
## Etapa 5 — Fundação do Módulo de Formulários  
**Banco único:** coala-checklist  
Todo o domínio de Formulários (metadados E dados operacionais) vive no coala-checklist. Não há fragmentação cross-db. Renomear o banco para coala-forms é cosmético e pode ficar para depois.  
Todo o domínio de Formulários (metadados E dados operacionais) vive no coala-checklist. Não há fragmentação cross-db. Renomear o banco para coala-forms é cosmético e pode ficar para depois.  
## Coleções no banco coala-checklist  
* form_projects — área/departamento (Operação, RH, Financeiro, Recrutamento)  
* form_types — tipo de formulário por projeto  
* form_subtypes — subtipo opcional (requires_subtype: boolean no FormType)  
* form_templates — com discriminador context  
* form_executions — execuções  
* form_executions/*/items — itens em subcoleção  
* form_executions/*/events — histórico de eventos  
* form_kpis — definições de KPI (KPI Builder avançado popula completamente)  
* form_kpi_dashboards — dashboard por usuário × projeto  
## Discriminador de contexto no FormTemplate  
```
interface FormTemplate {
  id: string;
  context: 'operational' | 'recruitment';
  // ... campos base ...

  // Comportamentos condicionais por contexto:
  recruitment_config?: {
    requires_lgpd_consent: boolean;
    public_landing: boolean;
    candidate_dedupe_keys: ('cpf' | 'email')[];
    rate_limit_per_ip_per_day?: number;
  };
}

```
O motor é o mesmo. Validações, UI e endpoints downstream consultam context para ativar/desativar comportamentos. Recrutamento (Etapa 12) **não cria motor paralelo**.  
## Estrutura de código  
```
src/features/forms/
  repositories/
    form-project-repository.ts
    form-type-repository.ts
    form-subtype-repository.ts
    form-template-repository.ts
    form-execution-repository.ts
    form-execution-item-repository.ts
    form-event-repository.ts

  services/
    execution-service.ts
    execution-item-service.ts
    scoring-service.ts
    task-trigger-service.ts
    evidence-service.ts
    event-service.ts
    template-service.ts

  lib/
    access.ts                    ← assertFormPermission()
    core.ts                      ← calculateScore, isOutOfRange, shouldCreateTask
    schemas.ts                   ← Zod (snake_case)
    template-interpolation.ts    ← {{unitName}}, {{itemTitle}}, etc.

```
## Decisões de schema fechadas  
* FormProjectMember com role + custom_permissions?  
* FormConditionalBranch e FormConditionalRule  
* **section_id e template_section_id são campos distintos**:  
    * template_section_id — referência imutável à seção original no template; sobrevive a versionamento.  
    * section_id — identidade da seção dentro daquela execução; única por execução, várias podem apontar pro mesmo template_section_id (clones condicionais).  
* approver_id/approver_name em FormTaskTrigger e Task  
* section_id em Task referencia a seção do **FormExecution** que originou a tarefa (rastreabilidade), não um agrupamento próprio do projeto de tarefas — ver Etapa 8.  
* buildDeterministicTaskId() via SHA-256 em task-trigger-service.ts  
## Endpoint de navegação  
```
GET /api/forms/navigation
  → { projects: [{ id, name, types: [{ id, name, subtypes: [...] }] }] }

```
Filtra por permissões do usuário. Usado pela sidebar e seletores.  
  
## Etapa 6 — Migração do Checklist (com Dual-write)  
**Script:** scripts/migrate-checklists-to-forms.ts  
## Fases  
1. **Seed** de form_projects (Operação), form_types (Checklist, com context: 'operational'), form_subtypes (6 subtipos)  
2. **Migração de templates:** checklistTemplates → form_templates  
3. **Migração de execuções:** checklistExecutions → form_executions + subcoleção items  
4. **Normalização de status:** claimed → in_progress, overdue → pending  
5. **Geração** de template_snapshot por execução  
6. **Geração** de sections_summary por execução  
7. **Arquivamento:** _archived_checklistTemplates, _archived_checklistExecutions  
## Requisitos de execução  
* Idempotente: rodar 2× produz o mesmo resultado.  
* Dry-run obrigatório: --dry-run imprime contagens e diffs sem escrever.  
* Validação de contagem pré/pós: se contagem de templates/execuções não bater, aborta.  
* Logs detalhados em migration_logs (no coala).  
## Dual-write (período de transição)  
Por **2 semanas após o cutover**, as rotas legadas /api/dp/checklists/* operam em modo dual-write, controlado pela flag forms_legacy_dual_write_enabled:  
```
// Pseudocódigo do wrapper
async function createChecklistExecution(data) {
  const newExec = await formsService.createExecution(data); // novo motor (canônico)

  if (featureFlags.forms_legacy_dual_write_enabled) {
    try {
      await legacyDb.collection('checklistExecutions').doc(newExec.id).set({
        ...mapToLegacyShape(newExec),
        _migrated: true,
        _legacy_write_at: serverTimestamp(),
      });
    } catch (e) {
      logError('legacy_dual_write_failed', e); // não falha a operação
    }
  }

  return newExec;
}

```
**Regras do dual-write:**  
* Novo motor é a **fonte canônica**. Leituras vêm dele.  
* Coleções antigas recebem cópia para permitir rollback emergencial.  
* Falha no write legado **não bloqueia** a operação.  
* Após 2 semanas estáveis: dual-write é desligado por feature flag.  
* Após 30 dias: coleções antigas viram _archived_* definitivamente.  
## Plano de Rollback  

| Cenário | Ação |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Bug crítico no novo motor < 2 sem | Desligar forms_new_engine_enabled, ativar forms_read_from_legacy_enabled |
| Bug crítico no novo motor > 2 sem | Restore do backup; re-rodar migração após fix |
| Migração corrompida (contagem ruim) | Não promover para produção; manter dry-run em staging |
| Performance ruim no novo motor | Manter dual-write, otimizar queries, deferir cutover |
  
**Critério de saída:** checklist atual funciona sem regressão via novo motor, com dual-write ativo. 2 semanas sem incidentes → desligar dual-write.  
  
## Etapa 7 — Execução Robusta de Formulários  
* Claim com lock transacional  
* Autosave por item: PATCH /api/forms/executions/[id]/items/[itemId]  
* Indicador visual: salvando / salvo / erro  
* Histórico de eventos (subcoleção events)  
* Upload de fotos, anexos, assinaturas  
* Validação de required e block_next  
* Conclusão / reabertura / cancelamento  
* Interface mobile-first  
## Rotas de evidências  
```
POST   /api/forms/executions/[executionId]/items/[itemId]/evidences
DELETE /api/forms/executions/[executionId]/items/[itemId]/evidences/[evidenceId]
POST   /api/forms/executions/[executionId]/sections/[sectionId]/signatures
POST   /api/forms/executions/[executionId]/signatures

```
  
## Etapa 8 — Tarefas geradas por Formulários  
**Banco:** coala  
## Modelo de tarefas — sem task_sections  
**Decisão:** task_sections foi removido do escopo. task_statuses é o mecanismo de fluxo (Kanban / coluna). O campo section_id em tasks refere-se à **seção do FormExecution** que originou a tarefa (rastreabilidade reversa do formulário), **não** a um agrupamento visual no projeto de tarefas. Agrupamentos visuais adicionais ficam fora do escopo até haver demanda concreta.  
## Coleções  
* task_projects — projetos de tarefas  
* task_statuses — status configuráveis (seed automático ao criar projeto); funciona como coluna de fluxo  
* tasks — com form_origin, dedupe_key, section_id (origem do formulário), order  
## Seed automático de task_statuses  

| Nome         | Slug        | Categoria   | is_initial | is_terminal |
| ------------ | ----------- | ----------- | ---------- | ----------- |
| A Fazer      | todo        | not_started | true       | false       |
| Em andamento | in_progress | active      | false      | false       |
| Concluído    | done        | done        | false      | true        |
| Cancelado    | canceled    | canceled    | false      | true        |
  
****Deduplicação e Idempotência****  
```
// dedupe_key = "form_trigger:{execution_id}:{template_item_id}:{task_project_id}"
// task_id    = SHA-256(dedupe_key).base64url.slice(0, 20)

interface EnsureTaskResult {
  task_id: string;
  created: boolean; // true = primeira criação, false = idempotência
}

async function ensureTaskFromTrigger(trigger): Promise<EnsureTaskResult> {
  const task_ref = tasksCollection.doc(buildDeterministicTaskId(trigger));

  try {
    return await db.runTransaction(async (tx) => {
      const existing = await tx.get(task_ref);
      if (existing.exists) {
        return { task_id: task_ref.id, created: false };
      }
      tx.create(task_ref, buildTaskPayload(trigger));
      return { task_id: task_ref.id, created: true };
    });
  } catch (e: any) {
    // Concorrência: outra transaction venceu a corrida.
    // Firestore pode retornar already-exists, aborted, ou failed-precondition.
    if (
      e?.code === 'already-exists' ||
      e?.code === 'aborted' ||
      e?.code === 'failed-precondition'
    ) {
      const snap = await task_ref.get();
      if (snap.exists) {
        return { task_id: task_ref.id, created: false };
      }
    }
    throw e; // erro real, propaga
  }
}

```
**Regras do retorno:**  
* created: true → primeira criação. Service deve disparar logs (task_created) e notificações.  
* created: false → idempotência ou concorrência. Service **não dispara logs nem notificações duplicadas**.  
**Razão da escolha:**  
* tx.create() falha explicitamente se o documento existir (não sobrescreve silenciosamente como set({ merge: false })).  
* O tx.get() prévio cobre o caso comum (re-execução do mesmo trigger).  
* O try/catch externo cobre o caso de corrida entre transactions concorrentes em runtimes diferentes, capturando os três códigos de erro que o Firestore pode retornar nesse cenário.  
## Cloud Function  
onTaskStatusChanged: ao concluir/cancelar task com form_origin, atualiza linked_project_task_status no item da execução.  
  
## Etapa 9 — Analytics e KPIs Built-in  
## KPIs pré-definidos (seed Operação + Checklist)  
1. Taxa de conclusão  
2. Score médio  
3. Execuções atrasadas  
4. Itens críticos não conformes  
5. Ranking por unidade  
6. Tarefas abertas  
## Dashboard configurável  
* Ativar/desativar KPIs, reordenar por drag-and-drop  
* Filtros: período, unidade, tipo, subtipo  
* Persistência no Firestore (form_kpi_dashboards no coala-checklist)  
```
GET    /api/forms/analytics
GET    /api/forms/kpis/dashboard
PATCH  /api/forms/kpis/dashboard

```
  
## Etapa 10 — Limitador de Login  
Pode rodar em paralelo com Etapas 8 e 9. **Dependências:** Etapas 2 + 4  
* loginRestricted: boolean em jobRoles (já referenciado no código)  
* **Hard block** no login: consulta escala do dia, bloqueia se fora do horário  
* **Soft lock**: overlay global após endTime, solicita justificativa  
* +15 min extras após justificativa, depois encerra sessão  
* Registro via logAction({ module: 'auth', action: 'overtime_justification' })  
  
## Etapa 11 — Organograma Visual  
**Banco:** coala-rh | **Dependência:** Etapa 4  
* Rota /dashboard/hr/org-chart  
* Árvore hierárquica interativa com zoom e pan  
* Cards por cargo com colaboradores expansíveis  
* Modal de ficha do cargo  
* Filtro por unidade, busca por nome/cargo  
* Drag para alterar reportsTo (permissão hr.org_chart.manage)  
  
## Etapa 12 — Recrutamento  
**Banco:** coala-rh (vagas, candidatos) + coala-checklist (templates de candidatura como FormTemplates) | **Dependências:** Etapas 4 + 11  
## Decisão arquitetural  
Formulários de candidatura são FormTemplate com context: 'recruitment'. **Não há motor paralelo.** Diferenças (LGPD, dedupe por CPF/email, anti-spam, landing pública) são comportamentos do mesmo motor ativados pelo discriminador.  
## Coleções no coala-rh  
* jobOpenings — vagas com pipeline, referência ao form_template_id, score bands  
* candidates — perfil unificado com LGPD  
* applications — candidaturas com score, histórico de pipeline (referencia form_execution_id)  
## Entregas  
* Pipeline: Triagem → Entrevista → Teste → Aprovação → Contratação  
* Score automático com eliminatórias  
* Banco de talentos com validade LGPD  
* Landing page pública /vagas (sem auth, rate-limited)  
* Candidatura espontânea com dedupe por CPF/email  
* Dashboard: funil de conversão, tempo médio, fonte de candidatos  
* Ao concluir contratação: criação do usuário no OP com cargo e funções da vaga  
  
## Etapa 13 — Testes, Rollout e Estabilização  
## Checklist de rollout do MVP  
* [ ] logAction() gravando em todos os módulos  
* [ ] Security rules bloqueando acesso direto do client  
* [ ] Teste de integração: tentativa de leitura direta retorna permission-denied  
* [ ] Propagação de permissões ao alterar cargo  
* [ ] Checklist atual sem regressão (smoke tests por unidade)  
* [ ] Migração: contagem de templates e execuções validada (dry-run + prod)  
* [ ] Dual-write ativo nas rotas legadas  
* [ ] Autosave granular por item sem duplicidade  
* [ ] Discriminador context funcionando em FormTemplate  
* [ ] Endpoint /api/forms/navigation populando sidebar  
## Checklist de Pós-MVP  
* [ ] Deduplicação de tarefas em concorrência (teste de carga validando created: false em colisões)  
* [ ] Hard block de login fora do horário  
* [ ] Soft lock com overtime justification  
* [ ] Organograma renderizando com hierarquia correta  
* [ ] Candidatura pública com rate limiting e LGPD  
* [ ] Pipeline de recrutamento end-to-end  
* [ ] Criação de usuário no OP ao concluir contratação  
## Deploy progressivo do MVP  
1. **Staging:** dry-run da migração + smoke tests  
2. **Piloto:** uma unidade, dual-write ativo, monitoramento 48h  
3. **Rollout geral:** todas as unidades, dual-write mantido por 2 semanas  
4. **Cutover final:** desligar dual-write por feature flag  
5. **Arquivamento:** após 30 dias estáveis, mover coleções antigas para _archived_*  
  
## Feature Flags e Kill Switches  
Centralizar em src/lib/feature-flags.ts. Persistir em coleção feature_flags no coala, lida no boot do servidor com cache curto (TTL 30s) para permitir reação rápida a incidentes.  
## Flags de ativação progressiva (rollout)  

| Flag | Função | Default ao deployar |
| --------------------------------- | ---------------------------------------------------------------- | ------------------- |
| forms_new_engine_enabled | Liga o novo motor de Formulários como fonte canônica | false → true |
| forms_legacy_dual_write_enabled | Mantém escrita nas coleções antigas durante transição | true por 2 sem |
| forms_read_from_legacy_enabled | Lê das coleções antigas (rollback emergencial) | false |
| forms_navigation_api_enabled | Sidebar usa /api/forms/navigation em vez de queries diretas | false → true |
| forms_recruitment_context_enabled | Permite context: 'recruitment' em FormTemplate | false até Etapa 12 |
| tasks_from_forms_enabled | Geração automática de tarefas a partir de triggers de formulário | false até Etapa 8 |
  
****Kill switches (incidente)****  
Desligar imediatamente sem rollback de deploy. Todos default false (saudável); virar true apenas em incidente.  
Desligar imediatamente sem rollback de deploy. Todos default false (saudável); virar true apenas em incidente.  

| Kill switch | O que desliga |
| ------------------------------- | --------------------------------------------------------------------- |
| kill_forms_module | Bloqueia toda a rota /api/forms/* retornando 503 |
| kill_tasks_from_forms | Para de criar tarefas a partir de triggers (formulários ainda salvam) |
| kill_forms_kpis | Desliga /api/forms/analytics e /api/forms/kpis/* |
| kill_recruitment_public_landing | Tira /vagas público do ar (auth interno continua funcionando) |
| kill_login_restrictor | Desliga hard block / soft lock; login volta a funcionar 24h |
  
****Convenções****  
* **Granularidade por workspace:** flags suportam override por workspace_id para piloto em uma unidade.  
* **Auditoria:** toda mudança de flag grava em actionLogs com module: 'feature_flags'.  
* **Falha segura:** se a leitura da flag falhar, o sistema assume o valor mais conservador (kill switches → false para não bloquear; flags de ativação → false para não ativar funcionalidade nova).  
  
## Diagnóstico do Estado Atual  
## ✅ Implementado e funcionando  
* Checklist completo (acima do plano original)  
* jobRoles e jobFunctions no coala-rh  
* actionLogs parcial (módulo-específico)  
* Campos organizacionais no usuário OP  
* operationalTasks com SLA e escalonamento  
* Analytics de checklist com KPIs básicos  
* Lógica condicional e criticidade nos itens  
## ⚠️ Implementado parcialmente  
* logAction() não genérico — cada módulo escreve ad-hoc  
* PermissionSet sem hr.*, recruitment.*, forms.*  
* Geração diária: rota manual existe, scheduler não confirmado  
* Marcação de overdue: escalonamento existe, status automático incerto  
* Login restrictor: base existe, hard block/soft lock não confirmados  
* Security rules: cobertura parcial; auditoria pendente  
## ❌ Não começado  
* logAction() universal com TTL  
* Cloud Functions de propagação de permissão por cargo  
* Módulo de Formulários (Etapas 5–9)  
* Discriminador context em FormTemplate  
* Tarefas por projeto com task_statuses (Etapa 8)  
* Organograma visual  
* Recrutamento (jobOpenings, candidates, applications)  
* Landing pública /vagas  
* Contratação → criação de usuário no OP  
* KPI Builder avançado  
* Sistema de feature flags centralizado  
  
## Índices Firestore (declarar antes do deploy)  
```
// banco coala
tasks:         [project_id ASC, status_id ASC, order ASC]
tasks:         [assignee_id ASC, due_date ASC]
tasks:         [form_origin.execution_id ASC]
tasks:         [project_id ASC, section_id ASC, order ASC]   // section_id = origem do formulário
task_statuses: [project_id ASC, order ASC]
task_projects: [members ARRAY_CONTAINS, updated_at DESC]
actionLogs:    [workspace_id ASC, module ASC, timestamp DESC]
actionLogs:    [user_id ASC, timestamp DESC]
actionLogs:    [ttl ASC]                                     // scheduler de expiração
feature_flags: [workspace_id ASC, key ASC]

// banco coala-checklist
form_projects:   [workspace_id ASC, is_active ASC]
form_types:      [form_project_id ASC, order ASC]
form_subtypes:   [form_type_id ASC, order ASC]
form_templates:  [form_project_id ASC, form_type_id ASC, is_active ASC]
form_templates:  [context ASC, is_active ASC]                // discriminador
form_executions: [form_project_id ASC, checklist_date ASC, status ASC]
form_executions: [unit_id ASC, checklist_date ASC]
form_executions: [assigned_user_id ASC, status ASC, scheduled_for ASC]

```
**Removido vs v3.1:** o índice task_sections: [project_id ASC, order ASC] foi removido. task_statuses substitui o papel anterior de task_sections.  
  
## Decisões Arquiteturais Fechadas (não reabrir sem RFC)  
1. **Banco único para Formulários:** todo o domínio vive no coala-checklist.  
2. **Server-side first:** client não acessa Firestore diretamente para dados operacionais.  
3. **Discriminador context:** um motor de Formulários, dois modos (operational, recruitment).  
4. **section_id ≠ template_section_id:** ambos persistem, com semânticas distintas.  
5. **section_id em tasks:** referencia origem no FormExecution, não agrupamento visual.  
6. **task_sections fora do escopo:** task_statuses é o mecanismo de fluxo.  
7. **tx.create() para dedupe** com captura de already-exists, aborted e failed-precondition; retorno { task_id, created }.  
8. **Dual-write por 2 semanas:** rede de segurança real durante migração.  
9. **Sem "MVP expandido":** ou é MVP (desliga o legado) ou é Pós-MVP.  
10. **KPI Builder avançado é Pós-MVP backlog:** built-in primeiro, validar demanda real.  
11. **Plano Técnico de Formulários é source of truth do PermissionSet granular.**  
12. **Feature flags com falha segura:** flags de ativação default false; kill switches default false (não bloqueia operação saudável).  
  
## Baseline para Backlog  
A partir desta v3.2, o próximo passo é a quebra em epics:  
```
Epic 1  — Log de Ações Transversal           (Etapa 2)
Epic 2  — Security Rules e Acesso Server-side (Etapa 3)
Epic 3  — RH Permissões                      (Etapa 4)
Epic 4  — Fundação Formulários               (Etapa 5)
Epic 5  — Migração Checklist + Dual-write    (Etapa 6)
Epic 6  — Execução Robusta                   (Etapa 7)
Epic 7  — Tarefas geradas por Formulários    (Etapa 8)
Epic 8  — Analytics e KPIs Built-in          (Etapa 9)
Epic 9  — Limitador de Login                 (Etapa 10)
Epic 10 — Organograma Visual                 (Etapa 11)
Epic 11 — Recrutamento                       (Etapa 12)
Epic 12 — Feature Flags e Kill Switches      (transversal — Etapa 1 + 13)
Epic 13 — Testes e Rollout                   (Etapa 13)

```
**Etapa 1 (Alinhamento)** é absorvida como tarefas iniciais dos Epics 1–4. **Etapa 13 (Testes/Rollout)** vira Epic 13, com sub-épicos por módulo.  
