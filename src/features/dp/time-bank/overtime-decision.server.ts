import 'server-only';

import type { Firestore } from 'firebase-admin/firestore';

import { businessToday } from '@/features/dp/rep-p/month-days';
import { sha256 } from '@/features/dp/time-adjustments/closure-core';
import { assertClosureAccess, readCompetenceClosure } from '@/features/dp/time-adjustments/closure.server';
import { readRepPPilotMarkingsForBank } from '@/features/dp/rep-p/service.server';
import { competenceRange } from '@/features/dp/time-adjustments/closure-core';
import { canReview } from '@/features/dp/time-adjustments/service.server';
import { overtimeDecisionEnabled } from '@/features/dp/time-config/rollout.server';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { repPDbAdmin } from '@/lib/firebase-rep-p-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit, canAccessUserByUnit, getLinkedUnitIds } from '@/lib/unit-access';

import type { BankDay, BankPolicy } from './core';
import { decidableOvertimeMinutes, decisionProblem, overtimeOptions, type OvertimeDayView, type OvertimeDecision, type OvertimeMonthView, type OvertimeOption } from './overtime-decision';
import { overtimeDecisionRef, type OvertimeDecisionDocument } from './overtime-decision-store.server';
import type { OvertimeDecisionInput, OvertimeRevokeInput } from '@/features/dp/time-adjustments/schemas';
import { competenceClosureRef, computeBankMonth, pendingRequestDates } from './service.server';

type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; now: () => Date };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, now: () => new Date() };
const HISTORY_LIMIT = 300;

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'CONFLICT' | 'NOT_FOUND' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}

/** Só quem fecha o ponto, com acesso às unidades da pessoa. */
async function employeeInScope(deps: Dependencies, context: ServerUserContext, employeeUid: string) {
  const employee = await deps.mainDb.collection('users').doc(employeeUid).get();
  if (!employee.exists || !canAccessUserByUnit(context.userDoc, employee.data() ?? {}, { isDefaultAdmin: context.isDefaultAdmin })) {
    throw fail('PTRP_OVERTIME_SUBJECT_FORBIDDEN', 'Você não pode acessar o ponto desta pessoa.', 'NOT_FOUND');
  }
  return employee.data() ?? {};
}

/** Um dia só é visto e decidido por quem acessa todas as unidades dele. */
const dayUnits = (item: RawDay | undefined, employee: Record<string, unknown>) =>
  [...new Set(item?.unitIds.length ? item.unitIds : getLinkedUnitIds(employee))].sort();
const reachesDay = (context: ServerUserContext, unitIds: string[]) =>
  context.isDefaultAdmin || (unitIds.length > 0 && unitIds.every((unit) => canAccessUnit(context.userDoc, unit)));

const allowedToDecide = (context: ServerUserContext, employeeUid: string) =>
  (context.isDefaultAdmin || context.permissions.dp.timeClosure?.close === true) && canReview(context) && context.decoded.uid !== employeeUid;

type RawDay = { day: BankDay; policy: BankPolicy | null; unitIds: string[] };
/**
 * A prévia da tela soma as batidas de ensaio e o fechamento não: nesses dias a escolha valeria num cálculo e no
 * outro não, então ela fica indisponível.
 */
async function pilotDates(deps: Dependencies, workspaceId: string, competence: string, employeeUid: string) {
  const { start, end } = competenceRange(competence);
  const pilot = await readRepPPilotMarkingsForBank(workspaceId, employeeUid, start, end, { pilotDb: deps.hrDb });
  if (pilot.truncated) throw fail('PTRP_OVERTIME_INPUT_LIMIT', 'Há batidas de ensaio demais para conferir a hora extra com segurança.', 'CONFLICT');
  return new Set(pilot.markings.map((marking) => marking.workDate));
}

/** O mesmo cálculo da prévia, só com batidas oficiais e antes de qualquer escolha. */
async function rawMonth(deps: Dependencies, workspaceId: string, competence: string, employeeUid: string) {
  const days = new Map<string, RawDay>();
  await computeBankMonth(deps, workspaceId, competence, null, employeeUid,
    { officialOnly: true, onRawDay: (day, policy, unitIds) => days.set(day.date, { day, policy, unitIds }) });
  return days;
}

function blockedReason(date: string, today: string, pending: string | null, pilot: boolean, options: OvertimeOption[]) {
  if (date >= today) return 'O dia ainda não terminou.';
  if (pilot) return 'O dia tem batida de ensaio, que não entra no fechamento. A hora extra dele não pode ser definida aqui.';
  if (pending) return pending;
  if (!options.length) return 'A política não tem faixa que sirva para este tipo de dia. O tempo continua em conferência.';
  return null;
}

