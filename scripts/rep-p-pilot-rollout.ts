import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

import { publishEmploymentReference } from '../src/features/dp/employment-reference/service.server';
import { saveWorkShift } from '../src/features/dp/shifts/service.server';
import type { ServerUserContext } from '../src/lib/auth-server';
import { dbAdmin } from '../src/lib/firebase-admin';
import { defaultAdminPermissions } from '../src/types';

const WORKSPACE_ID = 'coala';
const PROFILE_ID = 'dQhpg5anASDl8AwDA1TM';
const EMPLOYER_UNIT_ID = 'pvLHa7BtW826JmhMkTJA';
const PILOT_TIME_ZONE = 'America/Fortaleza';
const MISSING_TIME_ZONE = Symbol('campo timeZone ausente');
const UNIT_TIME_ZONE_PLAN = {
  WRyOCQrPPQIn4wJJTXaQ: { from: MISSING_TIME_ZONE, to: PILOT_TIME_ZONE },
  pvLHa7BtW826JmhMkTJA: { from: MISSING_TIME_ZONE, to: PILOT_TIME_ZONE },
  bBIkV8wIXfEz4CuO1F2e: { from: MISSING_TIME_ZONE, to: PILOT_TIME_ZONE },
  kPRLQ14F7XpzSLUFXGyO: { from: MISSING_TIME_ZONE, to: PILOT_TIME_ZONE },
} as const;
const LUIS_SHIFT_DEFINITION_ID = 'K8IVPQGVG271NIyzV8gV';
const LUIS_SCHEDULE_ID = '2026-10--pvLHa7BtW826JmhMkTJA';
const LUIS_SHIFT_ID = 'rep-p-pilot-luis-2026-10-22';
const ACTOR_ID = 'system:rep-p-pilot-rollout-20261022';

const participants = {
  heucilene: {
    uid: 'fvrLOh1JOIOtU5QhZQZydN3UBf22',
    validFrom: '2022-05-10',
    unitIds: ['WRyOCQrPPQIn4wJJTXaQ', EMPLOYER_UNIT_ID, 'bBIkV8wIXfEz4CuO1F2e', 'kPRLQ14F7XpzSLUFXGyO'],
    sourceDocumentId: '01b7f018de327c04c981fdc49dcd84bb',
    sourceReason: 'Contracheque validado identifica CT Sorvetes LTDA, CNPJ 14.276.603/0001-25; fotografia inicial para ensaio nominal.',
  },
  luis: {
    uid: 'SShCdcgzs0ZkRrlTXpW0IZp4ABu2',
    validFrom: '2026-10-22',
    unitIds: [EMPLOYER_UNIT_ID],
    sourceDocumentId: 'pilot_user_authorized_20261022',
    sourceReason: 'Identidade de teste autorizada pelo programador para ensaio nominal; não constitui documento trabalhista.',
  },
} as const;

const unitIds = [...new Set(Object.values(participants).flatMap((participant) => participant.unitIds))];
const apply = process.argv.includes('--apply');
const headId = (uid: string) => createHash('sha256').update(JSON.stringify([WORKSPACE_ID, uid])).digest('hex');
function unitTimeZone(unit: FirebaseFirestore.DocumentSnapshot) {
  const data = unit.data();
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'timeZone')) return MISSING_TIME_ZONE;
  return data.timeZone as unknown;
}
function displayTimeZone(value: unknown) {
  return value === MISSING_TIME_ZONE ? 'field-absent' : value;
}
function assertPlannedUnitTimeZone(unit: FirebaseFirestore.DocumentSnapshot) {
  const plan = UNIT_TIME_ZONE_PLAN[unit.id as keyof typeof UNIT_TIME_ZONE_PLAN];
  if (!plan) throw new Error(`Unidade ${unit.id} não consta no plano nominal de fuso.`);
  const current = unitTimeZone(unit);
  if (current !== plan.from && current !== plan.to) {
    const observed = current === MISSING_TIME_ZONE ? 'campo ausente' : JSON.stringify(current);
    throw new Error(`O fuso da unidade ${unit.id} mudou para ${observed}; revisão manual necessária.`);
  }
  return { current, plan };
}

function assertSameDocumentVersion(
  label: string,
  inspected: FirebaseFirestore.DocumentSnapshot,
  current: FirebaseFirestore.DocumentSnapshot,
) {
  const inspectedVersion = inspected.updateTime;
  const currentVersion = current.updateTime;
  if (inspected.exists !== current.exists
    || !inspectedVersion || !currentVersion
    || !inspectedVersion.isEqual(currentVersion)) {
    throw new Error(`${label} mudou depois da inspeção; execute novo dry-run antes de aplicar.`);
  }
}

