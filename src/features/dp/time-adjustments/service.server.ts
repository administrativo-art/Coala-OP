import 'server-only';

import { createHash } from 'node:crypto';

import type { Firestore } from 'firebase-admin/firestore';

import { resolveEmploymentReferenceForSystem } from '@/features/dp/employment-reference/service.server';
import { configuredRepPClock } from '@/features/dp/rep-p/hlb-ntp-clock.server';
import { readOwnRepPReceiptForAdjustment, repPEstablishmentForEmployer } from '@/features/dp/rep-p/service.server';
import { repPMarkingTimeZone } from '@/features/dp/rep-p/time-zones';
import type { ServerUserContext } from '@/lib/auth-server';
import { dbAdmin } from '@/lib/firebase-admin';
import { hrDbAdmin } from '@/lib/firebase-rh-admin';
import { AppError } from '@/lib/observability/app-error';
import { canAccessUnit } from '@/lib/unit-access';

import {
  adjustmentActHash, adjustmentPayloadDigest, aejReason, zonedFiscalTimestamp,
  type AdjustmentAct, type AdjustmentKind, type AdjustmentStatus,
} from './core';
import type { AdjustmentDecisionInput, AdjustmentMonthInput, CreateAdjustmentInput } from './schemas';

export const ADJUSTMENTS = 'ptrp_adjustmentRequests';
export const TREATMENTS = 'ptrp_treatments';
/** Documento da competência fechada; criado pelo fechamento (etapa 6). Período fechado não aceita pedido. */
export const CLOSURES = 'ptrp_competenceClosures';
const REVIEW_LIMIT = 50;
const MONTH_LIMIT = 200;

export type AdjustmentRecord = {
  id: string; workspaceId: string; employeeUid: string; employeeName: string | null; workDate: string;
  kind: AdjustmentKind; status: AdjustmentStatus; version: number;
  establishmentId: string; unitId: string;
  target: { receiptId: string; nsr: number; markedAt: string; executionUnitId: string } | null;
  inclusion: { markedAt: string; executionUnitId: string } | null;
  reason: string; aejReason: string;
  acts: AdjustmentAct[];
  createdAt: string; updatedAt: string; decidedAt?: string; decidedBy?: string;
};

type Clock = { read(): Promise<{ instant: Date }> };
type Dependencies = { mainDb: Firestore; hrDb: Firestore; repDb: Firestore; clock: Clock };
// Sem Hora Legal configurada, o ato usa o relógio do servidor e registra essa origem.
const unavailableClock: Clock = { async read() { throw new Error('Hora Legal não configurada.'); } };
const defaults: Dependencies = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock: configuredRepPClock() ?? unavailableClock };