/**
 * Hora extra de cada dia da pessoa no mês aberto, com as opções que o servidor aceita.
 * Custo por leitura: uma prévia do banco do mês (escala, até ~200 batidas, pedidos do mês e políticas), o documento
 * de escolhas e o fechamento. Carregada ao abrir o registro da pessoa e depois de cada decisão, sem polling.
 */
export async function readOvertimeMonth(context: ServerUserContext, query: { competence: string; employeeUid: string },
  injected: Partial<Dependencies> = {}): Promise<OvertimeMonthView> {
  assertClosureAccess(context, 'read');
  const deps = { ...defaults, ...injected };
  const closure = await competenceClosureRef(deps.hrDb, context.workspace_id, query.competence).get();
  const closed = closure.get('status') === 'closed';
  const base = { enabled: overtimeDecisionEnabled(), competence: query.competence, closed, closureVersion: Number(closure.get('version') ?? 0),
    revision: 0, canDecide: false, days: [] as OvertimeDayView[] };
  if (!base.enabled || closed) return base;
  const employee = await employeeInScope(deps, context, query.employeeUid);
  const [raw, pilot, pending, stored] = await Promise.all([
    rawMonth(deps, context.workspace_id, query.competence, query.employeeUid),
    pilotDates(deps, context.workspace_id, query.competence, query.employeeUid),
    pendingRequestDates(deps.hrDb, context.workspace_id, query.competence, query.employeeUid),
    overtimeDecisionRef(deps.hrDb, context.workspace_id, query.competence, query.employeeUid).get(),
  ]);
  const document = stored.data() as OvertimeDecisionDocument | undefined;
  const today = businessToday(deps.now());
  const days: OvertimeDayView[] = [...raw.entries()].flatMap(([date, item]) => {
    const sourceMinutes = decidableOvertimeMinutes(item.day, item.policy);
    const decision = document?.days?.[date] ?? null;
    if ((!sourceMinutes && !decision) || !reachesDay(context, dayUnits(item, employee))) return [];
    const { options, suggestion } = overtimeOptions(item.day, item.policy);
    return [{ date, sourceMinutes, options, suggestion, decision,
      outdated: decision && sourceMinutes ? decisionProblem(item.day, item.policy, decision) : null,
      blockedReason: sourceMinutes ? blockedReason(date, today, pending(date), pilot.has(date), options) : null }];
  });
  return { ...base, revision: document?.revision ?? 0, canDecide: allowedToDecide(context, query.employeeUid), days };
}

