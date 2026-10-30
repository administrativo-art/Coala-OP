import 'server-only';

import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { readRepPMarkingsForMirror, readRepPPilotMarkingsForBank } from '@/features/dp/rep-p/service.server';
import type { AbsenceRequestRecord } from '@/features/dp/absences/requests/workflow-types';
import { competenceRange, sha256, type ClosureAdjustment, type ClosurePerson } from '@/features/dp/time-adjustments/closure-core';
import { canReadEmployeeTimeRecording } from '@/features/dp/rep-p/employee-time-access.server';
import { assertClosureAccess, type ClosureRecord } from '@/features/dp/time-adjustments/closure.server';
import { ADJUSTMENTS, CLOSURES, closureKey, adjustmentOperations, type AdjustmentRecord } from '@/features/dp/time-adjustments/service.server';
import { AUTOMATIC_ABSENCES, type AutomaticAbsenceRecord } from '@/features/dp/time-adjustments/automatic-absence.server';
import { automaticAbsenceSuperseded } from '@/features/dp/time-adjustments/automatic-absence-core';
import type { ServerUserContext } from '@/lib/auth-server';
import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUserByUnit } from '@/lib/unit-access';
import type { DPAbsenceType, DPOvertimePolicy } from '@/types';

import {
  applyWeeklyOvertimeLimits, buildStatement, competencesBetween, computeBankDay, monthTotals, overnightWorkDate, TIME_BANK_ALGORITHM_VERSION,
  type BankAbsence, type BankDay, type BankManualMovement, type BankMonthRecord, type BankPolicy, type BankSettlement, type BankShift,
} from './core';
import { cycleOf } from './cycle';
import type { TimeBankActionInput } from './schemas';

const OVERTIME_POLICIES = 'dp_overtimePolicies';
const ABSENCES = 'dp_absenceRequests';
const BANK_MOVEMENTS = 'timeBankMovements';
const BANK_MOVEMENT_GUARDS = 'dp_timeBankMovementGuards';
const BANK_MOVEMENT_OPERATIONS = 'dp_timeBankMovementOperations';
const POLICY_LIMIT = 100;
// Saldo transportado: lê no máximo 36 competências para trás desde o início do ciclo.
const CARRY_LOOKBACK_MONTHS = 36;

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now: () => Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, now: () => new Date() };
export type BankMonthDocument = BankMonthRecord & { schemaVersion: 1; algorithmVersion: string; uid: string; inputHash: string;
  policies: Array<{ id: string; version: number }>; generatedAt: string; createdBy: string };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
/** O próprio banco é do titular; o de outra pessoa exige a permissão do fechamento e escopo da unidade. */
async function subject(deps: Dependencies, context: ServerUserContext, employeeUid: string | undefined, need: 'read' | 'close') {
  if (!employeeUid || employeeUid === context.decoded.uid) return context.decoded.uid;
  if (need === 'close') assertClosureAccess(context, need);
  else if (!canReadEmployeeTimeRecording(context)) throw fail('PTRP_BANK_SUBJECT_FORBIDDEN', 'Sem permissão para consultar o banco desta pessoa.', 'NOT_FOUND');
  const employee = await deps.mainDb.collection('users').doc(employeeUid).get();
  if (!employee.exists) throw fail('PTRP_BANK_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  if (!canAccessUserByUnit(context.userDoc, employee.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('PTRP_BANK_SUBJECT_FORBIDDEN', 'Você não pode acessar o banco desta pessoa.', 'NOT_FOUND');
  }
  return employeeUid;
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const fiscalMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const bankRef = (deps: Dependencies, workspaceId: string, competence: string, version: number, uid: string) =>
  deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(version)).collection('timeBank').doc(uid);
const movementCollection = (deps: Dependencies, workspaceId: string, competence: string) =>
  deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection(BANK_MOVEMENTS);
const movementKey = (workspaceId: string, uid: string, operationId: string) =>
  createHash('sha256').update(JSON.stringify(['bank-movement', workspaceId, uid, operationId])).digest('hex');
const movementGuardRef = (deps: Dependencies, workspaceId: string, uid: string) =>
  deps.hrDb.collection(BANK_MOVEMENT_GUARDS).doc(createHash('sha256').update(JSON.stringify([workspaceId, uid])).digest('hex'));
const movementOperationRef = (deps: Dependencies, workspaceId: string, uid: string, operationId: string) =>
  deps.hrDb.collection(BANK_MOVEMENT_OPERATIONS).doc(movementKey(workspaceId, uid, operationId));
const guardRevision = (snapshot: FirebaseFirestore.DocumentSnapshot) => snapshot.exists && Number.isSafeInteger(snapshot.get('revision'))
  ? Number(snapshot.get('revision')) : 0;

