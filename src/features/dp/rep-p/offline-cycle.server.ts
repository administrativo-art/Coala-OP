import 'server-only';

import { createHash, createPublicKey, verify } from 'node:crypto';
import { FieldPath, Timestamp, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { ServerUserContext } from '@/lib/auth-server';
import { AppError } from '@/lib/observability/app-error';
import { canonicalRepPCycleAction, offlineCycleWindow, REP_P_OFFLINE_CYCLE_TTL_MS,
  type RepPOfflineCycleEvidence } from './offline';
import { repPOfflineCycleActionSchema } from './schemas';

export const REP_P_OFFLINE_CYCLES = 'repP_offlineCycles';
export const REP_P_OFFLINE_CYCLE_HEADS = 'repP_offlineCycleHeads';
export type OfflineCycleDto = { id: string; startedAt: string; expiresAt: string;
  startedElapsedRealtimeMs: number; permitId: string; status: 'active' | 'closed'; lastReceiptId: string; lastElapsedRealtimeMs: number };
export type CyclePermit = {
  protocolVersion?: 2; scope?: 'official' | 'pilot'; workspaceId: string; employeeId: string;
  permitId: string; installationId: string; deviceKeyId: string; devicePublicKey: string; bootCount: number;
  anchorInstant: string; anchorElapsedRealtimeMs: number; preparationExpiresAt?: string;
  status: string; lastAcceptedSequence: number; cycle?: OfflineCycleDto;
};
const key = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
function fail(code: string, message: string) { return new AppError({ code, kind: 'CONFLICT', safeMessage: message }); }
export function offlineCycleRefs(db: Firestore, workspaceId: string, employeeId: string, cycleId: string) {
  return { cycle: db.collection(REP_P_OFFLINE_CYCLES).doc(key([workspaceId, employeeId, cycleId])),
    head: db.collection(REP_P_OFFLINE_CYCLE_HEADS).doc(key([workspaceId, employeeId])) };
}
function permitRef(db: Firestore, permit: Pick<CyclePermit, 'scope' | 'permitId'>) {
  return db.collection(permit.scope === 'pilot' ? 'repP_pilotOfflinePermits' : 'repP_offlinePermits').doc(permit.permitId);
}
function dto(cycle: FirebaseFirestore.DocumentData): OfflineCycleDto | undefined {
  if (!cycle.permitId || !Number.isSafeInteger(cycle.startedElapsedRealtimeMs)) return undefined;
  return { id: cycle.cycleId, permitId: cycle.permitId, startedAt: new Date(cycle.startedAtMs).toISOString(),
    expiresAt: new Date(cycle.expiresAtMs).toISOString(), startedElapsedRealtimeMs: cycle.startedElapsedRealtimeMs,
    lastReceiptId: cycle.lastReceiptId, lastElapsedRealtimeMs: cycle.startedElapsedRealtimeMs + cycle.lastCapturedAtMs - cycle.startedAtMs,
    status: cycle.status === 'closed' ? 'closed' : 'active' };
}
function binding(permit: CyclePermit) {
  return { permitId: permit.permitId, deviceKeyId: permit.deviceKeyId, bootCount: permit.bootCount,
    installationId: permit.installationId };
}
function sameDevice(head: FirebaseFirestore.DocumentData, permit: CyclePermit) {
  return head.leaseDeviceKeyId === permit.deviceKeyId && head.leaseInstallationId === permit.installationId
    && head.leaseBootCount === permit.bootCount;
}
function lease(permit: CyclePermit, expiresAtMs: number) {
  return { leasePermitId: permit.permitId, leaseDeviceKeyId: permit.deviceKeyId,
    leaseInstallationId: permit.installationId, leaseBootCount: permit.bootCount,
    leasePreparedAtMs: Date.parse(permit.anchorInstant), leaseExpiresAtMs: expiresAtMs };
}


const ONLINE_RECONCILIATION_LIMIT = 128;
function pendingOnlineQuery(db: Firestore, context: Pick<ServerUserContext, 'workspace_id' | 'decoded'>,
  head: FirebaseFirestore.DocumentData, scope: 'official' | 'pilot') {
  let query = db.collection(scope === 'official' ? 'repP_attempts' : 'repP_pilotMarkings')
    .where('workspaceId', '==', context.workspace_id).where('employeeId', '==', context.decoded.uid)
    .orderBy('cycleCandidate.committedAt').orderBy(FieldPath.documentId()).limit(1);
  if (head.onlineCursorCommittedAt instanceof Timestamp && typeof head.onlineCursorId === 'string')
    query = query.startAfter(head.onlineCursorCommittedAt, head.onlineCursorId);
  return query;
}
async function assertOnlineProjectionCurrent(transaction: Transaction, db: Firestore, context: ServerUserContext,
  head: FirebaseFirestore.DocumentData, scope: 'official' | 'pilot') {
  if (!(await transaction.get(pendingOnlineQuery(db, context, head, scope))).empty)
    throw fail('REP_P_OFFLINE_CYCLE_RECONCILIATION_REQUIRED', 'O ponto está registrado. Conecte o aparelho para reconciliar o preparo antes de registrar sem internet.');
}

/** Originals commit independently. Only offline authorization waits for this recoverable projection. */
export async function reconcileOnlineCycles(db: Firestore, context: ServerUserContext, scope: 'official' | 'pilot', maximumCandidates = ONLINE_RECONCILIATION_LIMIT) {
  const headRef = offlineCycleRefs(db, context.workspace_id, context.decoded.uid, '').head;
  for (let index = 0; index < maximumCandidates; index++) {
    const result = await db.runTransaction(async transaction => {
      const head = (await transaction.get(headRef)).data() ?? {};
      const pending = await transaction.get(pendingOnlineQuery(db, context, head, scope));
      if (pending.empty) return { done: true, cycleId: head.cycleId };
      const original = pending.docs[0];
      const candidate = original.get('cycleCandidate');
      if (!candidate || !(candidate.committedAt instanceof Timestamp) || !Number.isSafeInteger(candidate.instantMs) || typeof candidate.attemptId !== 'string'
        || typeof candidate.receiptId !== 'string') throw fail('REP_P_OFFLINE_CYCLE_CANDIDATE_INVALID', 'Reconcilie o registro original antes de preparar o uso sem internet.');
      const cycle = await stageOnlineCycle(transaction, db, context, candidate.instantMs, candidate.attemptId, candidate.purpose ?? undefined, scope);
      cycle.commit(candidate.receiptId);
      transaction.set(headRef, { onlineCursorCommittedAt: candidate.committedAt, onlineCursorId: original.id }, { merge: true });
      return { done: false, cycleId: cycle.id };
    });
    if (result.done) return readOfflineCycleDto(db, context, result.cycleId);
  }
  throw fail('REP_P_OFFLINE_CYCLE_RECONCILIATION_REQUIRED', 'Há registros pendentes de reconciliação. A marcação online continua disponível.');
}

/** One capture device, including the interval before its first offline upload. */
export async function createOfflineCyclePermit(db: Firestore, ref: DocumentReference, permit: CyclePermit): Promise<CyclePermit> {
  const headRef = offlineCycleRefs(db, permit.workspaceId, permit.employeeId, permit.permitId).head;
  return db.runTransaction(async (transaction) => {
    const headDoc = await transaction.get(headRef);
    const head = headDoc.data() ?? {};
    if (permit.protocolVersion !== 2) {
      if (head.minimumProtocol === 2) throw fail('REP_P_OFFLINE_UPGRADE_REQUIRED', 'Atualize o aplicativo para preparar o próximo ciclo.');
      transaction.create(ref, { ...permit, createdAt: Timestamp.now() });
      return permit;
    }
    const now = Date.parse(permit.anchorInstant);
    const cycleRef = typeof head.cycleId === 'string'
      ? offlineCycleRefs(db, permit.workspaceId, permit.employeeId, head.cycleId).cycle : null;
    const currentDoc = cycleRef ? await transaction.get(cycleRef) : null;
    const current = currentDoc?.data();
    if (permit.protocolVersion === 2) await assertOnlineProjectionCurrent(transaction, db,
      { workspace_id: permit.workspaceId, decoded: { uid: permit.employeeId } } as ServerUserContext, head, permit.scope ?? 'official');
    if (current?.status === 'active') {
      if (current.permitId) {
        if (!sameDevice(head, permit)) throw fail('REP_P_OFFLINE_DEVICE_LOCKED', 'Este ciclo está preparado em outro aparelho ou inicialização. Conclua a sincronização antes da troca.');
        const original = (await transaction.get(permitRef(db, { ...permit, permitId: current.permitId }))).data() as CyclePermit | undefined;
        if (!original || original.status !== 'active') throw fail('REP_P_OFFLINE_CYCLE_PERMIT_INVALID', 'O preparo do ciclo está inconsistente.');
        return { ...original, cycle: dto(current) };
      }
      if (head.leaseDeviceKeyId && !sameDevice(head, permit)) {
        throw fail('REP_P_OFFLINE_DEVICE_LOCKED', 'Reconcilie o aparelho já preparado antes de transferir este ciclo.');
      }
      if (now > Number(current.expiresAtMs)) throw fail('REP_P_OFFLINE_CYCLE_NEEDS_CLOSE', 'Encerre o ciclo anterior ou registre o início da próxima jornada com conexão.');
    }
    if (head.leaseExpiresAtMs > now && !sameDevice(head, permit)) {
      throw fail('REP_P_OFFLINE_DEVICE_LOCKED', 'Outro aparelho já está preparado para este ciclo. Sincronize e encerre-o antes da troca.');
    }
    let boundCycle: FirebaseFirestore.DocumentData | undefined;
    if (current?.status === 'active') {
      boundCycle = { ...current, ...binding(permit),
        startedElapsedRealtimeMs: permit.anchorElapsedRealtimeMs + Number(current.startedAtMs) - now };
    }
    transaction.create(ref, { ...permit, previousCycleId: current?.status === 'closed' ? current.cycleId : null, createdAt: Timestamp.now() });
    if (boundCycle && cycleRef) transaction.update(cycleRef, bindingFields(boundCycle));
    transaction.set(headRef, { workspaceId: permit.workspaceId, employeeId: permit.employeeId, minimumProtocol: 2,
      protocolEnrolledAtMs: head.minimumProtocol === 2 ? head.protocolEnrolledAtMs : now,
      ...lease(permit, boundCycle ? Number(boundCycle.expiresAtMs) : now + 2 * REP_P_OFFLINE_CYCLE_TTL_MS) }, { merge: true });
    return { ...permit, ...(boundCycle ? { cycle: dto(boundCycle) } : {}) };
  });
}
function bindingFields(value: FirebaseFirestore.DocumentData) {
  return { permitId: value.permitId, deviceKeyId: value.deviceKeyId, bootCount: value.bootCount,
    installationId: value.installationId, startedElapsedRealtimeMs: value.startedElapsedRealtimeMs };
}

/** Capturing an online original fixes the first instant even if the response or auxiliary call is lost. */
export async function stageOnlineCycle(transaction: Transaction, db: Firestore, context: ServerUserContext,
  instantMs: number, attemptId: string, purpose?: string, scope: 'official' | 'pilot' = 'official') {
  const refs = offlineCycleRefs(db, context.workspace_id, context.decoded.uid, attemptId);
  const headDoc = await transaction.get(refs.head);
  const head = headDoc.data() ?? {};
  const currentRef = typeof head.cycleId === 'string'
    ? offlineCycleRefs(db, context.workspace_id, context.decoded.uid, head.cycleId).cycle : null;
  const currentDoc = currentRef ? await transaction.get(currentRef) : null;
  const current = currentDoc?.data();
  if (current?.status === 'closed' && instantMs <= Number(current.closedAtMs)) throw fail('REP_P_OFFLINE_CYCLE_ORDER_UNRESOLVED', 'Reconcilie o registro anterior ao encerramento antes de preparar outro ciclo.');
  if (current && instantMs < Number(current.lastCapturedAtMs)) throw fail('REP_P_OFFLINE_CYCLE_ORDER_UNRESOLVED', 'O ponto está registrado; reconcilie a ordem dos registros antes de usar sem internet.');
  const transition = !current || current.status === 'closed'
    || (instantMs >= Number(current.expiresAtMs) && purpose === 'journey_start');
  let prepared: CyclePermit | undefined;
  if (transition && head.leasePermitId && head.leasePermitId !== current?.permitId && head.leaseExpiresAtMs >= instantMs) {
    prepared = (await transaction.get(db.collection(scope === 'official' ? 'repP_offlinePermits' : 'repP_pilotOfflinePermits')
      .doc(head.leasePermitId))).data() as CyclePermit | undefined;
  }
  const usablePrepared = prepared?.protocolVersion === 2 && prepared.status === 'active'
    && Date.parse(prepared.preparationExpiresAt ?? '') >= instantMs ? prepared : undefined;
  return { id: transition ? attemptId : String(current!.cycleId), commit(receiptId: string) {
    if (!transition && current && currentRef) {
      transaction.update(currentRef, { lastCapturedAtMs: instantMs, lastReceiptId: receiptId });
      return dto({ ...current, lastCapturedAtMs: instantMs, lastReceiptId: receiptId });
    }
    const data = { schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      cycleId: attemptId, startedAtMs: instantMs, expiresAtMs: instantMs + REP_P_OFFLINE_CYCLE_TTL_MS,
      status: 'active', origin: 'online', firstReceiptId: receiptId, lastCapturedAtMs: instantMs, lastReceiptId: receiptId,
      previousCycleId: current?.cycleId ?? null, transition: current ? 'new_online_journey' : 'first_online_marking',
      openedBy: context.decoded.uid, createdAt: Timestamp.now(),
      ...(usablePrepared ? { ...binding(usablePrepared),
        startedElapsedRealtimeMs: usablePrepared.anchorElapsedRealtimeMs + instantMs - Date.parse(usablePrepared.anchorInstant) } : {}) };
    transaction.create(refs.cycle, data);
    transaction.set(refs.head, { schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
      cycleId: attemptId, startedAtMs: instantMs, expiresAtMs: data.expiresAtMs, status: 'active',
      ...(usablePrepared ? lease(usablePrepared, data.expiresAtMs)
        : current || Number(head.leaseExpiresAtMs) < instantMs ? {
          leasePermitId: null, leaseDeviceKeyId: null, leaseInstallationId: null,
          leaseBootCount: null, leasePreparedAtMs: null, leaseExpiresAtMs: 0,
        } : {}) }, { merge: true });
    return dto(data);
  } };
}

export async function readOfflineCycleDto(db: Firestore, context: ServerUserContext, cycleId: unknown) {
  if (typeof cycleId !== 'string') return undefined;
  try {
    let data = (await offlineCycleRefs(db, context.workspace_id, context.decoded.uid, cycleId).cycle.get()).data();
    if (data?.status === 'superseded' && typeof data.supersededBy === 'string') {
      data = (await offlineCycleRefs(db, context.workspace_id, context.decoded.uid, data.supersededBy).cycle.get()).data();
    }
    return data && data.workspaceId === context.workspace_id && data.employeeId === context.decoded.uid ? dto(data) : undefined;
  } catch { return undefined; }
}

/** All authorization guards are read before the caller writes an original or advances NSR. */
export async function loadOfflineCycle(transaction: Transaction, db: Firestore, context: ServerUserContext,
  permit: CyclePermit, evidence: { cycle?: RepPOfflineCycleEvidence; elapsedRealtimeMs: number; bootCount: number;
    deviceKeyId: string; sequence: number }, attemptId: string, serverInstantMs: number) {
  const refs = offlineCycleRefs(db, context.workspace_id, context.decoded.uid, evidence.cycle?.id ?? permit.permitId);
  const [headDoc, cycleDoc, permitDoc] = await transaction.getAll(refs.head, refs.cycle, permitRef(db, permit));
  const head = headDoc.data() ?? {};
  const existing = cycleDoc.data();
  const competingRef = typeof head.cycleId === 'string' && head.cycleId !== evidence.cycle?.id
    ? offlineCycleRefs(db, context.workspace_id, context.decoded.uid, head.cycleId).cycle : null;
  const competing = permit.protocolVersion === 2 && competingRef ? (await transaction.get(competingRef)).data() : undefined;
  const capturedAtMs = Date.parse(permit.anchorInstant) + evidence.elapsedRealtimeMs - permit.anchorElapsedRealtimeMs;
  if (permit.protocolVersion !== 2) {
    if (evidence.cycle) throw fail('REP_P_OFFLINE_CYCLE_VERSION_INVALID', 'Esta autorização não suporta ciclo de 24 horas.');
    if (head.minimumProtocol === 2 && capturedAtMs >= Number(head.protocolEnrolledAtMs)) {
      throw fail('REP_P_OFFLINE_UPGRADE_REQUIRED', 'Preserve esta captura do protocolo anterior para conferência do DP.');
    }
    return null;
  }
  await assertOnlineProjectionCurrent(transaction, db, context, head, permit.scope ?? 'official');
  if (!evidence.cycle || !permit.preparationExpiresAt) throw fail('REP_P_OFFLINE_CYCLE_REQUIRED', 'O ciclo não foi informado.');
  const live = permitDoc.data() as CyclePermit | undefined;
  if (!live || live.status !== 'active' || live.workspaceId !== context.workspace_id || live.employeeId !== context.decoded.uid
    || live.deviceKeyId !== evidence.deviceKeyId || live.bootCount !== evidence.bootCount) {
    throw fail('REP_P_OFFLINE_CYCLE_PERMIT_INVALID', 'O preparo não está ativo neste aparelho.');
  }
  let startedAtMs: number;
  let expiresAtMs: number;
  let historicalFirst = false;
  let reconcilesOnlineFirst = false;
  if (existing) {
    if (existing.permitId !== permit.permitId || existing.startedElapsedRealtimeMs !== evidence.cycle.startedElapsedRealtimeMs
      || existing.deviceKeyId !== evidence.deviceKeyId || existing.bootCount !== evidence.bootCount) {
      throw fail('REP_P_OFFLINE_CYCLE_CONFLICT', 'O início do ciclo já foi fixado por outra autorização.');
    }
    if (existing.status !== 'active') throw fail('REP_P_OFFLINE_CYCLE_CLOSED', 'Este ciclo foi encerrado ou conciliado.');
    startedAtMs = Number(existing.startedAtMs); expiresAtMs = Number(existing.expiresAtMs);
    if (!Number.isSafeInteger(evidence.elapsedRealtimeMs) || evidence.elapsedRealtimeMs < permit.anchorElapsedRealtimeMs
      || capturedAtMs < startedAtMs || capturedAtMs > expiresAtMs) throw fail('REP_P_OFFLINE_CYCLE_EXPIRED', 'O prazo deste ciclo terminou.');
  } else {
    let window;
    try { window = offlineCycleWindow({ ...permit, preparationExpiresAt: permit.preparationExpiresAt,
      startedElapsedRealtimeMs: evidence.cycle.startedElapsedRealtimeMs, elapsedRealtimeMs: evidence.elapsedRealtimeMs }); }
    catch { throw fail('REP_P_OFFLINE_CYCLE_EXPIRED', 'O preparo ou ciclo terminou. Conecte o aparelho.'); }
    if (evidence.cycle.id !== attemptId || evidence.elapsedRealtimeMs !== evidence.cycle.startedElapsedRealtimeMs
      || evidence.sequence !== 1 || live.lastAcceptedSequence !== 0) throw fail('REP_P_OFFLINE_CYCLE_FIRST_REQUIRED', 'Envie a primeira batida deste ciclo.');
    reconcilesOnlineFirst = competing?.origin === 'online' && competing.status === 'active' && !competing.offlineSeen
      && window.startedAt < Number(competing.startedAtMs) && window.expiresAt > Number(competing.startedAtMs) && sameDevice(head, permit);
    historicalFirst = Boolean(competing ? window.expiresAt <= Number(competing.startedAtMs)
      : head.leasePermitId !== permit.permitId && window.expiresAt <= Number(head.leasePreparedAtMs));
    if (head.cycleId && head.status !== 'closed' && !reconcilesOnlineFirst && !historicalFirst) {
      throw fail('REP_P_OFFLINE_CYCLE_ALREADY_OPEN', 'Encerre o ciclo anterior antes de iniciar outro.');
    }
    if (!historicalFirst && head.status === 'closed' && Date.parse(permit.anchorInstant) < Number(head.closedAtMs)) {
      throw fail('REP_P_OFFLINE_NEW_PREPARATION_REQUIRED', 'O próximo ciclo precisa de preparo posterior ao encerramento.');
    }
    if (!historicalFirst && !sameDevice(head, permit)) throw fail('REP_P_OFFLINE_DEVICE_LOCKED', 'Este aparelho não possui a autorização de captura vigente.');
    startedAtMs = window.startedAt; expiresAtMs = window.expiresAt;
    if (!historicalFirst && head.status === 'closed' && startedAtMs < Number(head.closedAtMs)) throw fail('REP_P_OFFLINE_CYCLE_CONFLICT', 'O novo ciclo antecede o encerramento anterior.');
  }
  if (capturedAtMs > serverInstantMs + 30_000) throw fail('REP_P_OFFLINE_CYCLE_TIME_INVALID', 'Horário de ciclo inválido.');
  return { commit(receiptId: string) {
    if (!existing) {
      transaction.create(refs.cycle, { schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
        cycleId: evidence.cycle!.id, ...binding(permit), startedElapsedRealtimeMs: evidence.cycle!.startedElapsedRealtimeMs,
        startedAtMs, expiresAtMs, status: 'active', origin: 'offline', offlineSeen: true, firstReceiptId: receiptId,
        previousCycleId: !historicalFirst && head.status === 'closed' ? head.cycleId : null,
        ...(reconcilesOnlineFirst ? { reconcilesOnlineCycleId: head.cycleId } : {}),
        lastCapturedAtMs: reconcilesOnlineFirst ? Math.max(capturedAtMs, Number(competing!.lastCapturedAtMs)) : capturedAtMs,
        lastReceiptId: reconcilesOnlineFirst && Number(competing!.lastCapturedAtMs) > capturedAtMs ? competing!.lastReceiptId : receiptId,
        openedBy: context.decoded.uid, createdAt: Timestamp.now() });
      if (!historicalFirst) transaction.set(refs.head, { schemaVersion: 2, workspaceId: context.workspace_id, employeeId: context.decoded.uid,
        cycleId: evidence.cycle!.id, startedAtMs, expiresAtMs, status: 'active', ...lease(permit, expiresAtMs) }, { merge: true });
      if (reconcilesOnlineFirst && competingRef) {
        transaction.update(competingRef, { status: 'superseded', supersededBy: evidence.cycle!.id,
          reconciledAt: Timestamp.now(), reconciledBy: context.decoded.uid });
      }
    } else transaction.update(refs.cycle, { offlineSeen: true,
      ...(capturedAtMs >= Number(existing.lastCapturedAtMs) ? { lastCapturedAtMs: capturedAtMs, lastReceiptId: receiptId } : {}) });
  } };
}

/** Closing is a distinct authenticated transition, never an editable journey_end classification. */
export async function applyOfflineCycleAction(context: ServerUserContext, raw: unknown,
  deps: { repDb: Firestore; pilotDb: Firestore; clock: { read: () => Promise<{ instant: Date }> } }) {
  const parsed = repPOfflineCycleActionSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: 'REP_P_OFFLINE_CYCLE_INPUT_INVALID', kind: 'VALIDATION' });
  const input = parsed.data;
  const db = input.scope === 'pilot' ? deps.pilotDb : deps.repDb;
  const ref = permitRef(db, input);
  const permit = (await ref.get()).data() as CyclePermit | undefined;
  if (!permit || permit.protocolVersion !== 2 || permit.workspaceId !== context.workspace_id || permit.employeeId !== context.decoded.uid
    || (permit.scope ?? 'official') !== input.scope || permit.deviceKeyId !== input.deviceKeyId || permit.bootCount !== input.bootCount) {
    throw fail('REP_P_OFFLINE_CYCLE_PERMIT_INVALID', 'Preparo inválido.');
  }
  let valid = false;
  try { valid = verify('sha256', Buffer.from(canonicalRepPCycleAction(input)),
    createPublicKey({ key: Buffer.from(permit.devicePublicKey, 'base64'), type: 'spki', format: 'der' }), Buffer.from(input.signature, 'base64')); }
  catch { /* sanitized below */ }
  if (!valid) throw fail('REP_P_OFFLINE_CYCLE_SIGNATURE_INVALID', 'Assinatura inválida.');
  const now = (await deps.clock.read()).instant.getTime();
  const refs = offlineCycleRefs(db, context.workspace_id, context.decoded.uid, input.cycleId);
  return db.runTransaction(async (transaction) => {
    const [cycleDoc, livePermit, head] = await transaction.getAll(refs.cycle, ref, refs.head);
    const cycle = cycleDoc.data();
    if (!cycle || cycle.permitId !== permit.permitId || cycle.startedElapsedRealtimeMs !== input.startedElapsedRealtimeMs
      || cycle.deviceKeyId !== input.deviceKeyId || cycle.bootCount !== input.bootCount) throw fail('REP_P_OFFLINE_CYCLE_CONFLICT', 'Ciclo inválido.');
    if (cycle.status === 'closed') return { cycle: dto(cycle)!, status: 'closed' as const };
    if (cycle.status !== 'active' || head.get('cycleId') !== input.cycleId) throw fail('REP_P_OFFLINE_CYCLE_CONFLICT', 'Este ciclo foi conciliado ou não está ativo neste aparelho.');
    await assertOnlineProjectionCurrent(transaction, db, context, head.data() ?? {}, input.scope);
    if (livePermit.get('status') !== 'active' || livePermit.get('lastAcceptedSequence') !== input.lastSequence
      || cycle.lastReceiptId !== input.receiptId) throw fail('REP_P_OFFLINE_CYCLE_PENDING', 'Aguarde o envio de todas as batidas antes de encerrar.');
    if (now < cycle.lastCapturedAtMs) throw fail('REP_P_OFFLINE_CYCLE_CLOSE_TIME_INVALID', 'Horário de encerramento inválido.');
    transaction.update(refs.cycle, { status: 'closed', closedAtMs: now, closedAt: Timestamp.now(), closedBy: context.decoded.uid,
      closingReceiptId: input.receiptId, closingSequence: input.lastSequence });
    transaction.update(ref, { status: 'closed', closedAt: Timestamp.now() });
    if (head.get('cycleId') === input.cycleId) transaction.update(refs.head, { status: 'closed', closedAtMs: now, leaseExpiresAtMs: now });
    return { cycle: dto({ ...cycle, status: 'closed' })!, status: 'closed' as const };
  });
}