function fail(code: string, safeMessage: string, kind: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'AUTHORIZATION' = 'VALIDATION') {
  return new AppError({ code, kind, safeMessage });
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Instante do ato pela Hora Legal; se a fonte estiver fora, usa o relógio do servidor e registra a origem. */
async function actInstant(clock: Clock) {
  try {
    const reading = await clock.read();
    return { at: reading.instant.toISOString(), clockSource: 'hora_legal' as const };
  } catch {
    return { at: new Date().toISOString(), clockSource: 'server' as const };
  }
}

function closureKey(workspaceId: string, workDate: string) { return `${workspaceId}_${workDate.slice(0, 7)}`; }

async function assertOpenCompetence(hrDb: Firestore, workspaceId: string, workDate: string) {
  const closure = await hrDb.collection(CLOSURES).doc(closureKey(workspaceId, workDate)).get();
  if (closure.exists && closure.get('status') === 'closed') {
    throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada; não aceita pedido de ajuste.', 'CONFLICT');
  }
}

async function hasActiveDiscard(hrDb: Firestore, workspaceId: string, receiptId: string) {
  const found = await hrDb.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('originalReceiptId', '==', receiptId)
    .where('status', '==', 'active').limit(1).get();
  return !found.empty;
}

function canReview(context: ServerUserContext) {
  return context.isDefaultAdmin || context.permissions.dp?.requests?.review === true;
}

export function adjustmentDto(value: AdjustmentRecord) {
  const { aejReason: _aej, ...rest } = value;
  void _aej;
  return rest;
}

/** Pedido do próprio titular: valida vínculo, batida alvo e competência aberta; grava o primeiro ato encadeado. */
export async function createOwnAdjustment(context: ServerUserContext, input: CreateAdjustmentInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const docId = digest(['adjustment', context.workspace_id, context.decoded.uid, input.attemptId]);
  const ref = deps.hrDb.collection(ADJUSTMENTS).doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    const stored = existing.data() as AdjustmentRecord;
    if (stored.employeeUid !== context.decoded.uid || stored.workDate !== input.workDate || stored.kind !== input.kind
      || stored.reason !== input.reason || (stored.target?.receiptId ?? null) !== (input.targetReceiptId ?? null)
      || (stored.inclusion?.markedAt.slice(11, 16) ?? null) !== (input.newTime ?? null)) {
      throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Tentativa reutilizada com conteúdo diferente.', 'CONFLICT');
    }
    return adjustmentDto(stored);
  }
  await assertOpenCompetence(deps.hrDb, context.workspace_id, input.workDate);
  const reference = await resolveEmploymentReferenceForSystem({ workspaceId: context.workspace_id,
    userId: context.decoded.uid, date: input.workDate, database: deps.mainDb });
  if (reference.status !== 'matched') throw fail('PTRP_EMPLOYMENT_UNRESOLVED', 'Não há vínculo válido para a data do ajuste.');

  let target: AdjustmentRecord['target'] = null;
  if (input.targetReceiptId) {
    target = await readOwnRepPReceiptForAdjustment(context, input.targetReceiptId, input.workDate, { repDb: deps.repDb });
    if (!target) throw fail('PTRP_ADJUSTMENT_TARGET_INVALID', 'Batida não encontrada neste dia.', 'NOT_FOUND');
  }

  const establishment = await repPEstablishmentForEmployer(context.workspace_id, reference.period.employer.cnpj, { repDb: deps.repDb });
  let inclusion: AdjustmentRecord['inclusion'] = null;
  if (input.newTime) {
    const unitId = input.executionUnitId ?? target?.executionUnitId ?? reference.period.employerUnitId;
    if (!reference.period.unitIds.includes(unitId)) {
      throw fail('PTRP_ADJUSTMENT_UNIT_OUTSIDE_EMPLOYMENT', 'A unidade não pertence ao vínculo nesta data.', 'AUTHORIZATION');
    }
    const unit = await deps.mainDb.collection('dp_units').doc(unitId).get();
    const zone = repPMarkingTimeZone(unit.get('timeZone'), establishment.timeZone ?? 'America/Fortaleza');
    inclusion = { markedAt: zonedFiscalTimestamp(input.workDate, input.newTime, zone), executionUnitId: unitId };
    // Dia e horário futuros pelo fuso da unidade: não se inclui batida que ainda não aconteceu.
    if (Date.parse(inclusion.markedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) > Date.now()) {
      throw fail('PTRP_ADJUSTMENT_FUTURE', 'Não é possível incluir um horário que ainda não aconteceu.');
    }
  }

  const pending = await deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('employeeUid', '==', context.decoded.uid).where('workDate', '==', input.workDate).where('status', '==', 'in_review').limit(10).get();
  if (target && pending.docs.some((doc) => (doc.get('target') as AdjustmentRecord['target'])?.receiptId === target!.receiptId)) {
    throw fail('PTRP_ADJUSTMENT_DUPLICATE', 'Já existe um pedido em análise para esta batida.', 'CONFLICT');
  }
  if (target && await hasActiveDiscard(deps.hrDb, context.workspace_id, target.receiptId)) {
    throw fail('PTRP_ADJUSTMENT_ALREADY_TREATED', 'Esta batida já foi desconsiderada por um ajuste aprovado.', 'CONFLICT');
  }

  const { at, clockSource } = await actInstant(deps.clock);
  const payload = { kind: input.kind, workDate: input.workDate, target, inclusion, reason: input.reason };
  const firstAct = { action: 'requested' as const, actorUid: context.decoded.uid, role: 'titular' as const, at, clockSource };
  const value: AdjustmentRecord = {
    id: docId, workspaceId: context.workspace_id, employeeUid: context.decoded.uid,
    employeeName: typeof context.userDoc.username === 'string' ? context.userDoc.username.slice(0, 120) : null,
    workDate: input.workDate, kind: input.kind, status: 'in_review', version: 1,
    establishmentId: establishment.establishmentId,
    unitId: inclusion?.executionUnitId ?? target?.executionUnitId ?? reference.period.employerUnitId,
    target, inclusion, reason: input.reason, aejReason: aejReason(input.reason),
    acts: [{ ...firstAct, previousHash: null, hash: adjustmentActHash(null, firstAct, adjustmentPayloadDigest(payload)) }],
    createdAt: at, updatedAt: at,
  };
  await deps.hrDb.runTransaction(async (tx) => {
    const [again, closure] = await Promise.all([tx.get(ref), tx.get(deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, input.workDate)))]);
    if (again.exists) throw fail('PTRP_ADJUSTMENT_ATTEMPT_CONFLICT', 'Pedido já registrado.', 'CONFLICT');
    if (closure.exists && closure.get('status') === 'closed') throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada; não aceita pedido de ajuste.', 'CONFLICT');
    tx.create(ref, value);
  });
  return adjustmentDto(value);
}