function assertSameQueryVersions(
  label: string,
  inspected: FirebaseFirestore.QueryDocumentSnapshot[],
  current: FirebaseFirestore.QueryDocumentSnapshot[],
) {
  const inspectedById = new Map(inspected.map((document) => [document.id, document]));
  if (inspectedById.size !== current.length) {
    throw new Error(`${label} mudou depois da inspeção; execute novo dry-run antes de aplicar.`);
  }
  for (const document of current) {
    const inspectedDocument = inspectedById.get(document.id);
    if (!inspectedDocument) {
      throw new Error(`${label} mudou depois da inspeção; execute novo dry-run antes de aplicar.`);
    }
    assertSameDocumentVersion(`${label}/${document.id}`, inspectedDocument, document);
  }
}

const context = {
  decoded: { uid: ACTOR_ID },
  userDoc: { id: ACTOR_ID, username: 'Implantação controlada do REP-P', unitIds: [], isActive: true },
  profileId: null,
  permissions: structuredClone(defaultAdminPermissions),
  isDefaultAdmin: true,
  workspace_id: WORKSPACE_ID,
} as unknown as ServerUserContext;

async function inspect() {
  const [profile, users, units, shiftDefinition, schedule, profileMembers] = await Promise.all([
    dbAdmin.collection('profiles').doc(PROFILE_ID).get(),
    dbAdmin.getAll(...Object.values(participants).map((participant) => dbAdmin.collection('users').doc(participant.uid))),
    dbAdmin.getAll(...unitIds.map((unitId) => dbAdmin.collection('dp_units').doc(unitId))),
    dbAdmin.collection('dp_shiftDefinitions').doc(LUIS_SHIFT_DEFINITION_ID).get(),
    dbAdmin.collection('dp_schedules').doc(LUIS_SCHEDULE_ID).get(),
    dbAdmin.collection('users').where('profileId', '==', PROFILE_ID).get(),
  ]);
  if (!profile.exists || profile.get('name') !== 'Líder de quiosque') throw new Error('Perfil nominal esperado não foi encontrado.');
  if (users.some((user) => !user.exists || user.get('isActive') === false)) throw new Error('Participante ausente ou inativo.');
  if (units.some((unit) => !unit.exists || unit.get('isArchived') === true)) throw new Error('Unidade do piloto ausente ou arquivada.');
  if (unitIds.length !== Object.keys(UNIT_TIME_ZONE_PLAN).length
    || unitIds.some((unitId) => !(unitId in UNIT_TIME_ZONE_PLAN))) {
    throw new Error('As unidades dos participantes divergiram do plano nominal de fuso.');
  }
  units.forEach(assertPlannedUnitTimeZone);
  if (String(units.find((unit) => unit.id === EMPLOYER_UNIT_ID)?.get('cnpj') ?? '').replace(/\D/g, '') !== '14276603000125') {
    throw new Error('A unidade empregadora não corresponde ao CNPJ confirmado nos contracheques.');
  }
  if (!shiftDefinition.exists || shiftDefinition.get('isArchived') === true
    || shiftDefinition.get('startTime') !== '09:00' || shiftDefinition.get('endTime') !== '18:00') {
    throw new Error('O turno existente de líder mudou; revisão manual necessária.');
  }
  if (!schedule.exists || schedule.get('locked') === true || schedule.get('unitId') !== EMPLOYER_UNIT_ID) {
    throw new Error('A escala de outubro da unidade empregadora não está disponível para o turno de teste.');
  }
  const activeMembers = profileMembers.docs.filter((user) => user.get('isActive') !== false).map((user) => user.id).sort();
  const expectedMembers = Object.values(participants).map((participant) => participant.uid).sort();
  if (JSON.stringify(activeMembers) !== JSON.stringify(expectedMembers)) {
    throw new Error(`O perfil deixou de ser nominal: membros ativos ${activeMembers.join(', ')}.`);
  }
  return { profile, users, units, shiftDefinition, schedule, profileMembers: profileMembers.docs, activeMembers };
}

async function publishReferences(state: Awaited<ReturnType<typeof inspect>>) {
  for (const participant of Object.values(participants)) {
    const user = state.users.find((item) => item.id === participant.uid)!;
    const head = await dbAdmin.collection('dp_employmentReferenceHeads').doc(headId(participant.uid)).get();
    await publishEmploymentReference(context, {
      userId: participant.uid,
      expectedRevision: head.exists ? Number(head.get('revision')) : 0,
      requestId: `rep_p_pilot_20261022_${participant.uid}`,
      periods: [{
        validFrom: participant.validFrom,
        employmentRelationshipType: 'clt',
        employerUnitId: EMPLOYER_UNIT_ID,
        unitId: EMPLOYER_UNIT_ID,
        unitIds: [...participant.unitIds],
        jobRoleId: String(user.get('jobRoleId')),
        jobFunctionIds: Array.isArray(user.get('jobFunctionIds')) ? user.get('jobFunctionIds') : [],
        sourceDocumentId: participant.sourceDocumentId,
        sourceReason: participant.sourceReason,
      }],
    });
  }
}

