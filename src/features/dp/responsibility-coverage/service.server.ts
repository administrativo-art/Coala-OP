import 'server-only';

import { createHash } from 'node:crypto';
import { Filter, type DocumentSnapshot, type Query, type Transaction } from 'firebase-admin/firestore';

import { buildPermissionSet, type ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';
import type {
  DPAbsenceApprovalLevel,
  DPResponsibilityActivity,
  DPResponsibilityCoverage,
  DPResponsibilityScope,
  PermissionSet,
  User,
} from '@/types';
import { responsibilityCoverageStatus } from './model';
import { responsibilityLevelSchema, type SaveResponsibilityCoverageInput } from './schemas';

const coverageCollection = dbAdmin.collection('dp_responsibilityCoverages');
const taskCollection = dbAdmin.collection('dp_responsibilityTasks');
const notifications = dbAdmin.collection('userNotifications');
const COVERAGE_LIMIT = 300;
const SCOPE_LIMIT = 200;
const CANDIDATE_LIMIT = 20;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, safeMessage: string, kind: 'VALIDATION' | 'AUTHORIZATION' | 'CONFLICT' | 'NOT_FOUND' | 'DATA_INTEGRITY' = 'CONFLICT') =>
  new AppError({ code, safeMessage, kind });

export function responsibilityCoverageId(workspaceId: string, activity: DPResponsibilityActivity, scope: DPResponsibilityScope) {
  return hash(`${workspaceId}:${activity}:${scope.kind}:${scope.id}`);
}
export function responsibilityScopeKey(scope: DPResponsibilityScope) {
  return `${scope.kind}:${scope.id}`;
}
function activityPermission(permissions: PermissionSet, activity: DPResponsibilityActivity) {
  if (activity === 'schedules') return permissions.dp.schedules.edit === true;
  if (activity === 'vacations') return permissions.dp.vacation.approve === true;
  return permissions.dp.requests.review === true;
}
function canManageCoverage(actor: ServerUserContext) {
  return actor.isDefaultAdmin || actor.permissions.dp.responsibilities.manage === true;
}
function canReadCoverage(actor: ServerUserContext) {
  return canManageCoverage(actor);
}
type Reader = Transaction | null;

async function read(reader: Reader, reference: FirebaseFirestore.DocumentReference): Promise<DocumentSnapshot> {
  return reader ? reader.get(reference) : reference.get();
}
async function readQuery(reader: Reader, query: Query) {
  return reader ? reader.get(query) : query.get();
}
async function scopeUnitIds(reader: Reader, scope: DPResponsibilityScope) {
  if (scope.kind === 'unit') {
    const unit = await read(reader, dbAdmin.collection('dp_units').doc(scope.id));
    if (!unit.exists || unit.get('isArchived') === true) return [];
    return [unit.id];
  }
  const group = await read(reader, dbAdmin.collection('dp_unitGroups').doc(scope.id));
  if (!group.exists) return [];
  const units = await readQuery(reader, dbAdmin.collection('dp_units').where('groupId', '==', scope.id).limit(SCOPE_LIMIT + 1));
  if (units.size > SCOPE_LIMIT) throw fail('DP_RESPONSIBILITY_SCOPE_LIMIT', 'Há unidades demais neste grupo para validar a cobertura.', 'DATA_INTEGRITY');
  return units.docs.filter((unit) => unit.get('isArchived') !== true).map((unit) => unit.id);
}
type LevelDiagnostic = {
  level: number;
  candidateCount: number;
  eligibleCount: number;
  inactiveCount: number;
  missingPermissionCount: number;
  missingScopeCount: number;
  fallbackUsed: boolean;
  eligibleUserIds: string[];
};

export type ResponsibilityCoverageResolution = {
  configured: boolean;
  active: boolean;
  state: 'draft' | 'active';
  version: number;
  unitIds: string[];
  status: 'covered' | 'warning' | 'uncovered' | 'draft';
  effectiveLevel: number | null;
  eligibleUserIds: string[];
  diagnostics: LevelDiagnostic[];
  gapReason: 'not_configured' | 'draft' | 'empty_scope' | 'no_eligible_user' | null;
};

