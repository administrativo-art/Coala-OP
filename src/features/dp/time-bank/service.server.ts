import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { readRepPMonthOfPerson } from '@/features/dp/rep-p/own-month.server';
import { readRepPMarkingsForMirror } from '@/features/dp/rep-p/service.server';
import { competenceRange, sha256, type ClosurePerson } from '@/features/dp/time-adjustments/closure-core';
import { assertClosureAccess, type ClosureRecord } from '@/features/dp/time-adjustments/closure.server';
import { CLOSURES, closureKey } from '@/features/dp/time-adjustments/service.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { resolveDPJourney } from '@/lib/dp-journey-resolution';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import type { DPAbsenceType, DPOvertimePolicy } from '@/types';

import {
  buildStatement, competencesBetween, computeBankDay, monthTotals, TIME_BANK_ALGORITHM_VERSION,
  type BankAbsence, type BankDay, type BankMonthRecord, type BankPolicy, type BankSettlement, type BankShift,
} from './core';
import { cycleOf } from './cycle';
import type { TimeBankActionInput } from './schemas';

const OVERTIME_POLICIES = 'dp_overtimePolicies';
const ABSENCES = 'dp_absenceRequests';
const POLICY_LIMIT = 100;
// Saldo transportado: lê no máximo 36 competências para trás desde o início do ciclo.
const CARRY_LOOKBACK_MONTHS = 36;

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now: () => Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, now: () => new Date() };
export type BankMonthDocument = BankMonthRecord & { schemaVersion: 1; algorithmVersion: string; uid: string; inputHash: string;
  policies: Array<{ id: string; version: number }>; generatedAt: string; createdBy: string };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
/** O próprio banco é do titular; o de outra pessoa exige a permissão do fechamento (ler ou fechar). */
function subject(context: ServerUserContext, employeeUid: string | undefined, need: 'read' | 'close') {
  if (!employeeUid || employeeUid === context.decoded.uid) return context.decoded.uid;
  assertClosureAccess(context, need);
  return employeeUid;
}
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const fiscalMs = (markedAt: string) => Date.parse(markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
const bankRef = (deps: Dependencies, workspaceId: string, competence: string, version: number, uid: string) =>
  deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(version)).collection('timeBank').doc(uid);

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
async function computeBankMonth(deps: Dependencies, workspaceId: string, competence: string, closure: ClosureRecord, uid: string) {
  const { start, end } = competenceRange(competence);
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence)).collection('versions').doc(String(closure.version));
  const [{ user, policyOn }, declarationDoc] = await Promise.all([policiesAndTarget(deps, uid), closureRef.collection('people').doc(uid).get()]);
  const declaration = (declarationDoc.data() as ClosurePerson | undefined) ?? null;
  const [arp, month] = await Promise.all([
    readRepPMarkingsForMirror(workspaceId, uid, start, end, { repDb: deps.repDb }),
    readRepPMonthOfPerson([uid, text(user.get('hrEmployeeId'))], competence, { db: deps.mainDb }, { holidays: true }),
  ]);
  if (arp.truncated || month.truncated) throw fail('PTRP_BANK_MONTH_TRUNCATED', 'O mês tem batidas ou turnos demais para apurar com segurança. Fale com o desenvolvimento.', 'CONFLICT');
  // Ajustes aprovados da declaração: desconsideram originais e incluem batidas, como no espelho.
  const approved = (declaration?.adjustments ?? []).filter((item) => item.status === 'approved');
  const discarded = new Set(approved.filter((item) => item.original && item.kind !== 'include').map((item) => `${item.original!.nsr}|${item.original!.markedAt}`));
  // Efeito da ausência vem do tipo congelado no pedido; a declaração não guarda motivo nem anexo.
  const absenceIds = (declaration?.absences ?? []).filter((item) => item.status === 'approved').map((item) => item.id).slice(0, 200);
  const absenceDocs = absenceIds.length ? await deps.hrDb.getAll(...absenceIds.map((id) => deps.hrDb.collection(ABSENCES).doc(id))) : [];
  const effectById = new Map(absenceDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.get('typeSnapshot.workdayEffect') as DPAbsenceType['workdayEffect'] | undefined]));
  const absences: BankAbsence[] = (declaration?.absences ?? []).filter((item) => item.status === 'approved').map((item) => ({
    id: item.id, typeName: item.typeName, effect: effectById.get(item.id) ?? 'manual_review', unit: item.unit, startDate: item.startDate, endDate: item.endDate,
    minutes: item.unit === 'hour' ? (item.startTime && item.endTime ? Math.max(0, toMinutes(item.endTime) - toMinutes(item.startTime)) : Math.round(item.quantity * 60)) : null,
  }));
  const holidays = new Set(month.holidays);
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
      ...arp.markings.filter((item) => item.workDate === date && !discarded.has(`${item.nsr}|${item.markedAt}`)).map((item) => item.markedAt),
      ...approved.filter((item) => item.workDate === date && item.inclusion).map((item) => item.inclusion!.markedAt),
    ].sort((left, right) => fiscalMs(left) - fiscalMs(right));
    const policy = policyOn(date);
    if (policy) usedPolicies.set(`${policy.id}:${policy.version}`, { id: policy.id, version: policy.version });
    const day = computeBankDay({
      date, shift, markings, holiday: holidays.has(date),
      absences: absences.filter((item) => item.startDate <= date && item.endDate >= date),
      policy: policy ? { id: policy.id, version: policy.version, categories: policy.categories, timeBank: policy.timeBank, dailyOvertimeLimitMinutes: policy.dailyOvertimeLimitMinutes } satisfies BankPolicy : null,
    });
    if (day.kind !== 'no_schedule' || day.workedMinutes || day.lines.length || day.issues.length) days.push(day);
  }
  return { days, totals: monthTotals(days), policies: [...usedPolicies.values()], inputHash: sha256({ markings: arp.markings, shifts: month.shifts, holidays: month.holidays, declaration, absences }) };
}