async function movementsFor(deps: Dependencies, workspaceId: string, uid: string, competences: string[]) {
  const snapshots = await Promise.all(competences.map((competence) => movementCollection(deps, workspaceId, competence).where('uid', '==', uid).limit(501).get()));
  if (snapshots.some((snapshot) => snapshot.size > 500)) throw fail('PTRP_BANK_MOVEMENTS_TRUNCATED', 'Há movimentos demais no período para montar um extrato seguro.', 'CONFLICT');
  return snapshots.flatMap((snapshot) => snapshot.docs.map((doc) => doc.data() as BankManualMovement));
}

async function policiesAndTarget(deps: Dependencies, uid: string) {
  const user = await deps.mainDb.collection('users').doc(uid).get();
  const unitId = text(user.get('unitId'));
  const unit = unitId ? await deps.mainDb.collection('dp_units').doc(unitId).get() : null;
  const unitGroupId = text(unit?.get('groupId'));
  const group = unitGroupId ? await deps.mainDb.collection('dp_unitGroups').doc(unitGroupId).get() : null;
  const unitOrganizationId = text(unit?.get('organizationId')) ?? text(group?.get('organizationId'));
  const snapshot = await deps.mainDb.collection(OVERTIME_POLICIES).where('status', 'in', ['published', 'archived']).limit(POLICY_LIMIT + 1).get();
  if (snapshot.size > POLICY_LIMIT) throw fail('PTRP_BANK_POLICY_LIMIT', 'Há políticas de hora extra demais para resolver o banco com segurança.', 'CONFLICT');
  const policies = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as DPOvertimePolicy);
  const target = {
    collaboratorId: uid, ...(text(user.get('jobRoleId')) ? { jobRoleId: text(user.get('jobRoleId'))! } : {}),
    jobFunctionIds: Array.isArray(user.get('jobFunctionIds')) ? (user.get('jobFunctionIds') as string[]) : [],
    ...(unitId ? { unitId } : {}), ...(unitGroupId ? { unitGroupId } : {}), ...(unitOrganizationId ? { unitOrganizationId } : {}),
  };
  return { user, policyOn: (date: string) => {
    const resolution = resolveDPJourney({ journeys: policies, target, date });
    return resolution.status === 'resolved' ? resolution.journey : null;
  } };
}

/** Apuração da pessoa no mês fechado, a partir da escala, da versão da jornada, das batidas tratadas e da declaração congelada. */
async function liveDeclaration(deps: Dependencies, workspaceId: string, competence: string, uid: string): Promise<ClosurePerson> {
  const { start, end } = competenceRange(competence);
  const [adjustments, absences, automaticAbsences] = await Promise.all([
    deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', uid)
      .where('workDate', '>=', start).where('workDate', '<=', end).limit(201).get(),
    deps.hrDb.collection(ABSENCES).where('workspaceId', '==', workspaceId).where('beneficiaryUid', '==', uid)
      .where('startDate', '<=', end).limit(201).get(),
    deps.hrDb.collection(AUTOMATIC_ABSENCES).where('workspaceId', '==', workspaceId).where('employeeUid', '==', uid)
      .where('workDate', '>=', start).where('workDate', '<=', end).limit(201).get(),
  ]);
  if (adjustments.size > 200 || absences.size > 200 || automaticAbsences.size > 200) throw fail('PTRP_BANK_PREVIEW_TRUNCATED', 'O mês tem ocorrências demais para uma prévia segura.', 'CONFLICT');
  const adjustmentItems = adjustments.docs.map((doc) => doc.data() as AdjustmentRecord);
  const absenceItems = absences.docs.map((doc) => doc.data() as AbsenceRequestRecord);
  const approvedAdjustmentDays = new Set(adjustmentItems.filter((item) => item.status === 'approved').map((item) => item.workDate));
  const approvedAbsences = absenceItems.filter((item) => item.status === 'approved');
  const effectiveAutomaticAbsences = automaticAbsences.docs.map((doc) => doc.data() as AutomaticAbsenceRecord)
    .filter((item) => item.status === 'active' && !automaticAbsenceSuperseded(item.workDate, approvedAdjustmentDays, approvedAbsences));
  return {
    uid, name: null,
    adjustments: adjustmentItems.filter((item) => item.status === 'approved').map((item) => ({
      id: item.id, workDate: item.workDate, kind: item.kind, status: item.status,
      original: item.target ? { nsr: item.target.nsr, markedAt: item.target.markedAt } : null,
      inclusion: item.inclusion ? { markedAt: item.inclusion.markedAt } : null,
      operations: adjustmentOperations(item).map((operation) => ({ kind: operation.kind,
        original: operation.target ? { nsr: operation.target.nsr, markedAt: operation.target.markedAt } : null,
        inclusion: operation.inclusion ? { markedAt: operation.inclusion.markedAt } : null })), reason: item.reason,
      requestedBy: item.employeeUid, requestedAt: item.createdAt, decidedBy: item.decidedBy ?? null, decidedAt: item.decidedAt ?? null, decisionReason: null,
    })),
    absences: [...absenceItems
      .filter((item) => item.status === 'approved' && item.endDate >= start).map((item) => ({
        id: item.id, typeName: item.typeSnapshot?.name ?? item.typeId, startDate: item.startDate, endDate: item.endDate,
        startTime: item.input?.startTime ?? null, endTime: item.input?.endTime ?? null, quantity: item.quantity, unit: item.unit,
        status: item.status, approval: item.approvalOrigin ?? 'review', decidedBy: item.decidedAt ? item.history.at(-1)?.actorUid ?? null : null,
        decidedAt: item.decidedAt ?? null, attachmentCount: item.attachments?.length ?? 0,
        effect: item.typeSnapshot.workdayEffect,
      })), ...effectiveAutomaticAbsences.map((item) => ({ id: item.id, typeName: 'Falta injustificada automática',
        startDate: item.workDate, endDate: item.workDate, startTime: null, endTime: null, quantity: 1, unit: 'day' as const,
        status: 'approved', approval: 'automatic_timeout' as const, decidedBy: null, decidedAt: item.createdAt,
        attachmentCount: 0, effect: 'unexcused_absence' as const, automatic: true }))],
    shiftSwaps: [],
  };
}