class CandidateDirectory {
  private candidateIds = new Map<string, Promise<string[]>>();
  private users = new Map<string, Promise<DocumentSnapshot>>();
  private profiles = new Map<string, Promise<DocumentSnapshot | null>>();

  constructor(private readonly reader: Reader) {}

  private ids(level: DPAbsenceApprovalLevel) {
    const key = JSON.stringify(level);
    const existing = this.candidateIds.get(key);
    if (existing) return existing;
    const pending = (async () => {
      if (level.kind === 'people') return [...new Set(level.personIds)];
      if (level.kind === 'function') {
        const [multi, legacy] = await Promise.all([
          readQuery(this.reader, dbAdmin.collection('users').where('jobFunctionIds', 'array-contains', level.functionId).limit(CANDIDATE_LIMIT + 1)),
          readQuery(this.reader, dbAdmin.collection('users').where('functionId', '==', level.functionId).limit(CANDIDATE_LIMIT + 1)),
        ]);
        const ids = [...new Set([...multi.docs, ...legacy.docs].map((document) => document.id))];
        if (ids.length > CANDIDATE_LIMIT) throw fail('DP_RESPONSIBILITY_CANDIDATE_LIMIT', 'Há pessoas demais em um nível da hierarquia.', 'DATA_INTEGRITY');
        return ids;
      }
      const snapshot = await readQuery(this.reader, dbAdmin.collection('users').where('jobRoleId', '==', level.jobRoleId).limit(CANDIDATE_LIMIT + 1));
      if (snapshot.size > CANDIDATE_LIMIT) throw fail('DP_RESPONSIBILITY_CANDIDATE_LIMIT', 'Há pessoas demais em um nível da hierarquia.', 'DATA_INTEGRITY');
      return snapshot.docs.map((document) => document.id);
    })();
    this.candidateIds.set(key, pending);
    return pending;
  }

  private user(uid: string) {
    const existing = this.users.get(uid);
    if (existing) return existing;
    const pending = read(this.reader, dbAdmin.collection('users').doc(uid));
    this.users.set(uid, pending);
    return pending;
  }

  private profile(profileId: string | null) {
    if (!profileId) return Promise.resolve(null);
    const existing = this.profiles.get(profileId);
    if (existing) return existing;
    const pending = read(this.reader, dbAdmin.collection('profiles').doc(profileId));
    this.profiles.set(profileId, pending);
    return pending;
  }

  async evaluate(level: DPAbsenceApprovalLevel, activity: DPResponsibilityActivity, unitIds: string[], levelIndex: number): Promise<LevelDiagnostic> {
    let ids = await this.ids(level);
    let fallbackUsed = false;
    let evaluated = await this.evaluateIds(ids, activity, unitIds, levelIndex, false);
    if (!evaluated.eligibleCount && level.kind === 'function' && level.fallbackJobRoleId) {
      fallbackUsed = true;
      ids = await this.ids({ kind: 'role', jobRoleId: level.fallbackJobRoleId });
      evaluated = await this.evaluateIds(ids, activity, unitIds, levelIndex, true);
    }
    return { ...evaluated, fallbackUsed };
  }