/** Grava ou desfaz a escolha de um dia do mês aberto. As opções e o tempo extra são recalculados no servidor. */
export async function actOnOvertimeDecision(context: ServerUserContext, input: OvertimeDecisionInput | OvertimeRevokeInput,
  injected: Partial<Dependencies> = {}) {
  assertClosureAccess(context, 'close');
  if (!overtimeDecisionEnabled()) throw fail('PTRP_OVERTIME_DECISION_PENDING', 'A escolha da hora extra por dia está desligada.', 'CONFLICT');
  if (!allowedToDecide(context, input.employeeUid)) throw fail('PTRP_OVERTIME_DECISION_FORBIDDEN', 'Sem permissão para definir a hora extra desta pessoa.', 'AUTHORIZATION');
  const deps = { ...defaults, ...injected };
  const user = await employeeInScope(deps, context, input.employeeUid);
  const competence = input.date.slice(0, 7);
  const ref = overtimeDecisionRef(deps.hrDb, context.workspace_id, competence, input.employeeUid);
  const closureRef = competenceClosureRef(deps.hrDb, context.workspace_id, competence);
  const requestHash = sha256(input.action === 'decideOvertime'
    ? [input.action, input.employeeUid, input.date, input.sourceMinutes, input.parts, input.reason]
    : [input.action, input.employeeUid, input.date]);
  /** Repetição devolve o que foi gravado; mês fechado e revisão velha são recusados. */
  const settled = (closureStatus: unknown, current: OvertimeDecisionDocument | undefined) => {
    const replay = current?.history.find((act) => act.operationId === input.operationId);
    if (replay) {
      if (replay.requestHash !== requestHash) throw fail('PTRP_OVERTIME_OPERATION_CONFLICT', 'Esta operação já foi usada com outros dados.', 'CONFLICT');
      return { revision: current!.revision, decision: replay.decision };
    }
    if (closureStatus === 'closed') throw fail('PTRP_OVERTIME_CLOSED', 'O mês está fechado. Reabra a competência para mudar a hora extra.', 'CONFLICT');
    if ((current?.revision ?? 0) !== input.expectedRevision) throw fail('PTRP_OVERTIME_REVISION_CONFLICT', 'Outra pessoa mudou a hora extra deste mês. Atualize e confira.', 'CONFLICT');
    return null;
  };
  // Conferido antes das leituras pesadas e de novo dentro da transação.
  const [closureBefore, documentBefore] = await deps.hrDb.getAll(closureRef, ref);
  const done = settled(closureBefore.get('status'), documentBefore.data() as OvertimeDecisionDocument | undefined);
  if (done) {
    // A repetição também respeita o acesso às unidades já registradas.
    if (!reachesDay(context, (documentBefore.get('unitIds') as string[]) ?? [])) throw fail('PTRP_OVERTIME_DECISION_FORBIDDEN', 'Você não tem acesso a todas as unidades deste dia.', 'AUTHORIZATION');
    return done;
  }
  const state = await readCompetenceClosure(context, competence, deps);
  if (state.truncated || !state.people.some((person) => person.uid === input.employeeUid)) {
    throw fail('PTRP_OVERTIME_SUBJECT_INVALID', 'Pessoa fora da equipe deste mês.', 'NOT_FOUND');
  }
  const [raw, pilot, pending] = await Promise.all([
    rawMonth(deps, context.workspace_id, competence, input.employeeUid),
    pilotDates(deps, context.workspace_id, competence, input.employeeUid),
    pendingRequestDates(deps.hrDb, context.workspace_id, competence, input.employeeUid),
  ]);
  const item = raw.get(input.date);
  const unitIds = dayUnits(item, user);
  if (!reachesDay(context, unitIds)) {
    throw fail('PTRP_OVERTIME_DECISION_FORBIDDEN', 'Você não tem acesso a todas as unidades deste dia.', 'AUTHORIZATION');
  }
  const at = deps.now().toISOString();
  let decision: OvertimeDecision | null = null;
  if (input.action === 'decideOvertime') {
    if (!item || !item.policy) throw fail('PTRP_OVERTIME_DAY_CHANGED', 'O dia mudou desde a leitura. Atualize e confira.', 'CONFLICT');
    const blocked = blockedReason(input.date, businessToday(deps.now()), pending(input.date), pilot.has(input.date), overtimeOptions(item.day, item.policy).options);
    if (blocked) throw fail('PTRP_OVERTIME_DAY_BLOCKED', blocked, 'CONFLICT');
    if (decidableOvertimeMinutes(item.day, item.policy) !== input.sourceMinutes) throw fail('PTRP_OVERTIME_DAY_CHANGED', 'O tempo extra do dia mudou desde a leitura. Atualize e confira.', 'CONFLICT');
    decision = { date: input.date, sourceMinutes: input.sourceMinutes, policy: { id: item.policy.id, version: item.policy.version },
      parts: input.parts, reason: input.reason, decidedBy: context.decoded.uid, decidedAt: at };
    const problem = decisionProblem(item.day, item.policy, decision);
    if (problem) throw fail('PTRP_OVERTIME_DECISION_INVALID', problem, 'VALIDATION');
  }
  return deps.hrDb.runTransaction(async (tx) => {
    // O fechamento lê as escolhas e grava este documento na mesma transação dele: as duas escritas não se cruzam.
    const [closure, snapshot] = await tx.getAll(closureRef, ref);
    const current = snapshot.data() as OvertimeDecisionDocument | undefined;
    const repeated = settled(closure.get('status'), current);
    if (repeated) return repeated;
    if ((current?.history.length ?? 0) >= HISTORY_LIMIT) throw fail('PTRP_OVERTIME_HISTORY_LIMIT', 'Há alterações demais neste mês. Fale com o desenvolvimento.', 'CONFLICT');
    const days = { ...(current?.days ?? {}) };
    if (decision) days[input.date] = decision;
    else {
      if (!days[input.date]) throw fail('PTRP_OVERTIME_DECISION_NOT_FOUND', 'Não há escolha gravada neste dia.', 'NOT_FOUND');
      delete days[input.date];
    }
    const record: OvertimeDecisionDocument = {
      schemaVersion: 1, workspaceId: context.workspace_id, competence, employeeUid: input.employeeUid,
      unitIds: [...new Set([...(current?.unitIds ?? []), ...unitIds])].sort(),
      actorUids: [...new Set([...(current?.actorUids ?? []), context.decoded.uid])].sort(),
      revision: (current?.revision ?? 0) + 1, days,
      history: [...(current?.history ?? []), { operationId: input.operationId, requestHash, action: decision ? 'decided' : 'revoked',
        date: input.date, by: context.decoded.uid, at, decision }],
      updatedAt: at,
    };
    tx.set(ref, record);
    return { revision: record.revision, decision };
  });
}