async function computeBankMonth(deps: Dependencies, workspaceId: string, competence: string, closure: ClosureRecord | null, uid: string) {
  const { start, end } = competenceRange(competence);
  const closureRef = closure ? deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(closure.version)) : null;
  const [{ user, policyOn }, declaration] = await Promise.all([
    policiesAndTarget(deps, uid),
    closureRef ? closureRef.collection('people').doc(uid).get().then((doc) => (doc.data() as ClosurePerson | undefined) ?? null)
      : liveDeclaration(deps, workspaceId, competence, uid),
  ]);
  const [arp, pilot, month] = await Promise.all([
    readRepPMarkingsForMirror(workspaceId, uid, start, end, { repDb: deps.repDb }),
    closure ? Promise.resolve({ markings: [], truncated: false })
      : readRepPPilotMarkingsForBank(workspaceId, uid, start, end, { repDb: deps.repDb }),
    readRepPMonthOfPerson([uid, text(user.get('hrEmployeeId'))], competence, { db: deps.mainDb }, { holidays: true }),
  ]);
  if (arp.truncated || pilot.truncated || month.truncated) throw fail('PTRP_BANK_MONTH_TRUNCATED', 'O mês tem batidas ou turnos demais para apurar com segurança. Fale com o desenvolvimento.', 'CONFLICT');
  // Ajustes aprovados da declaração: desconsideram originais e incluem batidas, como no espelho.
  const approved = (declaration?.adjustments ?? []).filter((item) => item.status === 'approved');
  const operations = (item: ClosureAdjustment) => item.operations?.length ? item.operations : [{ kind: item.kind, original: item.original, inclusion: item.inclusion }];
  const discarded = new Set(approved.flatMap((item) => operations(item).filter((operation) => operation.original && operation.kind !== 'include')
    .map((operation) => `${operation.original!.nsr}|${operation.original!.markedAt}`)));
  // Efeito da ausência vem do tipo congelado no pedido; a declaração não guarda motivo nem anexo.
  const absenceIds = (declaration?.absences ?? []).filter((item) => item.status === 'approved').map((item) => item.id).slice(0, 200);
  const absenceDocs = absenceIds.length ? await deps.hrDb.getAll(...absenceIds.map((id) => deps.hrDb.collection(ABSENCES).doc(id))) : [];
  const effectById = new Map(absenceDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.get('typeSnapshot.workdayEffect') as DPAbsenceType['workdayEffect'] | undefined]));
  const absences: BankAbsence[] = (declaration?.absences ?? []).filter((item) => item.status === 'approved').map((item) => ({
    id: item.id, typeName: item.typeName, effect: item.effect ?? effectById.get(item.id) ?? 'manual_review', unit: item.unit, startDate: item.startDate, endDate: item.endDate,
    minutes: item.unit === 'hour' ? (item.startTime && item.endTime ? Math.max(0, toMinutes(item.endTime) - toMinutes(item.startTime)) : Math.round(item.quantity * 60)) : null,
  }));
  const holidays = new Set(month.holidays);
  const sourceMarkings = [...arp.markings, ...pilot.markings];
  const datedMarkings = sourceMarkings.map((item) => ({ ...item, bankWorkDate: overnightWorkDate(item.workDate, item.markedAt, month.shifts) }));
  const usedPolicies = new Map<string, { id: string; version: number }>();
  const days: BankDay[] = [];
  for (let cursor = Date.parse(`${start}T00:00:00Z`); cursor <= Date.parse(`${end}T00:00:00Z`); cursor += 86_400_000) {
    const date = new Date(cursor).toISOString().slice(0, 10);
    const shifts = month.shifts.filter((item) => item.date === date);
    const raw = shifts.find((item) => item.type === 'work') ?? shifts[0] ?? null;
    const shift: BankShift | null = raw ? {
      type: raw.type, startTime: raw.startTime, endTime: raw.endTime, overnight: raw.overnight,
      plannedMinutes: raw.startTime && raw.endTime ? Math.max(0, ((toMinutes(raw.endTime) - toMinutes(raw.startTime) + 1440) % 1440 || 1440) - (raw.breakDurationMinutes ?? 0)) : null,
      referenceMinutes: raw.referenceMinutes, toleranceMinutes: raw.toleranceMinutes, journeyId: raw.journeyId,
    } : null;
    const markings = [
      ...datedMarkings.filter((item) => item.bankWorkDate === date && !discarded.has(`${item.nsr}|${item.markedAt}`)).map((item) => item.markedAt),
      ...approved.filter((item) => item.workDate === date).flatMap((item) => operations(item))
        .filter((operation) => operation.inclusion).map((operation) => operation.inclusion!.markedAt),
    ].sort((left, right) => fiscalMs(left) - fiscalMs(right));
    const policy = policyOn(date);
    if (policy) usedPolicies.set(`${policy.id}:${policy.version}`, { id: policy.id, version: policy.version });
    const day = computeBankDay({
      date, shift, markings, holiday: holidays.has(date),
      absences: absences.filter((item) => item.startDate <= date && item.endDate >= date),
      policy: policy ? { id: policy.id, version: policy.version, categories: policy.categories, timeBank: policy.timeBank,
        dailyOvertimeLimitMinutes: policy.dailyOvertimeLimitMinutes, weeklyOvertimeLimitMinutes: policy.weeklyOvertimeLimitMinutes } satisfies BankPolicy : null,
    });
    if (day.kind !== 'no_schedule' || day.workedMinutes || day.lines.length || day.issues.length) days.push(day);
  }
  const limitedDays = applyWeeklyOvertimeLimits(days);
  return { days: limitedDays, totals: monthTotals(limitedDays), policies: [...usedPolicies.values()],
    pilotPreview: pilot.markings.length > 0,
    inputHash: sha256({ markings: sourceMarkings, shifts: month.shifts, holidays: month.holidays, declaration, absences }) };
}