  private async evaluateIds(ids: string[], activity: DPResponsibilityActivity, unitIds: string[], level: number, fallbackUsed: boolean): Promise<LevelDiagnostic> {
    const unique = [...new Set(ids)].slice(0, CANDIDATE_LIMIT + 1);
    if (unique.length > CANDIDATE_LIMIT) throw fail('DP_RESPONSIBILITY_CANDIDATE_LIMIT', 'Há pessoas demais em um nível da hierarquia.', 'DATA_INTEGRITY');
    const documents = await Promise.all(unique.map((uid) => this.user(uid)));
    const result: LevelDiagnostic = { level, candidateCount: unique.length, eligibleCount: 0, inactiveCount: 0,
      missingPermissionCount: 0, missingScopeCount: 0, fallbackUsed, eligibleUserIds: [] };
    for (const document of documents) {
      if (!document.exists || document.get('isActive') !== true) {
        result.inactiveCount += 1;
        continue;
      }
      const user = { id: document.id, ...document.data() } as User;
      const profileId = typeof document.get('profileId') === 'string' ? String(document.get('profileId')) : null;
      const profile = await this.profile(profileId);
      const admin = profile?.get('isDefaultAdmin') === true;
      const permissions = buildPermissionSet(profile?.get('permissions'), admin);
      const hasPermission = admin || activityPermission(permissions, activity);
      const hasScope = unitIds.length > 0 && unitIds.every((unitId) => canAccessUnit(user, unitId, { isDefaultAdmin: admin }));
      if (!hasPermission) result.missingPermissionCount += 1;
      if (!hasScope) result.missingScopeCount += 1;
      if (hasPermission && hasScope) result.eligibleUserIds.push(document.id);
    }
    result.eligibleCount = result.eligibleUserIds.length;
    return result;
  }
}
function checkedCoverage(snapshot: DocumentSnapshot, workspaceId: string, activity: DPResponsibilityActivity, scope: DPResponsibilityScope) {
  if (!snapshot.exists) return null;
  const data = snapshot.data() as DPResponsibilityCoverage;
  if (data.workspaceId !== workspaceId || data.activity !== activity || data.scope?.kind !== scope.kind || data.scope?.id !== scope.id
    || !Number.isSafeInteger(data.version) || data.version < 1 || !['draft', 'active'].includes(data.state)
    || !Array.isArray(data.levels) || data.levels.length > 20
    || data.levels.some((level) => !responsibilityLevelSchema.safeParse(level).success)) {
    throw fail('DP_RESPONSIBILITY_CONFIG_INVALID', 'A configuração de cobertura está inconsistente.', 'DATA_INTEGRITY');
  }
  return data;
}
export async function resolveResponsibilityCoverage(params: {
  workspaceId: string;
  activity: DPResponsibilityActivity;
  scope: DPResponsibilityScope;
  reader?: Transaction;
  proposed?: Pick<DPResponsibilityCoverage, 'state' | 'levels' | 'version'>;
  directory?: CandidateDirectory;
}): Promise<ResponsibilityCoverageResolution> {
  const reader = params.reader ?? null;
  const ref = coverageCollection.doc(responsibilityCoverageId(params.workspaceId, params.activity, params.scope));
  const stored = params.proposed ? null : checkedCoverage(await read(reader, ref), params.workspaceId, params.activity, params.scope);
  const config = params.proposed ?? stored;
  const unitIds = await scopeUnitIds(reader, params.scope);
  if (!config) return { configured: false, active: false, state: 'draft', version: 0, unitIds,
    status: 'draft', effectiveLevel: null, eligibleUserIds: [], diagnostics: [], gapReason: 'not_configured' };
  const directory = params.directory ?? new CandidateDirectory(reader);
  const diagnostics: LevelDiagnostic[] = [];
  for (let index = 0; index < config.levels.length; index += 1) {
    diagnostics.push(await directory.evaluate(config.levels[index], params.activity, unitIds, index));
  }
  const effective = diagnostics.find((entry) => entry.eligibleCount > 0);
  const active = config.state === 'active';
  const invalidConfiguredLevelCount = effective
    ? diagnostics.slice(0, effective.level).filter((entry) => entry.eligibleCount === 0).length
    : diagnostics.filter((entry) => entry.eligibleCount === 0).length;
  const status = responsibilityCoverageStatus({ configured: true, active,
    eligibleCount: effective?.eligibleCount ?? 0, invalidConfiguredLevelCount });
  return { configured: true, active, state: config.state, version: config.version, unitIds, status,
    effectiveLevel: effective?.level ?? null, eligibleUserIds: effective?.eligibleUserIds ?? [], diagnostics,
    gapReason: !active ? 'draft' : !unitIds.length ? 'empty_scope' : !effective ? 'no_eligible_user' : null };
}