/** Lê a apuração gravada para a versão vigente do fechamento ou, no mês fechado, apura uma vez e grava. */
async function bankMonthFor(deps: Dependencies, workspaceId: string, competence: string, uid: string, actorUid: string, expectedVersion?: number) {
  const closureRef = deps.hrDb.collection(CLOSURES).doc(closureKey(workspaceId, competence));
  const closure = (await closureRef.get()).data() as ClosureRecord | undefined;
  if (closure?.status !== 'closed') throw fail('PTRP_BANK_NOT_CLOSED', 'O banco de horas do mês é apurado depois do fechamento.', 'CONFLICT');
  if (expectedVersion !== undefined && closure.version !== expectedVersion) throw fail('PTRP_CLOSURE_VERSION_CONFLICT', 'O fechamento mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const target = bankRef(deps, workspaceId, competence, closure.version, uid);
  const existing = (await target.get()).data() as BankMonthDocument | undefined;
  if (existing) return existing;
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
  const uid = subject(context, input.employeeUid, 'close');
  if (uid !== context.decoded.uid && !(await deps.mainDb.collection('users').doc(uid).get()).exists) throw fail('PTRP_BANK_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  return bankMonthFor(deps, context.workspace_id, input.competence, uid, context.decoded.uid, input.expectedVersion);
}

/** Usado pelo AEJ, que já conferiu a permissão de gestor de ponto. */
export async function bankMonthForAej(workspaceId: string, competence: string, uid: string, actorUid: string, injected: Partial<Dependencies> = {}) {
  return bankMonthFor({ ...defaults, ...injected }, workspaceId, competence, uid, actorUid);
}

/**
 * GET: extrato do ciclo que contém a data (padrão: hoje), só leitura. Junta as apurações gravadas das competências
 * fechadas do ciclo; as que faltam aparecem em `missing` (o cliente apura pelo POST). Saldo transportado soma os
 * ciclos anteriores quando o destino do residual é "transportar".
 */
export async function readBankStatement(context: ServerUserContext, query: { employeeUid?: string; date?: string }, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  return statementFor(deps, context.workspace_id, subject(context, query.employeeUid, 'read'), query.date);
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
  const months = stored.filter((doc) => doc.exists).map((doc) => doc.data() as BankMonthDocument);
  const periodCompetences = competencesBetween(start, end);
  // Com saldo transportado, os meses anteriores ao ciclo sem apuração também faltam: o saldo de abertura não pode sair subestimado.
  const missing = (carryFrom ? allCompetences : periodCompetences).filter((competence) => !months.some((month) => month.competence === competence) && competence <= today.slice(0, 7));
  // Abertura: saldo de banco dos dias antes do ciclo, desde o marco, quando o residual é transportado.
  const openingMinutes = !carryFrom || !period ? 0 : months.reduce((total, month) => total + month.days
    .filter((day) => day.date >= carryFrom && day.date < period.start)
    .reduce((acc, day) => acc + day.lines.reduce((sum, line) => sum + (line.nature === 'bank_credit' ? line.minutes : line.nature === 'bank_debit' ? -line.minutes : 0), 0), 0), 0);
  const settlement = period ? ((await settlementRef(deps, workspaceId, uid, period).get()).data() as BankSettlement | undefined) ?? null : null;
  const statement = buildStatement({ period, today, months, missing, openingMinutes, settlement, timeBank: policy.timeBank });
  return { policy: { id: policy.id, version: policy.version, name: policy.name, enabled: policy.timeBank.enabled, cycle: cycle ?? null },
    statement, closures: Object.fromEntries([...closed].filter(([competence]) => missing.includes(competence) || periodCompetences.includes(competence))) };
}

/**
 * POST (DP, `dp.timeClosure.close`): registra o encerramento do ciclo terminado, com o residual conferido e o destino da
 * política. Uma vez por pessoa e ciclo; nada é apagado. O residual difere do esperado quando algo mudou desde a leitura.
 */
export async function settleBankCycle(context: ServerUserContext, input: Extract<TimeBankActionInput, { action: 'settle' }>, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  assertClosureAccess(context, 'close');
  if (!(await deps.mainDb.collection('users').doc(input.employeeUid).get()).exists) throw fail('PTRP_BANK_SUBJECT_INVALID', 'Pessoa não encontrada.', 'NOT_FOUND');
  const { policy, statement, closures } = await statementFor(deps, context.workspace_id, input.employeeUid, input.date);
  if (!policy || !statement?.cycle) throw fail('PTRP_BANK_NO_CYCLE', 'A política desta pessoa não tem ciclo de banco de horas.', 'CONFLICT');
  if (statement.settlement) return statement.settlement;
  if (!statement.ended || !statement.residual) throw fail('PTRP_BANK_CYCLE_OPEN', 'O ciclo ainda não terminou, falta apurar algum mês ou não há saldo a encerrar.', 'CONFLICT');
  if (statement.residual.minutes !== input.expectedMinutes) throw fail('PTRP_BANK_RESIDUAL_CHANGED', 'O saldo mudou desde a sua leitura. Atualize e confira.', 'CONFLICT');
  const record: BankSettlement = { uid: input.employeeUid, cycle: { start: statement.cycle.start, end: statement.cycle.end }, minutes: statement.residual.minutes,
    destination: statement.residual.destination, policy: { id: policy.id, version: policy.version }, closureVersions: closures,
    settledBy: context.decoded.uid, settledAt: deps.now().toISOString() };
  const target = settlementRef(deps, context.workspace_id, input.employeeUid, statement.cycle);
  return deps.hrDb.runTransaction(async (tx) => {
    const again = await tx.get(target);
    if (again.exists) return again.data() as BankSettlement;
    tx.create(target, record);
    return record;
  });
}
