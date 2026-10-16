import { createHash } from 'node:crypto';
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';

type Activity = 'schedules' | 'vacations' | 'absences';
type Scope = { kind: 'unit_group' | 'unit'; id: string };
type Level = { kind: 'people'; personIds: string[] }
  | { kind: 'function'; functionId: string; fallbackJobRoleId?: string }
  | { kind: 'role'; jobRoleId: string };

const MAX_TASKS_PER_RUN = 500;
const MAX_CANDIDATES = 20;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function coverageId(workspaceId: string, activity: Activity, scope: Scope) {
  return hash(`${workspaceId}:${activity}:${scope.kind}:${scope.id}`);
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
}

function canAccessEveryUnit(user: FirebaseFirestore.DocumentSnapshot, unitIds: string[], isDefaultAdmin: boolean) {
  if (isDefaultAdmin || user.get('unitAccessScope') === 'all') return true;
  const accessible = user.get('unitAccessScope') === 'selected'
    ? strings(user.get('unitAccessUnitIds'))
    : [...strings(user.get('unitIds')), ...strings(user.get('assignedKioskIds'))];
  const allowed = new Set(accessible);
  return unitIds.length > 0 && unitIds.every((unitId) => allowed.has(unitId));
}

function hasActivityPermission(profile: FirebaseFirestore.DocumentSnapshot | null, activity: Activity) {
  if (profile?.get('isDefaultAdmin') === true) return true;
  if (activity === 'schedules') return profile?.get('permissions.dp.schedules.edit') === true;
  if (activity === 'vacations') return profile?.get('permissions.dp.vacation.approve') === true;
  return profile?.get('permissions.dp.requests.review') === true;
}

async function unitIdsForScope(db: Firestore, scope: Scope) {
  if (scope.kind === 'unit') {
    const unit = await db.collection('dp_units').doc(scope.id).get();
    return unit.exists && unit.get('isArchived') !== true ? [unit.id] : [];
  }
  const units = await db.collection('dp_units').where('groupId', '==', scope.id).limit(201).get();
  if (units.size > 200) throw new Error('DP_RESPONSIBILITY_SCOPE_LIMIT');
  return units.docs.filter((unit) => unit.get('isArchived') !== true).map((unit) => unit.id);
}

async function candidateIds(db: Firestore, level: Level) {
  if (level.kind === 'people') return [...new Set(level.personIds)].slice(0, MAX_CANDIDATES + 1);
  if (level.kind === 'function') {
    const [multi, legacy] = await Promise.all([
      db.collection('users').where('jobFunctionIds', 'array-contains', level.functionId).limit(MAX_CANDIDATES + 1).get(),
      db.collection('users').where('functionId', '==', level.functionId).limit(MAX_CANDIDATES + 1).get(),
    ]);
    return [...new Set([...multi.docs, ...legacy.docs].map((user) => user.id))];
  }
  const snapshot = await db.collection('users').where('jobRoleId', '==', level.jobRoleId).limit(MAX_CANDIDATES + 1).get();
  return snapshot.docs.map((user) => user.id);
}

async function eligibleForLevel(db: Firestore, level: Level, activity: Activity, unitIds: string[]) {
  const ids = await candidateIds(db, level);
  if (ids.length > MAX_CANDIDATES) throw new Error('DP_RESPONSIBILITY_CANDIDATE_LIMIT');
  if (!ids.length) return [];
  const users = await db.getAll(...ids.map((uid) => db.collection('users').doc(uid)));
  const result: string[] = [];
  for (const user of users) {
    if (!user.exists || user.get('isActive') !== true) continue;
    const profileId = typeof user.get('profileId') === 'string' ? String(user.get('profileId')) : '';
    const profile = profileId ? await db.collection('profiles').doc(profileId).get() : null;
    const admin = profile?.get('isDefaultAdmin') === true;
    if (hasActivityPermission(profile, activity) && canAccessEveryUnit(user, unitIds, admin)) result.push(user.id);
  }
  return result;
}

async function resolveCoverage(db: Firestore, workspaceId: string, activity: Activity, scope: Scope) {
  const config = await db.collection('dp_responsibilityCoverages').doc(coverageId(workspaceId, activity, scope)).get();
  const unitIds = await unitIdsForScope(db, scope);
  if (!config.exists || config.get('state') !== 'active' || !Array.isArray(config.get('levels')) || !unitIds.length) {
    return { eligibleUserIds: [] as string[], level: null as number | null, version: config.exists ? Number(config.get('version')) : 0 };
  }
  const levels = config.get('levels') as Level[];
  for (let index = 0; index < levels.length; index += 1) {
    let eligible = await eligibleForLevel(db, levels[index], activity, unitIds);
    const level = levels[index];
    if (!eligible.length && level.kind === 'function' && level.fallbackJobRoleId) {
      eligible = await eligibleForLevel(db, { kind: 'role', jobRoleId: level.fallbackJobRoleId }, activity, unitIds);
    }
    if (eligible.length) return { eligibleUserIds: eligible, level: index, version: Number(config.get('version')) };
  }
  return { eligibleUserIds: [] as string[], level: null as number | null, version: Number(config.get('version')) };
}