export async function listResponsibilityCoverages(actor: ServerUserContext, activity?: DPResponsibilityActivity) {
  if (!canReadCoverage(actor)) throw fail('DP_RESPONSIBILITY_READ_FORBIDDEN', 'Sem permissão para consultar as coberturas.', 'AUTHORIZATION');
  const [groups, units, configs] = await Promise.all([
    dbAdmin.collection('dp_unitGroups').orderBy('name').limit(SCOPE_LIMIT + 1).get(),
    dbAdmin.collection('dp_units').orderBy('name').limit(500 + 1).get(),
    (() => {
      let query: Query = coverageCollection.where('workspaceId', '==', actor.workspace_id);
      if (activity) query = query.where('activity', '==', activity);
      return query.limit(COVERAGE_LIMIT + 1).get();
    })(),
  ]);
  if (groups.size > SCOPE_LIMIT || units.size > 500 || configs.size > COVERAGE_LIMIT) {
    throw fail('DP_RESPONSIBILITY_LIST_LIMIT', 'Há registros demais para carregar o painel de cobertura.', 'DATA_INTEGRITY');
  }
  const allUnits = units.docs.filter((unit) => unit.get('isArchived') !== true);
  const scopes: Array<{ scope: DPResponsibilityScope; name: string; unitIds: string[] }> = [
    ...groups.docs.map((group) => ({ scope: { kind: 'unit_group' as const, id: group.id },
      name: String(group.get('name') ?? 'Grupo sem nome'), unitIds: allUnits.filter((unit) => unit.get('groupId') === group.id).map((unit) => unit.id) })),
    ...allUnits.filter((unit) => typeof unit.get('groupId') !== 'string' || !unit.get('groupId'))
      .map((unit) => ({ scope: { kind: 'unit' as const, id: unit.id }, name: `${String(unit.get('name') ?? 'Unidade')} · sem grupo`, unitIds: [unit.id] })),
  ].filter((entry) => entry.unitIds.every((unitId) => canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin })));
  const activities: DPResponsibilityActivity[] = activity ? [activity] : ['schedules', 'vacations', 'absences'];
  const configById = new Map(configs.docs.map((document) => [document.id, document]));
  const directory = new CandidateDirectory(null);
  const rows = [];
  for (const entry of scopes) {
    for (const currentActivity of activities) {
      const id = responsibilityCoverageId(actor.workspace_id, currentActivity, entry.scope);
      const config = checkedCoverage(configById.get(id) ?? ({ exists: false } as DocumentSnapshot), actor.workspace_id, currentActivity, entry.scope);
      const resolution = await resolveResponsibilityCoverage({ workspaceId: actor.workspace_id, activity: currentActivity,
        scope: entry.scope, proposed: config ? { state: config.state, levels: config.levels, version: config.version } : undefined, directory });
      rows.push({ id, activity: currentActivity, scope: entry.scope, scopeName: entry.name, unitCount: entry.unitIds.length,
        levels: config?.levels ?? [], state: config?.state ?? 'draft', version: config?.version ?? 0,
        status: resolution.status, effectiveLevel: resolution.effectiveLevel,
        eligibleUserIds: resolution.eligibleUserIds, diagnostics: resolution.diagnostics, gapReason: resolution.gapReason });
    }
  }
  return rows;
}

async function gapAlertRecipients(reader: Transaction) {
  const profiles = await reader.get(dbAdmin.collection('profiles').where(Filter.or(
    Filter.where('permissions.dp.responsibilities.receiveUnassignedAlerts', '==', true),
    Filter.where('isDefaultAdmin', '==', true),
  )).limit(CANDIDATE_LIMIT + 1));
  if (profiles.size > CANDIDATE_LIMIT) throw fail('DP_RESPONSIBILITY_ALERT_LIMIT', 'Há perfis demais configurados para o alerta de cobertura.', 'DATA_INTEGRITY');
  const profileIds = profiles.docs.map((profile) => profile.id);
  if (!profileIds.length) return [];
  const users = await reader.get(dbAdmin.collection('users').where('profileId', 'in', profileIds).limit(CANDIDATE_LIMIT + 1));
  if (users.size > CANDIDATE_LIMIT) throw fail('DP_RESPONSIBILITY_ALERT_LIMIT', 'Há destinatários demais para o alerta de cobertura.', 'DATA_INTEGRITY');
  return users.docs.filter((user) => user.get('isActive') === true).map((user) => user.id);
}

