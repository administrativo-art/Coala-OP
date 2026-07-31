import './app-init.js'; // DEVE vir antes de qualquer re-export que use getFirestore no topo do módulo
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { syncDayAdmin } from './pdv-sync.js';
import { randomUUID } from 'node:crypto';
import { applyUserTerminationEffects } from './user-termination-effects.js';

// ─── Módulo RH (Coala RH v1.3) ───────────────────────────────────────────────
export { syncRhAccessCache, syncFromBizneo, manualSyncFromBizneo } from './rh/sync.js';
export { onFieldUpdate } from './rh/field-update.js';
export { scheduledDateAlerts, scheduledProfileCompletion } from './rh/automations.js';
export { onTermination, lgpdScheduledCleanup } from './rh/termination.js';
export { checkFieldMapConsistency } from './rh/propagation.js';

setGlobalOptions({ maxInstances: 10 });

const db = getFirestore('coala');
const checklistDb = getFirestore('coala-checklist');
const hrDb = getFirestore('coala-rh');
const auth = getAuth();
const STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET ?? 'smart-converter-752gf.firebasestorage.app';
const BIZNEO_BASE_URL = 'https://coala.bizneohr.com/api/v1';
const DOCUMENT_UPLOAD_BATCHES = 'documentUploadBatches';
const DOCUMENT_UPLOAD_ITEMS = 'documentUploadItems';
const MAX_EXPIRED_DOCUMENT_BATCHES_PER_RUN = 50;

const BRT = 'America/Sao_Paulo';
const DEV_DELETE_USER_UIDS = new Set(
  (process.env.DEV_DELETE_USER_UIDS ?? 'U0Q9YZIl7XhQU2B0tB5U6Zpt5Td2')
    .split(',')
    .map((uid) => uid.trim())
    .filter(Boolean)
);

function getBrtDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BRT, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

function getBrtMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRT,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function parseHhmm(hhmm: string): number | null {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function resolveShiftEndDate(date: string, startTime: string, endTime: string): string {
  if (endTime <= startTime) {
    const d = new Date(date + 'T12:00:00Z');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

function normalizeIsoDateFromUnknown(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  if (typeof (value as any)?.toDate === 'function') {
    const parsed = (value as any).toDate();
    return parsed instanceof Date && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString().slice(0, 10)
      : null;
  }
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  return null;
}

function diffCalendarDays(left: string, right: string): number {
  const leftDate = new Date(`${left}T12:00:00Z`);
  const rightDate = new Date(`${right}T12:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / 86400000);
}

type BizneoUserPayload = {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string | null;
  birthday?: string | null;
  work_contracts?: { start_at?: string | null; end_at?: string | null }[];
};

function parseBizneoTimestamp(value?: string | null): Timestamp | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : Timestamp.fromDate(date);
}

async function canManageUserAccess(token: Record<string, any>): Promise<boolean> {
  if (token.isDefaultAdmin) return true;

  const profileId = token.profileId;
  if (!profileId) return false;

  const profileDoc = await db.collection('profiles').doc(profileId).get();
  const perms = profileDoc.data()?.permissions;

  return Boolean(
    perms?.settings?.manageUsers === true ||
    perms?.dp?.collaborators?.terminate === true
  );
}

function resolveBizneoAdmissionDate(user: BizneoUserPayload): string | null {
  return user.work_contracts?.find((contract) => !contract.end_at && contract.start_at)?.start_at
    ?? user.work_contracts?.find((contract) => contract.start_at)?.start_at
    ?? null;
}

async function uploadBizneoAvatar(userId: string, avatarUrl?: string | null): Promise<string | undefined> {
  if (!avatarUrl) return undefined;

  const response = await fetch(avatarUrl);
  if (!response.ok) {
    console.warn(`[syncBizneoUsersMonthly] Falha ao baixar avatar de ${userId}: ${response.status}`);
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  const token = randomUUID();
  const objectPath = `avatars/${userId}/bizneo-profile`;
  const file = getStorage().bucket(STORAGE_BUCKET).file(objectPath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

async function fetchBizneoUsersForSync(): Promise<BizneoUserPayload[]> {
  const token = process.env.BIZNEO_TOKEN;
  if (!token) throw new Error('BIZNEO_TOKEN não configurado.');

  const all: BizneoUserPayload[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${BIZNEO_BASE_URL}/users?token=${encodeURIComponent(token)}&page_size=100&page=${page}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Bizneo users fetch falhou: ${response.status}`);

    const data = await response.json();
    const users = (data.users ?? data) as BizneoUserPayload[];
    if (!Array.isArray(users) || users.length === 0) break;
    all.push(...users);

    const totalPages = data.pagination?.total_pages;
    if (!totalPages || page >= totalPages) break;
    page += 1;
  }

  const detailed: BizneoUserPayload[] = [];
  for (const user of all) {
    try {
      const response = await fetch(`${BIZNEO_BASE_URL}/users/${user.id}?token=${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        detailed.push(user);
        continue;
      }
      const data = await response.json();
      detailed.push({ ...user, ...(data.user ?? data) });
    } catch (error) {
      console.warn(`[syncBizneoUsersMonthly] Falha ao detalhar usuário Bizneo ${user.id}:`, error);
      detailed.push(user);
    }
  }

  return detailed;
}

async function syncBizneoUsersIntoCoala(source: string) {
  const [bizneoUsers, coalaUsersSnap] = await Promise.all([
    fetchBizneoUsersForSync(),
    db.collection('users').get(),
  ]);

  const bizneoByEmail = new Map(
    bizneoUsers
      .filter((user) => typeof user.email === 'string' && user.email.trim())
      .map((user) => [user.email.toLowerCase(), user])
  );

  let matched = 0;
  let avatarSynced = 0;
  let unmatched = 0;

  for (const userDoc of coalaUsersSnap.docs) {
    const userData = userDoc.data();
    const email = String(userData.email ?? '').toLowerCase();
    const bizneoUser = bizneoByEmail.get(email);

    if (!bizneoUser) {
      if (userData.isActive !== false) unmatched += 1;
      continue;
    }

    const admissionDate = parseBizneoTimestamp(resolveBizneoAdmissionDate(bizneoUser));
    const birthDate = parseBizneoTimestamp(bizneoUser.birthday);
    const avatarUrl = await uploadBizneoAvatar(userDoc.id, bizneoUser.avatar_url);
    if (avatarUrl) avatarSynced += 1;

    await userDoc.ref.update({
      registrationIdBizneo: String(bizneoUser.id),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(admissionDate ? { admissionDate } : {}),
      ...(birthDate ? { birthDate } : {}),
      bizneoSyncedAt: new Date().toISOString(),
      bizneoSyncSource: source,
    });
    matched += 1;
  }

  return { matched, avatarSynced, unmatched, totalBizneoUsers: bizneoUsers.length };
}

function monthLastDay(date: string): number {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shouldGenerateChecklistTemplate(template: any, date: string): boolean {
  if (template?.isActive !== true) return false;
  if (!['routine', 'audit', 'maintenance'].includes(String(template?.templateType))) {
    return false;
  }

  const occurrenceType = typeof template?.occurrenceType === 'string' ? template.occurrenceType : 'manual';
  if (occurrenceType === 'manual') return false;
  if (occurrenceType === 'daily') return true;

  const anchorDate = normalizeIsoDateFromUnknown(template?.createdAt);
  if (!anchorDate) return false;

  if (occurrenceType === 'weekly') {
    const delta = diffCalendarDays(date, anchorDate);
    return delta >= 0 && delta % 7 === 0;
  }

  if (occurrenceType === 'biweekly') {
    const delta = diffCalendarDays(date, anchorDate);
    return delta >= 0 && delta % 14 === 0;
  }

  if (occurrenceType === 'monthly') {
    const anchorDay = Number(anchorDate.slice(-2));
    const currentDay = Number(date.slice(-2));
    return currentDay === Math.min(anchorDay, monthLastDay(date));
  }

  return false;
}

function buildChecklistExecutionSections(sections: any[]) {
  return [...(sections ?? [])]
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
    .map((section, index) => ({
      id: section.id,
      title: section.title,
      order: typeof section.order === 'number' ? section.order : index,
      showIf: section.showIf ?? null,
      requirePhoto: section.requirePhoto === true,
      requireSignature: section.requireSignature === true,
    }));
}

function flattenChecklistItems(items: any[], section: any, branchPath: any[] = [], depth = 1): any[] {
  const sorted = [...(items ?? [])].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
  const result: any[] = [];

  for (const item of sorted) {
    result.push({
      templateItemId: item.id,
      sectionId: section.id,
      sectionTitle: section.title,
      order: item.order ?? 0,
      title: item.title,
      description: item.description ?? null,
      type: item.type,
      required: item.required === true,
      weight: item.weight ?? 1,
      blockNext: item.blockNext === true,
      criticality: item.criticality ?? 'low',
      referenceValue: typeof item.referenceValue === 'number' ? item.referenceValue : null,
      tolerancePercent: typeof item.tolerancePercent === 'number' ? item.tolerancePercent : null,
      actionRequired: item.actionRequired === true,
      notifyRoleIds: Array.isArray(item.notifyRoleIds) ? item.notifyRoleIds : [],
      escalationMinutes: typeof item.escalationMinutes === 'number' ? item.escalationMinutes : null,
      branchPath: [...branchPath],
      showIf: item.showIf ?? null,
      sectionShowIf: section.showIf ?? null,
      config: item.config ?? null,
      checked: item.type === 'checkbox' ? null : null,
      yesNoValue: item.type === 'yes_no' ? null : null,
      textValue: item.type === 'text' || item.type === 'select' ? '' : null,
      numberValue: null,
      multiValues: item.type === 'multi_select' ? [] : null,
      dateValue: item.type === 'date' ? '' : null,
      photoUrls: item.type === 'photo' ? [] : null,
      signatureUrl: item.type === 'signature' ? null : null,
      isLate: false,
      isOutOfRange: false,
      completedAt: null,
      completedByUserId: null,
      linkedTaskId: null,
    });

    if (depth >= 4 || !Array.isArray(item.conditionalBranches)) continue;
    for (const branch of item.conditionalBranches) {
      result.push(
        ...flattenChecklistItems(branch.items ?? [], section, [
          ...branchPath,
          { parentItemId: item.id, triggerValue: branch?.value ?? null },
        ], depth + 1)
      );
    }
  }

  return result;
}

function userMatchesChecklistTemplate(template: any, userData: any): boolean {
  const roleIds = Array.isArray(template?.jobRoleIds) ? template.jobRoleIds : [];
  const functionIds = Array.isArray(template?.jobFunctionIds) ? template.jobFunctionIds : [];
  const userRoleId = typeof userData?.jobRoleId === 'string' ? userData.jobRoleId : null;
  const userFunctionIds = Array.isArray(userData?.jobFunctionIds) ? userData.jobFunctionIds : [];

  if (roleIds.length > 0 && (!userRoleId || !roleIds.includes(userRoleId))) {
    return false;
  }

  if (functionIds.length > 0 && !functionIds.some((id: string) => userFunctionIds.includes(id))) {
    return false;
  }

  return true;
}

async function resolveEscalationRoleIds(roleIds: string[]): Promise<string[]> {
  const uniqueRoleIds = [...new Set(roleIds.filter(Boolean))];
  if (uniqueRoleIds.length === 0) return [];

  const roleSnaps = await Promise.all(
    uniqueRoleIds.map((roleId) => hrDb.collection('jobRoles').doc(roleId).get())
  );

  const escalated = roleSnaps
    .map((snap) => snap.data()?.reportsTo)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return escalated.length > 0 ? [...new Set(escalated)] : uniqueRoleIds;
}

function isShiftEnded(shiftEndDate: string, shiftEndTime: string, now: Date): boolean {
  const endMinutes = parseHhmm(shiftEndTime);
  if (endMinutes === null) return false;
  const nowDate = getBrtDate(now);
  const nowMinutes = getBrtMinutes(now);
  if (shiftEndDate < nowDate) return true;
  if (shiftEndDate > nowDate) return false;
  return endMinutes <= nowMinutes;
}

// --- Helpers para o novo motor de Formulários (snake_case) ---

async function isFormsEngineEnabled(): Promise<boolean> {
  try {
    const snap = await db
      .collection('feature_flags')
      .where('key', '==', 'forms_new_engine_enabled')
      .limit(1)
      .get();
    return !snap.empty && snap.docs[0].data()?.enabled === true;
  } catch {
    return false;
  }
}

function shouldGenerateFormTemplate(template: any, date: string): boolean {
  if (template?.is_active !== true) return false;

  const occurrenceType = typeof template?.occurrence_type === 'string' ? template.occurrence_type : 'manual';
  if (occurrenceType === 'manual') return false;
  if (occurrenceType === 'daily') return true;

  const anchorDate = normalizeIsoDateFromUnknown(template?.created_at);
  if (!anchorDate) return false;

  if (occurrenceType === 'weekly') {
    const delta = diffCalendarDays(date, anchorDate);
    return delta >= 0 && delta % 7 === 0;
  }
  if (occurrenceType === 'biweekly') {
    const delta = diffCalendarDays(date, anchorDate);
    return delta >= 0 && delta % 14 === 0;
  }
  if (occurrenceType === 'monthly') {
    const anchorDay = Number(anchorDate.slice(-2));
    const currentDay = Number(date.slice(-2));
    return currentDay === Math.min(anchorDay, monthLastDay(date));
  }

  return false;
}

function resolveFormDueAt(template: any, date: string, shiftStartTime?: string): string | null {
  const dueRule = template?.due_rule && typeof template.due_rule === 'object' ? template.due_rule : null;
  if (!dueRule || dueRule.type === 'none') return null;

  if (dueRule.type === 'fixed_time' && typeof dueRule.time === 'string' && dueRule.time) {
    return `${date}T${dueRule.time}:00-03:00`;
  }

  const minutes = typeof dueRule.minutes === 'number' ? dueRule.minutes : 0;
  if (dueRule.type === 'after_shift_start' && shiftStartTime) {
    const startMinutes = parseHhmm(shiftStartTime);
    if (startMinutes === null) return null;
    const due = new Date(`${date}T00:00:00-03:00`);
    due.setMinutes(startMinutes + minutes);
    return due.toISOString();
  }

  if (dueRule.type === 'after_creation') {
    const due = new Date();
    due.setMinutes(due.getMinutes() + minutes);
    return due.toISOString();
  }

  return null;
}

function userMatchesFormTemplate(template: any, userData: any): boolean {
  const roleIds = Array.isArray(template?.job_role_ids) ? template.job_role_ids : [];
  const functionIds = Array.isArray(template?.job_function_ids) ? template.job_function_ids : [];
  const userRoleId = typeof userData?.jobRoleId === 'string' ? userData.jobRoleId : null;
  const userFunctionIds = Array.isArray(userData?.jobFunctionIds) ? userData.jobFunctionIds : [];

  if (roleIds.length > 0 && (!userRoleId || !roleIds.includes(userRoleId))) return false;
  if (functionIds.length > 0 && !functionIds.some((id: string) => userFunctionIds.includes(id))) return false;
  return true;
}

function buildFormExecutionSectionsSnake(sections: any[]) {
  return [...(sections ?? [])]
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0))
    .map((section, index) => ({
      id: section.id,
      template_section_id: section.id,
      title: section.title,
      order: typeof section.order === 'number' ? section.order : index,
      show_if: section.show_if ?? null,
      require_photo: section.require_photo === true,
      require_signature: section.require_signature === true,
      photo_url: null,
      signature_url: null,
    }));
}

function flattenFormTemplateItemsSnake(sections: any[]): any[] {
  const result: any[] = [];

  function visitItems(items: any[], section: any, depth = 1): void {
    const sorted = [...(items ?? [])].sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0));
    for (const item of sorted) {
      result.push({
        id: `${section.id}-${item.id}`,
        template_item_id: item.id,
        template_section_id: section.id,
        section_id: section.id,
        section_title: section.title,
        order: item.order ?? 0,
        title: item.title,
        description: item.description ?? null,
        type: item.type,
        required: item.required === true,
        weight: item.weight ?? 1,
        block_next: item.block_next === true,
        criticality: item.criticality ?? 'medium',
        reference_value: typeof item.reference_value === 'number' ? item.reference_value : null,
        tolerance_percent: typeof item.tolerance_percent === 'number' ? item.tolerance_percent : null,
        action_required: item.action_required === true,
        notify_role_ids: Array.isArray(item.notify_role_ids) ? item.notify_role_ids : [],
        escalation_minutes: typeof item.escalation_minutes === 'number' ? item.escalation_minutes : null,
        show_if: item.show_if ?? null,
        section_show_if: section.show_if ?? null,
        config: item.config ?? null,
        checked: null,
        yes_no_value: null,
        text_value: null,
        number_value: null,
        multi_values: [],
        date_value: null,
        photo_urls: [],
        signature_url: null,
        is_out_of_range: false,
        completed_at: null,
        completed_by_user_id: null,
        linked_project_task_id: null,
        linked_project_task_status: null,
      });

      if (depth < 4 && Array.isArray(item.conditional_branches)) {
        for (const branch of item.conditional_branches) {
          visitItems(branch.items ?? [], section, depth + 1);
        }
      }
    }
  }

  for (const section of (sections ?? [])) {
    visitItems(section.items ?? [], section);
  }

  return result;
}

function buildInitialSectionsSummary(sections: any[]): Record<string, { total_items: number; completed_items: number; score: number }> {
  const summary: Record<string, { total_items: number; completed_items: number; score: number }> = {};
  for (const section of (sections ?? [])) {
    const itemCount = (section.items ?? []).length;
    summary[section.id] = { total_items: itemCount, completed_items: 0, score: 0 };
  }
  return summary;
}

export const cleanupExpiredActionLogs = onSchedule({
  schedule: "every 24 hours",
  timeZone: "America/Sao_Paulo",
  retryCount: 1,
}, async () => {
  const now = new Date();
  const snap = await db
    .collection('actionLogs')
    .where('ttl', '<=', now)
    .limit(500)
    .get();

  if (snap.empty) {
    console.log('[cleanupExpiredActionLogs] Nenhum log expirado encontrado.');
    return;
  }

  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  console.log(`[cleanupExpiredActionLogs] ${snap.size} log(s) removido(s).`);
});

// Remove uploads de RH abandonados. A análise guarda arquivos em uma área
// temporária até a confirmação do usuário; este job mantém essa área limitada.
export const cleanupExpiredEmployeeDocumentBatches = onSchedule({
  schedule: 'every 24 hours',
  timeZone: BRT,
  retryCount: 1,
}, async () => {
  const expired = await hrDb
    .collection(DOCUMENT_UPLOAD_BATCHES)
    .where('expiresAt', '<', Timestamp.now())
    .limit(MAX_EXPIRED_DOCUMENT_BATCHES_PER_RUN)
    .get();

  let removedItems = 0;
  for (const batchDoc of expired.docs) {
    const batchId = batchDoc.id;
    await getStorage().bucket(STORAGE_BUCKET)
      .deleteFiles({ prefix: `hr/pending-document-batches/${batchId}/` })
      .catch((cause) => console.warn(`[cleanupExpiredEmployeeDocumentBatches] Storage ${batchId}:`, cause));

    const items = await hrDb.collection(DOCUMENT_UPLOAD_ITEMS).where('batchId', '==', batchId).get();
    for (const itemDoc of items.docs) {
      await hrDb.recursiveDelete(itemDoc.ref);
      removedItems += 1;
    }
    await hrDb.recursiveDelete(batchDoc.ref);
  }

  console.log(`[cleanupExpiredEmployeeDocumentBatches] ${expired.size} lote(s) e ${removedItems} item(ns) removidos.`);
});

// Reconcilia somente a âncora de retenção. Não exclui documentos: as políticas
// jurídicas continuam pendentes e o descarte só poderá existir após aprovação.
export const reconcileGeneratedDocumentRetention = onSchedule({
  schedule: '30 3 * * *',
  timeZone: BRT,
  retryCount: 2,
  memory: '256MiB',
}, async () => {
  const terminated = await db.collection('users')
    .where('employmentStatus', '==', 'terminated')
    .limit(100)
    .get();
  let updated = 0;
  const unresolved: string[] = [];
  for (const user of terminated.docs) {
    const rawEndedAt = user.get('terminationDate');
    const endedAt = typeof rawEndedAt === 'string'
      ? rawEndedAt
      : typeof rawEndedAt?.toDate === 'function'
        ? rawEndedAt.toDate().toISOString()
        : null;
    if (!endedAt || Number.isNaN(new Date(endedAt).getTime())) {
      unresolved.push(user.id);
      continue;
    }
    const documents = await db.collection('generatedDocuments')
      .where('employeeId', '==', user.id)
      .get();
    const targets = documents.docs.filter((document) =>
      document.get('retentionAnchorType') === 'employment_end'
      && !document.get('retentionUntil')
    );
    for (let offset = 0; offset < targets.length; offset += 200) {
      const batch = db.batch();
      targets.slice(offset, offset + 200).forEach((document) => {
        const until = new Date(endedAt);
        // Prazo provisório já registrado na versão da política. O job apenas
        // materializa a data; nenhuma exclusão usa esta data enquanto o estado
        // da política for pending_legal.
        until.setUTCFullYear(until.getUTCFullYear() + 5);
        const fields = {
          retentionAnchorAt: endedAt,
          retentionUntil: until.toISOString(),
          retentionCalculatedAt: Timestamp.now(),
          retentionCalculatedBy: 'system:scheduled-retention-reconciliation',
        };
        batch.set(document.ref, fields, { merge: true });
        batch.set(document.ref.collection('audit').doc('resolvedValues'), fields, { merge: true });
        updated += 1;
      });
      await batch.commit();
    }
  }
  await db.collection('systemJobReports').doc('generated-document-retention-latest').set({
    job: 'reconcileGeneratedDocumentRetention',
    scannedEmployees: terminated.size,
    updatedDocuments: updated,
    unresolvedEmployeeIds: unresolved,
    emptyReconciliation: unresolved.length === 0,
    ranAt: Timestamp.now(),
  });
  console.log('[reconcileGeneratedDocumentRetention] Concluído.', {
    scannedEmployees: terminated.size,
    updatedDocuments: updated,
    unresolved: unresolved.length,
  });
});

export const syncBizneoUsersMonthly = onSchedule({
  schedule: '0 3 1 * *',
  timeZone: BRT,
  retryCount: 2,
  memory: '512MiB',
  secrets: ['BIZNEO_TOKEN'],
}, async () => {
  console.log('[syncBizneoUsersMonthly] Iniciando sincronização mensal Bizneo.');
  const result = await syncBizneoUsersIntoCoala('monthly-schedule');
  console.log('[syncBizneoUsersMonthly] Concluído.', result);
});

// --- Rotina Diária de Sincronização (PDV Legal -> Coala) ---
// --- Rotina Horária de Sincronização (PDV Legal -> Coala) ---
// Mantém as metas atualizadas durante o dia de funcionamento
export const hourlyPdvSync = onSchedule({
  schedule: "0 8-23 * * *", // Cada hora das 08:00 às 23:00
  timeZone: "America/Sao_Paulo",
  retryCount: 2
}, async () => {
  // Compute BRT date using proper offset (UTC-3)
  const nowUtc = new Date();
  const brtMs = nowUtc.getTime() - 3 * 60 * 60 * 1000;
  const dateStr = new Date(brtMs).toISOString().split('T')[0];
  console.log(`[hourlyPdvSync] Iniciando para data BRT: ${dateStr}`);

  try {
    const kiosksSnap = await db.collection('kiosks').get();
    console.log(`[hourlyPdvSync] ${kiosksSnap.size} quiosques encontrados na coleção.`);

    let synced = 0;
    let skipped = 0;

    const HOURLY_FALLBACK_MAP: Record<string, string> = {
      'tirirical': '17343',
      'joao-paulo': '17344',
    };

    for (const doc of kiosksSnap.docs) {
      const kiosk = doc.data();
      const pdvFilialId = kiosk.pdvFilialId || HOURLY_FALLBACK_MAP[doc.id];
      if (!pdvFilialId) {
        console.log(`[hourlyPdvSync] Quiosque ${doc.id} (${kiosk.name ?? '?'}) sem pdvFilialId — ignorado.`);
        skipped++;
        continue;
      }

      console.log(`[hourlyPdvSync] Sincronizando ${doc.id} (filial ${pdvFilialId}) para ${dateStr}...`);
      try {
        await syncDayAdmin(dateStr, doc.id, pdvFilialId, db);
        synced++;
      } catch (kioskError) {
        console.error(`[hourlyPdvSync] Erro no quiosque ${doc.id}:`, kioskError);
      }
    }

    console.log(`[hourlyPdvSync] Concluído. Sincronizados: ${synced}, ignorados: ${skipped}.`);
  } catch (e) {
    console.error("[hourlyPdvSync] Erro geral:", e);
  }
});

// --- Sincronizar metas para um intervalo de datas (trigger manual) ---
export const syncGoalsForRange = onCall(
  { cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (request: any) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');

    // Verifica permissão: admin customClaim OU settings.manageUsers no perfil
    const token = request.auth.token;
    if (!token.isDefaultAdmin) {
      const profileId = token.profileId;
      if (!profileId) throw new HttpsError('permission-denied', 'Apenas administradores.');
      const profileDoc = await db.collection('profiles').doc(profileId).get();
      const perms = profileDoc.data()?.permissions;
      if (!perms?.settings?.manageUsers && !perms?.goals?.manage) {
        throw new HttpsError('permission-denied', 'Apenas administradores.');
      }
    }

    const { kioskId, startDate, endDate, pdvFilialId: pdvFilialIdParam } = request.data as {
      kioskId: string; startDate: string; endDate: string; pdvFilialId?: string;
    };
    if (!kioskId || !startDate || !endDate) throw new HttpsError('invalid-argument', 'kioskId, startDate e endDate são obrigatórios.');

    const kioskDoc = await db.collection('kiosks').doc(kioskId).get();
    if (!kioskDoc.exists) throw new HttpsError('not-found', 'Quiosque não encontrado.');

    const FALLBACK_MAP: Record<string, string> = {
      'tirirical': '17343',
      'joao-paulo': '17344',
    };
    const pdvFilialId = pdvFilialIdParam || kioskDoc.data()?.pdvFilialId || FALLBACK_MAP[kioskId];
    if (!pdvFilialId) throw new HttpsError('failed-precondition', 'Quiosque sem pdvFilialId configurado. Informe o ID da filial no PDV Legal.');

    type DayResult = {
      date: string;
      revenue?: number;
      error?: string;
      errorCode?: string;
      diagnostics?: unknown;
      warnings?: string[];
    };
    const results: DayResult[] = [];
    const current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      try {
        const result = await syncDayAdmin(dateStr, kioskId, pdvFilialId, db) as any;
        results.push({
          date: dateStr,
          revenue: result.dailyRevenue,
          diagnostics: result.diagnostics,
          warnings: result.warnings,
        });
      } catch (e: any) {
        console.error(`[syncGoalsForRange] Erro em ${dateStr}:`, e);
        results.push({ date: dateStr, error: e.message, errorCode: e.code });
      }
      current.setDate(current.getDate() + 1);
    }

    return { results };
  }
);

const internalAppCors = [
  /op\.coalashakes\.com$/,
  /smart-converter-752gf\.web\.app$/,
  /smart-converter-752gf\.firebaseapp\.com$/,
  /localhost(:\d+)?$/,
];

// --- Criar usuário (Auth + Firestore) server-side ---
export const createUser = onCall(
  { cors: internalAppCors },
  async (request: any) => {
    // Apenas admins podem criar usuários
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Não autenticado.');
    }
    
    // Verifica se é admin via claims
    if (!request.auth.token.isDefaultAdmin) {
      throw new HttpsError('permission-denied', 'Apenas administradores podem criar novos usuários.');
    }

    const { email, password, userData = {} } = request.data;
    const username = request.data.username ?? userData.username;
    const profileId = request.data.profileId ?? userData.profileId;
    const assignedKioskIds = request.data.assignedKioskIds ?? userData.assignedKioskIds;
    const avatarUrl = request.data.avatarUrl ?? userData.avatarUrl;
    const operacional = request.data.operacional ?? userData.operacional;

    if (!email || !password || !username || !profileId) {
      throw new HttpsError('invalid-argument', 'Campos obrigatórios: email, password, username, profileId.');
    }

    try {
      // 1. Cria no Firebase Auth
      const userRecord = await auth.createUser({ 
        email, 
        password,
        displayName: username 
      });

      // 2. Busca info do perfil para setar os claims imediatamente
      const profileSnap = await db.collection('profiles').doc(profileId).get();
      const isDefaultAdmin = profileSnap.exists && profileSnap.data()?.isDefaultAdmin === true;

      // 3. Seta Custom Claims
      await auth.setCustomUserClaims(userRecord.uid, { profileId, isDefaultAdmin });

      // 4. Cria documento no Firestore
      const cleanUserData = JSON.parse(JSON.stringify(userData));
      delete cleanUserData.password;
      delete cleanUserData.email;
      delete cleanUserData.id;

      await db.collection('users').doc(userRecord.uid).set({
        ...cleanUserData,
        email,
        username,
        profileId,
        assignedKioskIds: assignedKioskIds || [],
        avatarUrl: avatarUrl || '',
        operacional: operacional || false,
        mustChangePassword: true,
      });

      return { uid: userRecord.uid };
    } catch (error: any) {
      console.error("Erro ao criar usuário:", error);
      throw new HttpsError('internal', error.message || 'Erro interno ao criar usuário.');
    }
  }
);

// --- Deletar usuário (Auth + Firestore) server-side ---
export const deleteUser = onCall(
  { cors: internalAppCors },
  async (request: any) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Não autenticado.');
    }
    if (!DEV_DELETE_USER_UIDS.has(request.auth.uid)) {
      throw new HttpsError('permission-denied', 'Exclusão permanente restrita ao acesso técnico.');
    }
    if (!request.auth.token.isDefaultAdmin) {
      throw new HttpsError('permission-denied', 'Apenas administradores podem excluir usuários.');
    }

    const { uid } = request.data;
    if (!uid) {
      throw new HttpsError('invalid-argument', 'O UID do usuário é obrigatório.');
    }

    try {
      // 1. Deleta do Firebase Auth
      await auth.deleteUser(uid);
      // 2. Deleta o documento no Firestore
      await db.collection('users').doc(uid).delete();
      return { success: true };
    } catch (error: any) {
      console.error("Erro ao deletar usuário:", error);
      throw new HttpsError('internal', error.message || 'Erro ao deletar usuário.');
    }
  }
);

// --- Desligamento/Inativação DP: bloqueia no Auth e mantém no Firestore para histórico ---
export const terminateUser = onCall(
  { cors: internalAppCors },
  async (request: any) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');
    if (!(await canManageUserAccess(request.auth.token))) {
      throw new HttpsError('permission-denied', 'Sem permissão para desligar usuários.');
    }

    const { uid, inactivationType, terminationNotes } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'O UID do usuário é obrigatório.');

    const targetRef = db.collection('users').doc(uid);
    const targetSnapshot = await targetRef.get();
    if (!targetSnapshot.exists) throw new HttpsError('not-found', 'Usuário não encontrado.');
    const normalizedType = inactivationType === 'contract_termination' ? 'contract_termination' : 'temporary';
    if (normalizedType === 'contract_termination') {
      throw new HttpsError(
        'failed-precondition',
        'Desligamentos contratuais devem ser iniciados pelo fluxo formal de terminationProcesses.'
      );
    }

    try {
      // 1. Desativa no Firebase Auth para bloquear login sem perder o UID.
      await auth.updateUser(uid, { disabled: true });

      // 2. Mantém o documento no Firestore marcado como inativo.
      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        isActive: false,
        inactivationType: normalizedType,
        inactivationHistory: FieldValue.arrayUnion({
          type: normalizedType,
          at: nowIso,
          actorUid: request.auth.uid,
          reason: 'Inativação temporária',
          cause: null,
          notes: terminationNotes ?? null,
          terminationDate: null,
          employmentRelationshipType: targetSnapshot.get('employmentRelationshipType') ?? null,
        }),
      };

      await targetRef.update(updatePayload);

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao desligar usuário:', error);
      throw new HttpsError('internal', error.message || 'Erro ao desligar usuário.');
    }
  }
);

// --- Reativação DP: reabilita no Auth e marca o cadastro como ativo novamente ---
export const reactivateUser = onCall(
  { cors: internalAppCors },
  async (request: any) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Não autenticado.');
    if (!(await canManageUserAccess(request.auth.token))) {
      throw new HttpsError('permission-denied', 'Sem permissão para reativar usuários.');
    }

    const { uid } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'O UID do usuário é obrigatório.');

    try {
      await auth.updateUser(uid, { disabled: false });

      await db.collection('users').doc(uid).update({
        isActive: true,
        inactivationType: FieldValue.delete(),
        terminationDate: FieldValue.delete(),
        terminationReason: FieldValue.delete(),
        terminationCause: FieldValue.delete(),
        terminationNotes: FieldValue.delete(),
        terminationRelationshipType: FieldValue.delete(),
        terminationProcessId: FieldValue.delete(),
        employmentStatus: 'active',
        terminationEffectsVersion: FieldValue.delete(),
        terminationEffectsAppliedAt: FieldValue.delete(),
        terminationEffectsReportPath: FieldValue.delete(),
        inactivationHistory: FieldValue.arrayUnion({
          type: 'reactivation',
          at: new Date().toISOString(),
          actorUid: request.auth.uid,
          reason: 'Reativação/recontratação',
          cause: null,
          notes: null,
          terminationDate: null,
        }),
      });

      const employees = await hrDb.collection('employees').where('auth_uid', '==', uid).get();
      const employeeWrites = hrDb.batch();
      employees.docs.forEach((employee) => employeeWrites.set(employee.ref, {
        status: 'active',
        employment_status: 'active',
        is_active: true,
        reactivated_at: new Date().toISOString(),
      }, { merge: true }));
      if (!employees.empty) await employeeWrites.commit();

      return { success: true };
    } catch (error: any) {
      console.error('Erro ao reativar usuário:', error);
      throw new HttpsError('internal', error.message || 'Erro ao reativar usuário.');
    }
  }
);

// --- Custom Claims Sync: quando o documento do usuário muda ---
export const onUserProfileChange = onDocumentWritten(
  { document: 'users/{userId}', database: 'coala' },
  async (event: any) => {
    const userId = event.params.userId;

    if (!event.data?.after.exists) {
      await auth.setCustomUserClaims(userId, {});
      console.log(`🗑️  Claims removidos para ${userId}`);
      return;
    }

    const userData = event.data.after.data()!;
    const isContractTermination = userData.isActive === false && (
      userData.inactivationType === 'contract_termination' || userData.employmentStatus === 'terminated'
    );
    if (isContractTermination && userData.terminationEffectsVersion !== 1) {
      const report = await applyUserTerminationEffects({
        db,
        hrDb,
        checklistDb,
        userId,
        user: userData,
      });
      await event.data.after.ref.set({
        terminationEffectsVersion: report.version,
        terminationEffectsAppliedAt: report.appliedAt,
        terminationEffectsReportPath: `terminationImpactReports/${userId}__${report.effectiveDate}`,
      }, { merge: true });
      console.log(`✅ Efeitos do desligamento aplicados para ${userId}`, report.counts);
    }
    const profileId = userData.profileId;

    if (!profileId) {
      console.log(`⚠️  Usuário ${userId} sem profileId`);
      return;
    }

    const profileSnap = await db.collection('profiles').doc(profileId).get();
    const isDefaultAdmin = profileSnap.exists && profileSnap.data()?.isDefaultAdmin === true;

    await auth.setCustomUserClaims(userId, { profileId, isDefaultAdmin });
    console.log(`✅ Claims atualizados: ${userId} profileId=${profileId} isDefaultAdmin=${isDefaultAdmin}`);
  }
);

// --- Custom Claims Sync: quando o perfil muda (atualiza todos os usuários do perfil) ---
export const onProfileChange = onDocumentWritten(
  { document: 'profiles/{profileId}', database: 'coala' },
  async (event: any) => {
    const profileId = event.params.profileId;

    const usersSnap = await db.collection('users')
      .where('profileId', '==', profileId)
      .get();

    if (usersSnap.empty) {
      console.log(`ℹ️  Nenhum usuário com profileId=${profileId}`);
      return;
    }

    const profileData = event.data?.after.exists ? event.data.after.data() : null;
    const isDefaultAdmin = profileData?.isDefaultAdmin === true;

    const promises = usersSnap.docs.map(userDoc =>
      auth.setCustomUserClaims(userDoc.id, { profileId, isDefaultAdmin })
        .then(() => console.log(`✅ ${userDoc.data().username || userDoc.id} atualizado`))
    );

    await Promise.all(promises);
    console.log(`🎉 ${promises.length} usuário(s) atualizados para profileId=${profileId}`);
  }
);

// --- Geração diária automática de checklists ---
export const checklistDailyGenerate = onSchedule(
  { schedule: '5 0 * * *', timeZone: BRT, retryCount: 2, memory: '256MiB' },
  async () => {
    const now = new Date();
    const today = getBrtDate(now);
    const formsEnabled = await isFormsEngineEnabled();
    console.log(`[checklistDailyGenerate] Gerando para ${today} — motor: ${formsEnabled ? 'forms' : 'legacy'}`);

    const [shiftsSnap, unitsSnap, shiftDefsSnap] = await Promise.all([
      db.collectionGroup('shifts').where('date', '==', today).get(),
      db.collection('dp_units').get(),
      db.collection('dp_shiftDefinitions').get(),
    ]);

    const unitNames = new Map<string, string>();
    const shiftDefNames = new Map<string, string>();
    unitsSnap.docs.forEach((d) => { const n = d.data()?.name; if (n) unitNames.set(d.id, n); });
    shiftDefsSnap.docs.forEach((d) => { const n = d.data()?.name; if (n) shiftDefNames.set(d.id, n); });

    const userIds = [...new Set(
      shiftsSnap.docs
        .filter((d) => d.data()?.type === 'work')
        .map((d) => d.data()?.userId as string)
        .filter(Boolean)
    )];
    const userDocs = await Promise.all(userIds.map((uid) => db.collection('users').doc(uid).get()));
    const usersById = new Map<string, any>(
      userDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() ?? {}])
    );

    let created = 0;
    let skipped = 0;
    const batchItems: Array<{ id: string; data: Record<string, unknown> }> = [];

    if (formsEnabled) {
      // New engine: read form_templates (snake_case), write form_executions
      const [templatesSnap, existingSnap] = await Promise.all([
        checklistDb.collection('form_templates').where('is_active', '==', true).get(),
        checklistDb.collection('form_executions').where('scheduled_for', '==', today).get(),
      ]);
      const existingIds = new Set(existingSnap.docs.map((d) => d.id));

      for (const tDoc of templatesSnap.docs) {
        const t = tDoc.data();
        if (!t.name || !Array.isArray(t.sections) || !shouldGenerateFormTemplate(t, today)) continue;

        const tUnitIds: string[] = Array.isArray(t.unit_ids) ? t.unit_ids : [];
        const tShiftDefIds: string[] = Array.isArray(t.shift_definition_ids) ? t.shift_definition_ids : [];

        for (const sDoc of shiftsSnap.docs) {
          const s = sDoc.data();
          if (s?.type !== 'work') continue;
          if (!s.scheduleId || !s.unitId || !s.userId || !s.startTime || !s.endTime) continue;
          const userData = usersById.get(s.userId);
          if (!userData || userData.isActive === false) continue;

          if (tUnitIds.length > 0 && !tUnitIds.includes(s.unitId)) continue;
          if (tShiftDefIds.length > 0 && (!s.shiftDefinitionId || !tShiftDefIds.includes(s.shiftDefinitionId))) continue;
          if (!userMatchesFormTemplate(t, userData)) continue;

          const execId = `${today}__${s.scheduleId}__${sDoc.id}__${tDoc.id}`;
          if (existingIds.has(execId)) { skipped++; continue; }
          existingIds.add(execId);
          created++;

          const sections = buildFormExecutionSectionsSnake(t.sections as any[]);
          const items = flattenFormTemplateItemsSnake(t.sections as any[]);
          const sectSummary = buildInitialSectionsSummary(t.sections as any[]);

          batchItems.push({
            id: execId,
            data: {
              workspace_id: 'coala',
              form_project_id: t.form_project_id ?? 'legacy-geral',
              form_type_id: t.form_type_id ?? 'legacy-type-manual',
              form_subtype_id: t.form_subtype_id ?? null,
              context: 'operational',
              template_id: tDoc.id,
              assignment_id: t.active_assignment_id ?? null,
              form_version_id: t.current_version_id ?? null,
              template_name: t.name,
              template_version: typeof t.version === 'number' ? t.version : 1,
              occurrence_type: t.occurrence_type ?? 'manual',
              template_snapshot: { id: tDoc.id, name: t.name, version: t.version ?? 1, sections: t.sections },
              unit_id: s.unitId,
              unit_name: unitNames.get(s.unitId) ?? s.unitId,
              schedule_id: s.scheduleId,
              shift_id: sDoc.id,
              shift_definition_id: s.shiftDefinitionId ?? null,
              shift_definition_name: s.shiftDefinitionId ? shiftDefNames.get(s.shiftDefinitionId) ?? s.shiftDefinitionId : null,
              shift_start_time: s.startTime,
              shift_end_time: s.endTime,
              shift_end_date: resolveShiftEndDate(today, s.startTime, s.endTime),
              assigned_user_id: s.userId,
              assigned_username: userData.username || s.userId,
              collaborator_user_ids: [],
              collaborator_usernames: [],
              scheduled_for: today,
              due_at: resolveFormDueAt(t, today, s.startTime),
              sections,
              items,
              sections_summary: sectSummary,
              status: 'pending',
              score: null,
              claimed_by_user_id: null,
              claimed_by_username: null,
              claimed_at: null,
              completed_by_user_id: null,
              completed_by_username: null,
              completed_at: null,
              canceled_by_user_id: null,
              canceled_at: null,
              created_at: new Date(),
              updated_at: new Date(),
            },
          });
        }
      }

      for (let i = 0; i < batchItems.length; i += 400) {
        const batch = checklistDb.batch();
        batchItems.slice(i, i + 400).forEach((entry) => {
          batch.set(checklistDb.collection('form_executions').doc(entry.id), entry.data);
        });
        await batch.commit();
      }
    } else {
      // Legacy engine: read checklistTemplates, write checklistExecutions
      const [templatesSnap, existingSnap] = await Promise.all([
        checklistDb.collection('checklistTemplates').where('isActive', '==', true).get(),
        checklistDb.collection('checklistExecutions').where('checklistDate', '==', today).get(),
      ]);
      const existingIds = new Set(existingSnap.docs.map((d) => d.id));

      for (const tDoc of templatesSnap.docs) {
        const t = tDoc.data();
        if (!t.name || !Array.isArray(t.sections) || !shouldGenerateChecklistTemplate(t, today)) continue;

        const tUnitIds: string[] = Array.isArray(t.unitIds) ? t.unitIds : [];
        const tShiftDefIds: string[] = Array.isArray(t.shiftDefinitionIds) ? t.shiftDefinitionIds : [];

        for (const sDoc of shiftsSnap.docs) {
          const s = sDoc.data();
          if (s?.type !== 'work') continue;
          if (!s.scheduleId || !s.unitId || !s.userId || !s.startTime || !s.endTime) continue;
          const userData = usersById.get(s.userId);
          if (!userData || userData.isActive === false) continue;

          if (tUnitIds.length > 0 && !tUnitIds.includes(s.unitId)) continue;
          if (tShiftDefIds.length > 0 && (!s.shiftDefinitionId || !tShiftDefIds.includes(s.shiftDefinitionId))) continue;
          if (!userMatchesChecklistTemplate(t, userData)) continue;

          const execId = `${today}__${s.scheduleId}__${sDoc.id}__${tDoc.id}`;
          if (existingIds.has(execId)) { skipped++; continue; }
          existingIds.add(execId);
          created++;

          const sections = buildChecklistExecutionSections(t.sections as any[]);
          const items = (t.sections as any[]).flatMap((section) =>
            flattenChecklistItems(section.items ?? [], section)
          );

          batchItems.push({
            id: execId,
            data: {
              checklistDate: today,
              templateId: tDoc.id,
              templateName: t.name,
              templateType: t.templateType ?? 'routine',
              templateVersion: typeof t.version === 'number' ? t.version : 1,
              occurrenceType: typeof t.occurrenceType === 'string' ? t.occurrenceType : null,
              scheduleId: s.scheduleId,
              shiftId: sDoc.id,
              unitId: s.unitId,
              unitName: unitNames.get(s.unitId) ?? s.unitId,
              shiftDefinitionId: s.shiftDefinitionId ?? null,
              shiftDefinitionName: s.shiftDefinitionId ? shiftDefNames.get(s.shiftDefinitionId) ?? s.shiftDefinitionId : null,
              assignedUserId: s.userId,
              assignedUsername: userData.username || s.userId,
              sections,
              shiftStartTime: s.startTime,
              shiftEndTime: s.endTime,
              shiftEndDate: resolveShiftEndDate(today, s.startTime, s.endTime),
              status: 'pending',
              score: null,
              items,
              incidentContext: null,
              supplierName: null,
              invoiceNumber: null,
              scheduledDate: null,
              claimedByUserId: null,
              claimedByUsername: null,
              claimedAt: null,
              completedByUserId: null,
              completedByUsername: null,
              completedAt: null,
              reviewedBy: null,
              reviewNotes: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        }
      }

      for (let i = 0; i < batchItems.length; i += 400) {
        const batch = checklistDb.batch();
        batchItems.slice(i, i + 400).forEach((entry) => {
          batch.set(checklistDb.collection('checklistExecutions').doc(entry.id), entry.data);
        });
        await batch.commit();
      }
    }

    console.log(`[checklistDailyGenerate] Criadas: ${created}, já existentes: ${skipped}`);
  }
);

// --- Escalonamento automático de tarefas operacionais ---
export const checklistEscalateTasks = onSchedule(
  { schedule: '*/15 * * * *', timeZone: BRT, retryCount: 1, memory: '256MiB' },
  async () => {
    const now = new Date();
    const dueSnap = await checklistDb
      .collection('operationalTasks')
      .where('slaDeadlineAt', '<=', now)
      .get();

    const candidates = dueSnap.docs.filter((doc) => {
      const status = doc.data()?.status;
      return status === 'open' || status === 'in_progress';
    });

    if (candidates.length === 0) {
      console.log('[checklistEscalateTasks] Nenhuma tarefa vencida.');
      return;
    }

    for (let i = 0; i < candidates.length; i += 100) {
      const chunk = candidates.slice(i, i + 100);
      const nextRoleIds = await Promise.all(
        chunk.map(async (doc) => {
          const data = doc.data() ?? {};
          return resolveEscalationRoleIds(
            Array.isArray(data.assignedToRoleIds) ? data.assignedToRoleIds : []
          );
        })
      );

      const batch = checklistDb.batch();
      chunk.forEach((doc, index) => {
        batch.update(doc.ref, {
          status: 'escalated',
          assignedToRoleIds: nextRoleIds[index],
          escalatedAt: now,
          updatedAt: now,
        });
      });
      await batch.commit();
    }

    console.log(`[checklistEscalateTasks] ${candidates.length} tarefa(s) escalada(s).`);
  }
);

// --- Compras v2: expirar cotações vencidas ---
export const expireQuotations = onSchedule(
  { schedule: '30 0 * * *', timeZone: BRT, retryCount: 2, memory: '256MiB' },
  async () => {
    const today = getBrtDate(new Date());
    console.log(`[expireQuotations] Verificando cotações vencidas antes de ${today}`);

    const snap = await db.collection('quotations')
      .where('validUntil', '<', today)
      .where('status', 'in', ['quoted', 'partially_converted'])
      .get();

    if (snap.empty) {
      console.log('[expireQuotations] Nenhuma cotação para expirar.');
      return;
    }

    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach((docSnap) => {
        batch.update(docSnap.ref, {
          status: 'expired',
          updatedAt: new Date().toISOString(),
        });
      });
      await batch.commit();
    }

    console.log(`[expireQuotations] ${snap.docs.length} cotação(ões) expirada(s).`);
  }
);

// --- Compras v2: ao confirmar recebimento, refletir total e data no pedido ---
export const onReceiptStatusChange = onDocumentWritten(
  { document: 'purchase_receipts/{receiptId}', database: 'coala' },
  async (event: any) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;

    const confirmedStatuses = ['received', 'received_with_divergence'];
    const wasAlreadyConfirmed = confirmedStatuses.includes(before?.status ?? '');
    const isNowConfirmed = confirmedStatuses.includes(after.status ?? '');

    // Only act on the transition into a confirmed state
    if (wasAlreadyConfirmed || !isNowConfirmed) return;

    const purchaseOrderId: string | undefined = after.purchaseOrderId;
    if (!purchaseOrderId) return;

    try {
      const orderRef = db.collection('purchase_orders').doc(purchaseOrderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) return;

      await orderRef.update({
        totalConfirmed: after.totalConfirmed ?? null,
        receivedAt: after.receivedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      console.log(`[onReceiptStatusChange] Pedido ${purchaseOrderId} atualizado para ${after.status}.`);
    } catch (err) {
      console.error('[onReceiptStatusChange] Erro ao atualizar pedido:', err);
    }
  }
);

// --- Marcação automática de execuções em atraso ---
export const checklistMarkOverdue = onSchedule(
  { schedule: '*/15 * * * *', timeZone: BRT, retryCount: 1, memory: '256MiB' },
  async () => {
    const now = new Date();
    const formsEnabled = await isFormsEngineEnabled();
    console.log(`[checklistMarkOverdue] Verificando atrasos em ${now.toISOString()} — motor: ${formsEnabled ? 'forms' : 'legacy'}`);

    let totalMarked = 0;

    // Legacy checklistExecutions — always run (for in-progress executions during migration window)
    const legacySnap = await checklistDb
      .collection('checklistExecutions')
      .where('status', 'in', ['pending', 'claimed'])
      .get();

    const legacyToMark = legacySnap.docs.filter((doc) => {
      const data = doc.data();
      if (!data.shiftEndDate || !data.shiftEndTime) return false;
      return isShiftEnded(data.shiftEndDate as string, data.shiftEndTime as string, now);
    });

    for (let i = 0; i < legacyToMark.length; i += 400) {
      const batch = checklistDb.batch();
      legacyToMark.slice(i, i + 400).forEach((doc) => {
        batch.update(doc.ref, { status: 'overdue', updatedAt: new Date() });
      });
      await batch.commit();
    }
    totalMarked += legacyToMark.length;

    // New form_executions — only when forms engine is active
    if (formsEnabled) {
      const formsSnap = await checklistDb
        .collection('form_executions')
        .where('status', 'in', ['pending', 'in_progress'])
        .get();

      const formsToMark = formsSnap.docs.filter((doc) => {
        const data = doc.data();
        if (!data.shift_end_date || !data.shift_end_time) return false;
        return isShiftEnded(data.shift_end_date as string, data.shift_end_time as string, now);
      });

      for (let i = 0; i < formsToMark.length; i += 400) {
        const batch = checklistDb.batch();
        formsToMark.slice(i, i + 400).forEach((doc) => {
          batch.update(doc.ref, { status: 'overdue', updated_at: new Date() });
        });
        await batch.commit();
      }
      totalMarked += formsToMark.length;
    }

    if (totalMarked === 0) {
      console.log('[checklistMarkOverdue] Nenhuma execução em atraso.');
      return;
    }

    console.log(`[checklistMarkOverdue] ${totalMarked} execuções marcadas como overdue.`);
  }
);