async function gapRecipients(db: Firestore) {
  const [alertProfiles, admins] = await Promise.all([
    db.collection('profiles').where('permissions.dp.responsibilities.receiveUnassignedAlerts', '==', true).limit(21).get(),
    db.collection('profiles').where('isDefaultAdmin', '==', true).limit(21).get(),
  ]);
  if (alertProfiles.size > 20 || admins.size > 20) throw new Error('DP_RESPONSIBILITY_ALERT_LIMIT');
  const profileIds = [...new Set([...alertProfiles.docs, ...admins.docs].map((profile) => profile.id))];
  if (profileIds.length > 30) throw new Error('DP_RESPONSIBILITY_ALERT_LIMIT');
  if (!profileIds.length) return [];
  const users = await db.collection('users').where('profileId', 'in', profileIds.slice(0, 30)).limit(21).get();
  if (users.size > 20) throw new Error('DP_RESPONSIBILITY_ALERT_LIMIT');
  return users.docs.filter((user) => user.get('isActive') === true).map((user) => user.id);
}

async function reconcileTask(db: Firestore, task: FirebaseFirestore.DocumentSnapshot, reason: string) {
  const activity = task.get('activity') as Activity;
  const scope = task.get('scope') as Scope;
  if (!['schedules', 'vacations', 'absences'].includes(activity) || !scope?.id
    || !['unit', 'unit_group'].includes(scope.kind)) return;
  const resolution = await resolveCoverage(db, String(task.get('workspaceId')), activity, scope);
  const previous = strings(task.get('assignedUserIds'));
  const claimedBy = typeof task.get('claimedByUid') === 'string' ? String(task.get('claimedByUid')) : null;
  const preserveClaim = task.get('status') === 'claimed' && claimedBy && resolution.eligibleUserIds.includes(claimedBy);
  const status = preserveClaim ? 'claimed' : resolution.eligibleUserIds.length ? 'pending' : 'unassigned';
  if (status === task.get('status') && previous.length === resolution.eligibleUserIds.length
    && previous.every((uid) => resolution.eligibleUserIds.includes(uid))
    && Number(task.get('coverageVersion') ?? 0) === resolution.version) return;
  const gapUsers = resolution.eligibleUserIds.length ? [] : await gapRecipients(db);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(task.ref);
    if (!current.exists || current.get('version') !== task.get('version')
      || !['unassigned', 'pending', 'claimed'].includes(String(current.get('status')))) return;
    const version = Number(current.get('version')) + 1;
    const at = new Date().toISOString();
    transaction.update(task.ref, { assignedUserIds: resolution.eligibleUserIds, assignedLevel: resolution.level,
      coverageVersion: resolution.version, status, version, updatedAt: at,
      ...(preserveClaim ? {} : { claimedByUid: FieldValue.delete(), claimedAt: FieldValue.delete() }) });
    transaction.create(db.collection('dp_responsibilityTaskAudit').doc(`${task.id}_${version}`), {
      workspaceId: current.get('workspaceId'), taskId: task.id, version,
      action: 'automatically_rerouted', reason, actorUid: 'system', at,
    });
    const recipients = resolution.eligibleUserIds.length
      ? resolution.eligibleUserIds.filter((uid) => !previous.includes(uid)) : gapUsers;
    recipients.forEach((uid) => {
      const kind = resolution.eligibleUserIds.length ? 'assigned' : 'unassigned';
      transaction.create(db.collection('userNotifications').doc(hash(`${task.id}:${version}:${uid}:${kind}`)), {
        ownerUid: uid, workspaceId: current.get('workspaceId'),
        sourceEventId: `responsibility:${task.id}:${version}`,
        eventId: hash(`${task.id}:${version}:${uid}`).slice(0, 32), title: 'Coala',
        body: kind === 'assigned' ? 'Há uma escala para recompor após uma ausência.' : 'Há uma pendência do DP sem responsável configurado.',
        path: '/dashboard/dp/requests?responsibility=schedules', readAt: null, createdAt: at,
      });
    });
  });
}

export async function reconcileOpenResponsibilityTasks(db: Firestore, reason: string) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let processed = 0;
  while (processed < MAX_TASKS_PER_RUN) {
    let query = db.collection('dp_responsibilityTasks')
      .where('status', 'in', ['unassigned', 'pending', 'claimed'])
      .orderBy(FieldPath.documentId()).limit(Math.min(100, MAX_TASKS_PER_RUN - processed));
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const task of page.docs) await reconcileTask(db, task, reason);
    processed += page.size;
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 100) return { processed, truncated: false };
  }
  await db.collection('dp_responsibilityDiagnostics').doc('open-task-reconciliation').set({
    status: 'truncated', processed, reason, updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { processed, truncated: true };
}