function taskNotificationId(taskId: string, version: number, uid: string, kind: string) {
  return hash(`${taskId}:${version}:${uid}:${kind}`);
}

function writeTaskNotifications(tx: Transaction, task: FirebaseFirestore.DocumentSnapshot, recipients: string[], kind: 'assigned' | 'unassigned') {
  const nextVersion = Number(task.get('version')) + 1;
  for (const uid of recipients) {
    const ref = notifications.doc(taskNotificationId(task.id, nextVersion, uid, kind));
    tx.create(ref, { ownerUid: uid, workspaceId: task.get('workspaceId'), sourceEventId: `responsibility:${task.id}:${nextVersion}`,
      eventId: hash(`${task.id}:${nextVersion}:${uid}`).slice(0, 32), title: 'Coala',
      body: kind === 'assigned' ? 'Há uma escala para recompor após uma ausência.' : 'Há uma pendência do DP sem responsável configurado.',
      path: '/dashboard/dp/requests?responsibility=schedules', readAt: null, createdAt: new Date().toISOString() });
  }
}

export async function saveResponsibilityCoverage(actor: ServerUserContext, input: SaveResponsibilityCoverageInput) {
  if (!canManageCoverage(actor)) throw fail('DP_RESPONSIBILITY_MANAGE_FORBIDDEN', 'Sem permissão para administrar as coberturas.', 'AUTHORIZATION');
  const id = responsibilityCoverageId(actor.workspace_id, input.activity, input.scope);
  const ref = coverageCollection.doc(id);
  const result = await dbAdmin.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const currentVersion = current.exists ? Number(current.get('version')) : 0;
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) throw fail('DP_RESPONSIBILITY_CONFIG_INVALID', 'A versão da cobertura está inconsistente.', 'DATA_INTEGRITY');
    const operationHash = hash(JSON.stringify(input));
    if (current.get('lastOperationId') === input.operationId) {
      if (current.get('lastOperationActorUid') !== actor.decoded.uid || current.get('lastOperationHash') !== operationHash) {
        throw fail('DP_RESPONSIBILITY_IDEMPOTENCY_CONFLICT', 'A repetição da operação não corresponde à alteração original.');
      }
      return { id, version: currentVersion, repeated: true };
    }
    if (currentVersion !== input.expectedVersion) throw fail('DP_RESPONSIBILITY_VERSION_CONFLICT', 'A cobertura foi alterada. Atualize o painel e tente novamente.');
    const proposedVersion = currentVersion + 1;
    const resolution = await resolveResponsibilityCoverage({ workspaceId: actor.workspace_id, activity: input.activity,
      scope: input.scope, reader: tx, proposed: { state: input.state, levels: input.levels, version: proposedVersion } });
    if (input.state === 'active' && !resolution.unitIds.length) throw fail('DP_RESPONSIBILITY_EMPTY_SCOPE', 'Vincule ao menos uma unidade antes de ativar esta cobertura.', 'VALIDATION');
    if (!resolution.unitIds.every((unitId) => canAccessUnit(actor.userDoc, unitId, { isDefaultAdmin: actor.isDefaultAdmin }))) {
      throw fail('DP_RESPONSIBILITY_SCOPE_FORBIDDEN', 'Sem abrangência para administrar este grupo.', 'AUTHORIZATION');
    }
    if (input.state === 'active' && !resolution.eligibleUserIds.length) {
      throw fail('DP_RESPONSIBILITY_CANNOT_ACTIVATE', 'Nenhuma pessoa possui, ao mesmo tempo, a permissão e a abrangência necessárias.');
    }
    if (current.exists && current.get('state') === 'active' && input.state !== 'active') {
      throw fail('DP_RESPONSIBILITY_LAST_COVERAGE', 'Defina e ative uma cobertura substituta antes de retirar a cobertura atual.');
    }
    const pendingTasks = await tx.get(taskCollection.where('workspaceId', '==', actor.workspace_id)
      .where('activity', '==', input.activity).where('scopeKey', '==', responsibilityScopeKey(input.scope))
      .where('status', 'in', ['unassigned', 'pending']).limit(51));
    if (pendingTasks.size > 50) throw fail('DP_RESPONSIBILITY_TASK_LIMIT', 'Há tarefas demais aguardando reencaminhamento.', 'DATA_INTEGRITY');
    const now = new Date().toISOString();
    const payload = { id, workspaceId: actor.workspace_id, activity: input.activity, scope: input.scope,
      scopeKey: responsibilityScopeKey(input.scope), levels: input.levels, state: input.state,
      version: proposedVersion, createdAt: current.exists ? current.get('createdAt') : now,
      createdBy: current.exists ? current.get('createdBy') : actor.decoded.uid,
      updatedAt: now, updatedBy: actor.decoded.uid, lastOperationId: input.operationId,
      lastOperationActorUid: actor.decoded.uid, lastOperationHash: operationHash };
    tx.set(ref, payload);
    tx.create(dbAdmin.collection('dp_responsibilityCoverageAudit').doc(`${id}_${proposedVersion}`), {
      workspaceId: actor.workspace_id, coverageId: id, activity: input.activity, scope: input.scope,
      version: proposedVersion, state: input.state, levels: input.levels, actorUid: actor.decoded.uid, at: now,
    });
    const gapRecipients = resolution.eligibleUserIds.length ? [] : await gapAlertRecipients(tx);
    for (const task of pendingTasks.docs) {
      const assigned = resolution.eligibleUserIds;
      const status = assigned.length ? 'pending' : 'unassigned';
      tx.update(task.ref, { assignedUserIds: assigned, assignedLevel: resolution.effectiveLevel,
        status, coverageVersion: proposedVersion, version: Number(task.get('version')) + 1, updatedAt: now });
      const previous = Array.isArray(task.get('assignedUserIds')) ? task.get('assignedUserIds') as string[] : [];
      const newRecipients = assigned.filter((uid) => !previous.includes(uid));
      writeTaskNotifications(tx, task, assigned.length ? newRecipients : gapRecipients, assigned.length ? 'assigned' : 'unassigned');
    }
    return { id, version: proposedVersion, repeated: false, resolution };
  });
  return result;
}