/** Pedidos e tratamentos do próprio titular no mês, para o Registro de ponto. */
export async function listOwnAdjustments(context: ServerUserContext, input: AdjustmentMonthInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const start = `${input.month}-01`;
  const end = `${input.month}-31`;
  const [requests, treatments] = await Promise.all([
    deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', context.workspace_id).where('employeeUid', '==', context.decoded.uid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(MONTH_LIMIT).get(),
    deps.hrDb.collection(TREATMENTS).where('workspaceId', '==', context.workspace_id).where('employeeUid', '==', context.decoded.uid)
      .where('workDate', '>=', start).where('workDate', '<=', end).orderBy('workDate').limit(MONTH_LIMIT * 2).get(),
  ]);
  return {
    month: input.month,
    adjustments: requests.docs.map((doc) => adjustmentDto(doc.data() as AdjustmentRecord)),
    treatments: treatments.docs.filter((doc) => doc.get('status') === 'active').map((doc) => ({
      id: doc.id, adjustmentId: String(doc.get('adjustmentId')), workDate: String(doc.get('workDate')),
      type: doc.get('type') as 'discard' | 'inclusion', originalReceiptId: (doc.get('originalReceiptId') as string | null) ?? null,
      markedAt: (doc.get('markedAt') as string | null) ?? null, executionUnitId: (doc.get('executionUnitId') as string | null) ?? null,
    })),
  };
}