/** Lê a apuração gravada para a versão vigente do fechamento ou, no mês fechado, apura uma vez e grava. */
async function bankMonthFor(deps: Dependencies, workspaceId: string, competence: string, uid: string, actorUid: string, expectedVersion?: number) {
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence));
  const closure = (await closureRef.get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_BANK_NOT_CLOSED', 'O banco de horas do mês é apurado depois do fechamento.', 'CONFLICT');
  if (expectedVersion !== undefined && closure.version !== expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const target = bankRef(deps, workspaceId, competence, closure.version, uid);
  const existing = (await target.get()).data() as BankMonthDocument | undefined;
  if (existing) {
    if (existing.algorithmVersion !== TIME_BANK_ALGORITHM_VERSION) {
      throw fail('PTRP_BANK_ALGORITHM_OUTDATED', 'A apuração foi feita por uma regra anterior. Reabra e feche novamente a competência.', 'CONFLICT');
    }
    return existing;
  }
  const computed = await computeBankMonth(deps, workspaceId, competence, closure, uid);
  const record: BankMonthDocument = { schemaVersion: 1, algorithmVersion: TIME_BANK_ALGORITHM_VERSION, uid, competence, closureVersion: closure.version,
    ...computed, generatedAt: deps.now().toISOString(), createdBy: actorUid };
  return deps.hrDb.runTransaction(async (tx) => {
    const [again, current] = await Promise.all([tx.get(target), tx.get(closureRef)]);
    if (again.exists) return again.data() as BankMonthDocument;
    if (current.get('status') !== 'closed' || current.get('version') !== closure.version) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou durante a apuração. Atualize e confira.', 'CONFLICT');
    tx.create(target, record);
    return record;
  });
}

/** POST: apura o banco da pessoa no mês fechado (uma vez por versão do fechamento). Outra pessoa exige poder fechar. */
export async function generateBankMonth(context: ServerUserContext, input: Extract<TimeBankActionInput, { action: 'generate' }>, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const uid = await subject(deps, context, input.employeeUid, 'close');
  return bankMonthFor(deps, context.workspace_id, input.competence, uid, context.decoded.uid, input.expectedVersion);
}

/** Apura toda a equipe congelada logo após fechar a competência; falhas ficam explícitas e podem ser repetidas idempotentemente. */
export async function generateBankClosedCompetence(context: ServerUserContext, competence: string, version: number, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  const people = await deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, competence)).collection('versions').doc(String(version))
    .collection('people').limit(451).get();
  if (people.size > 450) throw fail('PTRP_BANK_ROSTER_TOO_LARGE', 'Há pessoas demais para apurar a competência numa única execução.', 'CONFLICT');
  const failures: Array<{ uid: string; code: string }> = [];
  let generated = 0;
  for (let index = 0; index < people.docs.length; index += 8) {
    const batch = people.docs.slice(index, index + 8);
    const results = await Promise.allSettled(batch.map((person) => bankMonthFor(deps, context.workspace_id, competence, person.id, context.decoded.uid, version)));
    results.forEach((result, offset) => {
      if (result.status === 'fulfilled') generated += 1;
      else failures.push({ uid: batch[offset].id, code: result.reason instanceof AppError ? result.reason.code : 'PTRP_BANK_CALCULATION_FAILED' });
    });
  }
  return { total: people.size, generated, failures };
}