export async function resolveOperationalResponsibility(params: {
  transaction: Transaction;
  workspaceId: string;
  activity: DPResponsibilityActivity;
  unitId: string;
}) {
  const unit = await params.transaction.get(dbAdmin.collection('dp_units').doc(params.unitId));
  if (!unit.exists || unit.get('isArchived') === true) throw fail('DP_RESPONSIBILITY_UNIT_INVALID', 'A unidade da tarefa está indisponível.', 'DATA_INTEGRITY');
  const groupId = typeof unit.get('groupId') === 'string' && unit.get('groupId') ? String(unit.get('groupId')) : null;
  const scope: DPResponsibilityScope = groupId ? { kind: 'unit_group', id: groupId } : { kind: 'unit', id: params.unitId };
  const resolution = await resolveResponsibilityCoverage({ workspaceId: params.workspaceId, activity: params.activity,
    scope, reader: params.transaction });
  return { scope, resolution };
}

export async function resolveGapAlertRecipients(transaction: Transaction) {
  return gapAlertRecipients(transaction);
}

export function createResponsibilityTaskNotifications(transaction: Transaction, input: {
  taskId: string;
  taskVersion: number;
  workspaceId: string;
  recipients: string[];
  unassigned: boolean;
}) {
  for (const uid of input.recipients) {
    transaction.create(notifications.doc(taskNotificationId(input.taskId, input.taskVersion, uid,
      input.unassigned ? 'unassigned' : 'assigned')), {
      ownerUid: uid, workspaceId: input.workspaceId,
      sourceEventId: `responsibility:${input.taskId}:${input.taskVersion}`,
      eventId: hash(`${input.taskId}:${input.taskVersion}:${uid}`).slice(0, 32), title: 'Coala',
      body: input.unassigned ? 'Há uma pendência do DP sem responsável configurado.' : 'Há uma escala para recompor após uma ausência.',
      path: '/dashboard/dp/requests?responsibility=schedules', readAt: null, createdAt: new Date().toISOString(),
    });
  }
}