async function configureCatalog(state: Awaited<ReturnType<typeof inspect>>) {
  await dbAdmin.runTransaction(async (transaction) => {
    // Todas as leituras precedem as escritas. Qualquer mudança após a inspeção aborta o rollout.
    const currentProfile = await transaction.get(state.profile.ref);
    const currentUsers = await transaction.getAll(...state.users.map((user) => user.ref));
    const currentUnits = await transaction.getAll(...state.units.map((unit) => unit.ref));
    const currentShiftDefinition = await transaction.get(state.shiftDefinition.ref);
    const currentSchedule = await transaction.get(state.schedule.ref);
    const currentProfileMembers = await transaction.get(dbAdmin.collection('users').where('profileId', '==', PROFILE_ID));

    assertSameDocumentVersion('Perfil nominal', state.profile, currentProfile);
    state.users.forEach((user, index) => assertSameDocumentVersion(`Participante ${user.id}`, user, currentUsers[index]!));
    state.units.forEach((unit, index) => assertSameDocumentVersion(`Unidade ${unit.id}`, unit, currentUnits[index]!));
    assertSameDocumentVersion('Definição de turno de Luis', state.shiftDefinition, currentShiftDefinition);
    assertSameDocumentVersion('Escala de Luis', state.schedule, currentSchedule);
    assertSameQueryVersions('Membros do perfil nominal', state.profileMembers, currentProfileMembers.docs);

    const timeZoneChanges: Array<{ unitId: string; from: 'field-absent'; to: string }> = [];
    for (const unit of currentUnits) {
      const { current, plan } = assertPlannedUnitTimeZone(unit);
      if (current === plan.from) {
        transaction.update(unit.ref, { timeZone: plan.to, updatedAt: Timestamp.now() });
        timeZoneChanges.push({ unitId: unit.id, from: 'field-absent', to: plan.to });
      }
    }
    transaction.update(currentProfile.ref, { 'permissions.app.timeRecording.mark': true, updatedAt: Timestamp.now() });
    for (const user of currentUsers) transaction.update(user.ref, {
      employerUnitId: EMPLOYER_UNIT_ID,
      employmentRelationshipType: 'clt',
      ...(user.id === participants.heucilene.uid ? { unitId: EMPLOYER_UNIT_ID } : {}),
      ...(user.id === participants.luis.uid ? { shiftDefinitionId: LUIS_SHIFT_DEFINITION_ID } : {}),
      updatedAt: Timestamp.now(),
    });
    transaction.set(dbAdmin.collection('actionLogs').doc(), {
      workspace_id: WORKSPACE_ID,
      user_id: ACTOR_ID,
      username: 'Implantação controlada do REP-P',
      module: 'dp.time',
      action: 'rep_p_nominal_pilot_configured',
      metadata: { participant_ids: Object.values(participants).map((participant) => participant.uid),
        profile_id: PROFILE_ID, unit_ids: unitIds, unit_time_zone_changes: timeZoneChanges },
      ip_address: null,
      timestamp: Timestamp.now(),
      ttl: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  });
}

async function createLuisShift() {
  const target = dbAdmin.collection('dp_schedules').doc(LUIS_SCHEDULE_ID).collection('shifts').doc(LUIS_SHIFT_ID);
  const existing = await target.get();
  if (existing.exists) {
    if (existing.get('userId') !== participants.luis.uid || existing.get('date') !== '2026-10-22'
      || existing.get('shiftDefinitionId') !== LUIS_SHIFT_DEFINITION_ID) throw new Error('O identificador do turno de teste já foi usado com outro conteúdo.');
    return;
  }
  await saveWorkShift({
    context,
    scheduleId: LUIS_SCHEDULE_ID,
    shiftId: LUIS_SHIFT_ID,
    mode: 'create',
    requestId: 'rep_p_pilot_luis_shift_20261022',
    input: { userId: participants.luis.uid, userName: 'Luis', unitId: EMPLOYER_UNIT_ID, date: '2026-10-22',
      shiftDefinitionId: LUIS_SHIFT_DEFINITION_ID, startTime: '09:00', endTime: '18:00', type: 'work' },
  });
}

async function main() {
  const state = await inspect();
  const plan = {
    apply,
    participants: state.activeMembers,
    profile: `${PROFILE_ID} (${state.profile.get('name')})`,
    units: state.units.map((unit) => {
      const { current, plan: unitPlan } = assertPlannedUnitTimeZone(unit);
      return { id: unit.id, name: unit.get('name'), from: displayTimeZone(current), to: unitPlan.to,
        action: current === unitPlan.to ? 'unchanged' : 'set-from-inspected-field-absence' };
    }),
    luisShift: { scheduleId: LUIS_SCHEDULE_ID, shiftId: LUIS_SHIFT_ID, date: '2026-10-22',
      definitionId: LUIS_SHIFT_DEFINITION_ID, startTime: '09:00', endTime: '18:00' },
  };
  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  await configureCatalog(state);
  await publishReferences(state);
  await createLuisShift();
  console.log(JSON.stringify({ ...plan, completed: true }, null, 2));
}

void main().catch((cause) => {
  process.stderr.write(`Falha no rollout nominal: ${cause instanceof Error ? cause.message : 'erro inesperado'}.\n`);
  process.exitCode = 1;
});