/** Usado pelo AEJ, que já conferiu a permissão de gestor de ponto. */
export async function bankMonthForAej(workspaceId: string, competence: string, uid: string, actorUid: string, injected: Partial<Dependencies> = {}) {
  return bankMonthFor({ ...defaults, ...injected }, workspaceId, competence, uid, actorUid);
}

/** Movimentos imutáveis usados pelo registro 07 do AEJ. */
export async function bankMovementsForAej(workspaceId: string, uid: string, competences: string[], injected: Partial<Dependencies> = {}) {
  return movementsFor({ ...defaults, ...injected }, workspaceId, uid, competences);
}

/**
 * GET: extrato do ciclo que contém a data (padrão: hoje), só leitura. Junta as apurações gravadas das competências
 * fechadas do ciclo; as que faltam aparecem em `missing` (o cliente apura pelo POST). Saldo transportado soma os
 * ciclos anteriores quando o destino do residual é "transportar".
 */
export async function readBankStatement(context: ServerUserContext, query: { employeeUid?: string; date?: string }, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  return statementFor(deps, context.workspace_id, await subject(deps, context, query.employeeUid, 'read'), query.date);
}

/** Data civil de Brasília: o ciclo só termina depois do último dia no fuso da empresa. */
const brasiliaDate = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const settlementRef = (deps: Dependencies, workspaceId: string, uid: string, cycle: { start: string; end: string }) =>
  deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, `${cycle.end.slice(0, 7)}-01`)).collection('timeBankSettlements').doc(`${uid}_${cycle.start}`);

async function statementFor(deps: Dependencies, workspaceId: string, uid: string, requestedDate?: string) {
  const today = brasiliaDate(deps.now());
  const date = requestedDate ?? today;
  const { policyOn } = await policiesAndTarget(deps, uid);
  const policy = policyOn(date);
  if (!policy) return { policy: null, statement: null, closures: {} as Record<string, number> };
  const cycle = policy.timeBank.cycle;
  const period = cycle ? cycleOf(cycle, date) : null;
  const start = period?.start ?? policy.validFrom;
  const end = period?.end ?? (date > today ? date : today);
  const carryFrom = cycle?.residualDestination === 'carry' ? (cycle.anchorDate > policy.validFrom ? cycle.anchorDate : policy.validFrom) : null;
  const allCompetences = competencesBetween(carryFrom && carryFrom < start ? carryFrom : start, end).slice(-CARRY_LOOKBACK_MONTHS);
  const closures = await deps.hrDb.getAll(...allCompetences.map((competence) => deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence))));
  const closed = new Map(allCompetences.flatMap((competence, index) => closures[index].get('status') === 'closed' ? [[competence, Number(closures[index].get('version'))] as const] : []));
  const stored = await Promise.all([...closed].map(([competence, version]) => bankRef(deps, workspaceId, competence, version, uid).get()));
  const storedMonths = stored.filter((doc) => doc.exists).map((doc) => doc.data() as BankMonthDocument);
  if (storedMonths.some((month) => month.algorithmVersion !== TIME_BANK_ALGORITHM_VERSION)) {
    throw fail('PTRP_BANK_ALGORITHM_OUTDATED', 'Há apuração feita por uma regra anterior. Reabra e feche novamente a competência.', 'CONFLICT');
  }
  const months: BankMonthRecord[] = storedMonths;
  let pilotPreview = false;
  const previewCompetence = date.slice(0, 7);
  if (!closed.has(previewCompetence) && previewCompetence <= today.slice(0, 7)) {
    const preview = await computeBankMonth(deps, workspaceId, previewCompetence, null, uid);
    pilotPreview = preview.pilotPreview;
    months.push({ competence: previewCompetence, closureVersion: 0, days: preview.days, totals: preview.totals });
  }
  const periodCompetences = competencesBetween(start, end);
  // Com saldo transportado, os meses anteriores ao ciclo sem apuração também faltam: o saldo de abertura não pode sair subestimado.
  const missing = (carryFrom ? allCompetences : periodCompetences).filter((competence) => !months.some((month) => month.competence === competence && month.closureVersion > 0)
    && competence <= today.slice(0, 7));
  const settlement = period ? ((await settlementRef(deps, workspaceId, uid, period).get()).data() as BankSettlement | undefined) ?? null : null;
  // O extrato puro calcula a abertura sobre meses e movimentos anteriores, inclusive expiração FIFO.
  const movements = await movementsFor(deps, workspaceId, uid, allCompetences);
  const statement = buildStatement({ period, today, months, missing, openingMinutes: 0, carryFrom, settlement, movements, timeBank: policy.timeBank });
  return { policy: { id: policy.id, version: policy.version, name: policy.name, enabled: policy.timeBank.enabled, cycle: cycle ?? null },
    statement, previewCompetences: months.filter((month) => month.closureVersion === 0).map((month) => month.competence),
    pilotPreview,
    closures: Object.fromEntries([...closed].filter(([competence]) => missing.includes(competence) || periodCompetences.includes(competence))) };
}