/** Fila de quem analisa: em análise, nas unidades acessíveis, sem os próprios pedidos. */
export async function listAdjustmentsForReview(context: ServerUserContext, injected: Partial<Dependencies> = {}) {
  if (!canReview(context)) throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para analisar ajustes de ponto.', 'AUTHORIZATION');
  const deps = { ...defaults, ...injected };
  // Pagina até achar 50 visíveis (ou ler 500): pedidos de unidades inacessíveis não escondem os acessíveis.
  const base = deps.hrDb.collection(ADJUSTMENTS).where('workspaceId', '==', context.workspace_id)
    .where('status', '==', 'in_review').orderBy('createdAt', 'asc');
  const visible: AdjustmentRecord[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (let scanned = 0; visible.length < REVIEW_LIMIT && scanned < REVIEW_LIMIT * 10;) {
    const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).limit(REVIEW_LIMIT).get();
    scanned += page.size;
    for (const doc of page.docs) {
      const value = doc.data() as AdjustmentRecord;
      if (value.employeeUid !== context.decoded.uid && canAccessUnit(context.userDoc, value.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
        visible.push(value);
      }
    }
    if (page.size < REVIEW_LIMIT) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return { adjustments: visible.slice(0, REVIEW_LIMIT).map(adjustmentDto) };
}

/**
 * Decisão (aprovar/recusar, com justificativa obrigatória) por quem analisa, ou cancelamento pelo titular.
 * Aprovar cria, na mesma transação, a desconsideração da original e/ou a inclusão da nova em `ptrp_treatments`.
 */
export async function decideAdjustment(context: ServerUserContext, adjustmentId: string, input: AdjustmentDecisionInput, injected: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...injected };
  const ref = deps.hrDb.collection(ADJUSTMENTS).doc(adjustmentId);
  const before = await ref.get();
  if (!before.exists || before.get('workspaceId') !== context.workspace_id) throw fail('PTRP_ADJUSTMENT_NOT_FOUND', 'Pedido não encontrado.', 'NOT_FOUND');
  const current = before.data() as AdjustmentRecord;
  const isOwner = current.employeeUid === context.decoded.uid;
  if (input.action === 'cancel') {
    if (!isOwner) throw fail('PTRP_ADJUSTMENT_FORBIDDEN', 'Só o titular cancela o próprio pedido.', 'AUTHORIZATION');
  } else {
    if (isOwner) throw fail('PTRP_ADJUSTMENT_SELF_DECISION', 'Quem pediu não pode decidir o próprio ajuste.', 'AUTHORIZATION');
    if (!canReview(context) || !canAccessUnit(context.userDoc, current.unitId, { isDefaultAdmin: context.isDefaultAdmin })) {
      throw fail('PTRP_ADJUSTMENT_REVIEW_FORBIDDEN', 'Sem permissão para decidir este ajuste.', 'AUTHORIZATION');
    }
    await assertOpenCompetence(deps.hrDb, context.workspace_id, current.workDate);
  }
  const { at, clockSource } = await actInstant(deps.clock);
  const discardTaken = input.action === 'approve' && current.target && current.kind !== 'include'
    ? await hasActiveDiscard(deps.hrDb, context.workspace_id, current.target.receiptId) : false;
  if (discardTaken) throw fail('PTRP_ADJUSTMENT_ALREADY_TREATED', 'Esta batida já foi desconsiderada por outro ajuste aprovado.', 'CONFLICT');
  const result = await deps.hrDb.runTransaction(async (tx) => {
    const [snapshot, closure] = await Promise.all([tx.get(ref), tx.get(deps.hrDb.collection(CLOSURES).doc(closureKey(context.workspace_id, current.workDate)))]);
    const value = snapshot.data() as AdjustmentRecord;
    if (input.action !== 'cancel' && closure.exists && closure.get('status') === 'closed') {
      throw fail('PTRP_COMPETENCE_CLOSED', 'Esta competência já foi fechada.', 'CONFLICT');
    }
    if (value.status !== 'in_review') throw fail('PTRP_ADJUSTMENT_NOT_PENDING', 'Este pedido já foi decidido.', 'CONFLICT');
    if (value.version !== input.expectedVersion) throw fail('PTRP_ADJUSTMENT_VERSION_CONFLICT', 'O pedido mudou. Atualize e tente de novo.', 'CONFLICT');
    const action = input.action === 'approve' ? 'approved' as const : input.action === 'reject' ? 'rejected' as const : 'cancelled' as const;
    const act = { action, actorUid: context.decoded.uid, role: isOwner ? 'titular' as const : 'reviewer' as const, at, clockSource,
      ...('reason' in input ? { reason: input.reason } : {}) };
    const previousHash = value.acts.at(-1)?.hash ?? null;
    const next: AdjustmentRecord = { ...value, status: action, version: value.version + 1, updatedAt: at,
      acts: [...value.acts, { ...act, previousHash, hash: adjustmentActHash(previousHash, act, adjustmentPayloadDigest({ id: value.id, status: action })) }],
      ...(action !== 'cancelled' ? { decidedAt: at, decidedBy: context.decoded.uid } : {}) };
    tx.set(ref, next);
    if (action === 'approved') {
      // Original preservada na ARP; o tratamento só acrescenta informação identificada (art. 82 p.ú.).
      const common = { workspaceId: value.workspaceId, employeeUid: value.employeeUid, workDate: value.workDate,
        establishmentId: value.establishmentId, adjustmentId: value.id, motivo: value.aejReason,
        requesterUid: value.employeeUid, decidedBy: context.decoded.uid, decidedAt: at, status: 'active',
        decisionReason: 'reason' in input ? input.reason : null, approvalActHash: next.acts.at(-1)!.hash };
      if (value.target && value.kind !== 'include') {
        tx.create(deps.hrDb.collection(TREATMENTS).doc(`${value.id}_discard`), { ...common, type: 'discard',
          originalReceiptId: value.target.receiptId, originalNsr: value.target.nsr, originalMarkedAt: value.target.markedAt,
          markedAt: null, executionUnitId: value.target.executionUnitId });
      }
      if (value.inclusion && value.kind !== 'discard') {
        tx.create(deps.hrDb.collection(TREATMENTS).doc(`${value.id}_inclusion`), { ...common, type: 'inclusion',
          originalReceiptId: null, markedAt: value.inclusion.markedAt, executionUnitId: value.inclusion.executionUnitId });
      }
    }
    return next;
  });
  return adjustmentDto(result);
}