/**
 * POST (DP, `dp.timeClosure.close`): registra o encerramento do ciclo terminado, com o residual conferido e o destino da
 * política. Uma vez por pessoa e ciclo; nada é apagado. O residual difere do esperado quando algo mudou desde a leitura.
 */
export async function settleBankCycle(context: ServerUserContext, input: Extract<TimeBankActionInput, { action: 'settle' }>, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  await subject(deps, context, input.employeeUid, 'close');
  const guardTarget = movementGuardRef(deps, context.workspace_id, input.employeeUid);
  const expectedGuardRevision = guardRevision(await guardTarget.get());
  const { policy, statement, closures } = await statementFor(deps, context.workspace_id, input.employeeUid, input.date);
  if (!policy || !statement?.cycle) throw fail('PTRP_BANK_NO_CYCLE', 'A política desta pessoa não tem ciclo de banco de horas.', 'CONFLICT');
  if (statement.settlement) return statement.settlement;
  if (statement.reviewDays.some((item) => item.issues.includes('MISSING_DAY'))) throw fail('PTRP_BANK_PENDING_DAYS', 'Há dia escalado sem batida e sem ausência no ciclo. Lance a ausência (reabrindo o mês) antes de encerrar.', 'CONFLICT');
  if (!statement.ended || !statement.residual) throw fail('PTRP_BANK_CYCLE_OPEN', 'O ciclo ainda não terminou, falta apurar algum mês ou não há saldo a encerrar.', 'CONFLICT');
  if (statement.residual.minutes !== input.expectedMinutes) throw fail('PTRP_BANK_RESIDUAL_CHANGED', 'O saldo mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const payrollMovementId = statement.residual.destination === 'payroll'
    ? movementKey(context.workspace_id, input.employeeUid, `settlement:${statement.cycle.start}:${statement.cycle.end}`) : undefined;
  const record: BankSettlement = { uid: input.employeeUid, cycle: { start: statement.cycle.start, end: statement.cycle.end }, minutes: statement.residual.minutes,
    destination: statement.residual.destination, policy: { id: policy.id, version: policy.version }, closureVersions: closures,
    settledBy: context.decoded.uid, settledAt: deps.now().toISOString(), ...(payrollMovementId ? { movementId: payrollMovementId } : {}) };
  const target = settlementRef(deps, context.workspace_id, input.employeeUid, statement.cycle);
  return deps.hrDb.runTransaction(async (tx) => {
    const [again, guard] = await Promise.all([tx.get(target), tx.get(guardTarget)]);
    if (again.exists) return again.data() as BankSettlement;
    if (guardRevision(guard) !== expectedGuardRevision) throw fail('PTRP_BANK_BALANCE_CHANGED', 'O saldo mudou durante o encerramento. Atualize e confira.', 'CONFLICT');
    tx.create(target, record);
    if (payrollMovementId) {
      const positive = statement.residual!.minutes > 0;
      const movement: BankManualMovement = {
        id: payrollMovementId, uid: input.employeeUid, date: statement.cycle!.end, competence: statement.cycle!.end.slice(0, 7), status: 'active', kind: 'payroll',
        minutes: statement.residual!.minutes, reason: `Liquidação do ciclo ${statement.cycle!.start} a ${statement.cycle!.end}.`,
        createdAt: record.settledAt, createdBy: context.decoded.uid,
        settlementCycle: { start: statement.cycle!.start, end: statement.cycle!.end },
        line: { nature: positive ? 'bank_debit' : 'bank_credit', minutes: Math.abs(statement.residual!.minutes), reason: 'payroll_settlement' },
        counterLine: { nature: positive ? 'payroll_overtime' : 'payroll_discount', minutes: Math.abs(statement.residual!.minutes), reason: 'payroll_settlement' },
      };
      tx.create(movementCollection(deps, context.workspace_id, movement.competence).doc(movement.id), movement);
    }
    tx.set(guardTarget, { workspaceId: context.workspace_id, uid: input.employeeUid, revision: expectedGuardRevision + 1, updatedAt: record.settledAt }, { merge: true });
    return record;
  });
}

type ManualAction = Extract<TimeBankActionInput, { action: 'approve_overtime' | 'movement' }>;

/** Aprovação de extra e movimentos manuais: um evento imutável por operationId; reversão apenas muda seu estado. */
export async function createBankMovement(context: ServerUserContext, input: ManualAction, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  await subject(deps, context, input.employeeUid, 'close');
  const competence = input.date.slice(0, 7);
  const requestHash = sha256(JSON.stringify(input.action === 'approve_overtime'
    ? [input.action, input.employeeUid, input.date, input.categoryId, input.minutes, input.reason]
    : [input.action, input.employeeUid, input.date, input.kind, input.minutes, input.expectedBalance, input.reason]));
  const operationTarget = movementOperationRef(deps, context.workspace_id, input.employeeUid, input.operationId);
  const priorOperation = (await operationTarget.get()).data() as { requestHash?: string; competence?: string; movementId?: string } | undefined;
  if (priorOperation) {
    if (priorOperation.requestHash !== requestHash || !priorOperation.competence || !priorOperation.movementId) {
      throw fail('PTRP_BANK_OPERATION_CONFLICT', 'Esta operação já foi usada com outros dados.', 'CONFLICT');
    }
    const replay = (await movementCollection(deps, context.workspace_id, priorOperation.competence).doc(priorOperation.movementId).get()).data() as BankManualMovement | undefined;
    if (!replay) throw fail('PTRP_BANK_OPERATION_CONFLICT', 'A operação existe, mas seu movimento precisa de conferência.', 'CONFLICT');
    return replay;
  }
  const guardTarget = movementGuardRef(deps, context.workspace_id, input.employeeUid);
  const expectedGuardRevision = guardRevision(await guardTarget.get());
  const current = await statementFor(deps, context.workspace_id, input.employeeUid, input.date);
  if (!current.policy || !current.statement) throw fail('PTRP_BANK_NO_POLICY', 'Não há política de hora extra aplicável nesta data.', 'CONFLICT');
  let record: BankManualMovement;
  const createdAt = deps.now().toISOString();
  if (input.action === 'approve_overtime') {
    const pending = current.statement.lines.find((item) => item.date === input.date && item.line.reason === 'pending_approval'
      && item.line.categoryId === input.categoryId && item.line.minutes === input.minutes);
    if (!pending) throw fail('PTRP_BANK_APPROVAL_CHANGED', 'A hora extra pendente mudou ou já foi aprovada. Atualize o extrato.', 'CONFLICT');
    const { policyOn } = await policiesAndTarget(deps, input.employeeUid);
    const category = policyOn(input.date)?.categories.find((item) => item.id === input.categoryId);
    if (!category?.requiresApproval) throw fail('PTRP_BANK_APPROVAL_INVALID', 'A faixa não exige mais aprovação.', 'CONFLICT');
    const line = category.destination === 'time_bank'
      ? { nature: 'bank_credit' as const, minutes: Math.round(input.minutes * (category.bankCreditFactor ?? 1)), reason: 'approved_overtime' as const,
        categoryId: category.id, ratePercent: category.ratePercent, factor: category.bankCreditFactor ?? 1 }
      : category.destination === 'payroll'
        ? { nature: 'payroll_overtime' as const, minutes: input.minutes, reason: 'approved_overtime' as const,
          categoryId: category.id, ratePercent: category.ratePercent }
        : { nature: 'review' as const, minutes: input.minutes, reason: 'approved_overtime' as const,
          categoryId: category.id, ratePercent: category.ratePercent };
    // operationId preserva a idempotência do mesmo clique, mas uma nova operação pode reaprovar depois de um estorno.
    // A guarda transacional continua impedindo duas aprovações concorrentes da mesma pendência.
    const id = movementKey(context.workspace_id, input.employeeUid, input.operationId);
    record = { id, uid: input.employeeUid, date: input.date, competence, status: 'active', reason: input.reason, createdAt,
      createdBy: context.decoded.uid, operationId: input.operationId, requestHash, kind: 'overtime_approval', minutes: input.minutes, categoryId: input.categoryId,
      replacesMinutes: input.minutes, sourceClosureVersion: pending.closureVersion, line };
  } else {
    const common = { id: movementKey(context.workspace_id, input.employeeUid, input.operationId), uid: input.employeeUid, operationId: input.operationId, requestHash,
      date: input.date, competence, status: 'active' as const, reason: input.reason, createdAt, createdBy: context.decoded.uid };
    if (input.expectedBalance !== current.statement.balanceMinutes) throw fail('PTRP_BANK_BALANCE_CHANGED', 'O saldo mudou desde a leitura. Atualize e confira.', 'CONFLICT');
    if (input.kind === 'compensation' && input.minutes < 0) throw fail('PTRP_BANK_COMPENSATION_INVALID', 'A compensação deve informar minutos positivos.');
    if (input.kind === 'compensation') {
      record = { ...common, kind: input.kind, minutes: input.minutes,
        line: { nature: 'bank_debit', minutes: input.minutes, reason: 'manual_compensation' } };
    } else if (input.kind === 'adjustment') {
      record = { ...common, kind: input.kind, minutes: input.minutes,
        line: { nature: input.minutes > 0 ? 'bank_credit' : 'bank_debit', minutes: Math.abs(input.minutes), reason: 'manual_adjustment' } };
    } else {
      if (input.minutes > 0 && input.minutes > Math.max(0, current.statement.balanceMinutes)
        || input.minutes < 0 && -input.minutes > Math.max(0, -current.statement.balanceMinutes)) {
        throw fail('PTRP_BANK_PAYROLL_EXCEEDS_BALANCE', 'O lançamento na folha excede o saldo disponível.', 'CONFLICT');
      }
      record = { ...common, kind: input.kind, minutes: input.minutes,
        line: { nature: input.minutes > 0 ? 'bank_debit' : 'bank_credit', minutes: Math.abs(input.minutes), reason: 'payroll_settlement' },
        counterLine: { nature: input.minutes > 0 ? 'payroll_overtime' : 'payroll_discount', minutes: Math.abs(input.minutes), reason: 'payroll_settlement' } };
    }
  }
  const ref = movementCollection(deps, context.workspace_id, competence).doc(record.id);
  return deps.hrDb.runTransaction(async (tx) => {
    const [existing, guard, indexedOperation] = await Promise.all([tx.get(ref), tx.get(guardTarget), tx.get(operationTarget)]);
    if (indexedOperation.exists) {
      const locator = indexedOperation.data() as { requestHash?: string; competence?: string; movementId?: string };
      if (locator.requestHash !== requestHash || !locator.competence || !locator.movementId) {
        throw fail('PTRP_BANK_OPERATION_CONFLICT', 'Esta operação já foi usada com outros dados.', 'CONFLICT');
      }
      const replay = (locator.competence === competence && locator.movementId === record.id ? existing
        : await tx.get(movementCollection(deps, context.workspace_id, locator.competence).doc(locator.movementId))).data() as BankManualMovement | undefined;
      if (!replay) throw fail('PTRP_BANK_OPERATION_CONFLICT', 'A operação existe, mas seu movimento precisa de conferência.', 'CONFLICT');
      return replay;
    }
    if (existing.exists) {
      const prior = existing.data() as BankManualMovement;
      const sameRequest = prior.operationId === input.operationId && prior.uid === record.uid && prior.date === record.date
        && prior.kind === record.kind && prior.minutes === record.minutes && prior.reason === record.reason
        && prior.categoryId === record.categoryId && prior.replacesMinutes === record.replacesMinutes
        && prior.sourceClosureVersion === record.sourceClosureVersion
        && JSON.stringify(prior.line) === JSON.stringify(record.line)
        && JSON.stringify(prior.counterLine ?? null) === JSON.stringify(record.counterLine ?? null);
      if (!sameRequest) throw fail('PTRP_BANK_OPERATION_CONFLICT', 'Esta operação já foi usada com outros dados.', 'CONFLICT');
      return prior;
    }
    if (guardRevision(guard) !== expectedGuardRevision) throw fail('PTRP_BANK_BALANCE_CHANGED', 'O saldo mudou durante o lançamento. Atualize e confira.', 'CONFLICT');
    tx.create(ref, record);
    tx.create(operationTarget, { workspaceId: context.workspace_id, uid: input.employeeUid, operationId: input.operationId,
      requestHash, competence, movementId: record.id, createdAt });
    tx.create(ref.collection('audit').doc(), { action: 'created', actorId: context.decoded.uid, at: createdAt, reason: input.reason });
    tx.set(guardTarget, { workspaceId: context.workspace_id, uid: input.employeeUid, revision: expectedGuardRevision + 1, updatedAt: createdAt }, { merge: true });
    return record;
  });
}

export async function reverseBankMovement(context: ServerUserContext, input: Extract<TimeBankActionInput, { action: 'reverse' }>, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  await subject(deps, context, input.employeeUid, 'close');
  const ref = movementCollection(deps, context.workspace_id, input.date.slice(0, 7)).doc(input.movementId);
  const guardTarget = movementGuardRef(deps, context.workspace_id, input.employeeUid);
  const at = deps.now().toISOString();
  return deps.hrDb.runTransaction(async (tx) => {
    const [snapshot, guard] = await Promise.all([tx.get(ref), tx.get(guardTarget)]);
    const movement = snapshot.data() as BankManualMovement | undefined;
    if (!movement || movement.uid !== input.employeeUid || movement.date !== input.date) throw fail('PTRP_BANK_MOVEMENT_NOT_FOUND', 'Movimento não encontrado.', 'NOT_FOUND');
    if (movement.status === 'reversed') return movement;
    if (movement.settlementCycle) throw fail('PTRP_BANK_SETTLEMENT_REVERSAL_FORBIDDEN', 'A liquidação do ciclo não pode ser estornada isoladamente. Registre uma correção auditável com o DP.', 'CONFLICT');
    const reversed = { ...movement, status: 'reversed' as const, reversedAt: at, reversedBy: context.decoded.uid, reversalReason: input.reason };
    tx.set(ref, reversed);
    tx.create(ref.collection('audit').doc(), { action: 'reversed', actorId: context.decoded.uid, at, reason: input.reason });
    tx.set(guardTarget, { workspaceId: context.workspace_id, uid: input.employeeUid, revision: guardRevision(guard) + 1, updatedAt: at }, { merge: true });
    return reversed;
  });
}
