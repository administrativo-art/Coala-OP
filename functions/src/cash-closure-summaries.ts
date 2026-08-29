import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const financialDb = getFirestore('coala-financeiro');
const REINFORCEMENT_PAGE_SIZE = 500;
const MAX_OPERATIONAL_KIOSKS = 1_000;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function finalizedNumber(item: Record<string, unknown>, finalizedField: string, legacyField: string) {
  const finalized = item[finalizedField];
  if (typeof finalized === 'number' && Number.isFinite(finalized)) return finalized;
  return item.status === 'approved' ? number(item[legacyField]) : 0;
}

function hasFinalizedDivergence(item: Record<string, unknown>) {
  const finalizedOperatorCount = typeof item.finalizedOperatorCount === 'number'
    ? item.finalizedOperatorCount
    : item.status === 'approved' ? number(item.operatorCount) : 0;
  const approvedWithDivergence = typeof item.approvedWithDivergence === 'boolean'
    ? item.approvedWithDivergence
    : item.status === 'approved' && number(item.divergentLineCount) > 0;
  return finalizedOperatorCount > 0 && approvedWithDivergence;
}

function currentPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Belem', year: 'numeric', month: 'numeric',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
  };
}

function maxText(values: string[]) {
  const sorted = values.filter(Boolean).sort();
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

async function recomputeSummary(workspaceId: string, kioskId: string, year: number, month: number) {
  const maximumClosureCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const snapshot = await financialDb.collection('cashClosures')
    .where('workspaceId', '==', workspaceId)
    .where('kioskId', '==', kioskId)
    .where('year', '==', year)
    .where('month', '==', month)
    .limit(maximumClosureCount + 1)
    .get();
  if (snapshot.size > maximumClosureCount) {
    throw new Error('Existe mais de um fechamento diário para a unidade nesta competência.');
  }
  const closures = snapshot.docs.map((document) => document.data());
  const first = closures[0] ?? {};
  const now = new Date().toISOString();
  const id = `${workspaceId}_${kioskId}_${year}_${String(month).padStart(2, '0')}`;
  const summary = {
    id, workspaceId, kioskId,
    kioskName: text(first.kioskName) || kioskId,
    pdvFilialId: text(first.pdvFilialId), year, month,
    closureCount: closures.length,
    pendingCount: closures.filter((item) => ['draft', 'reopened'].includes(text(item.status))).length,
    partialCount: closures.filter((item) => item.status === 'pending_review').length,
    divergentCount: closures.filter(hasFinalizedDivergence).length,
    approvedCount: closures.filter((item) => item.status === 'approved').length,
    syncErrorCount: closures.filter((item) => item.status === 'sync_error' || !!item.syncError).length,
    expectedTotalCents: closures.reduce((sum, item) => sum + number(item.expectedTotalCents), 0),
    countedTotalCents: closures.reduce((sum, item) => sum + finalizedNumber(item, 'finalizedCountedTotalCents', 'countedTotalCents'), 0),
    differenceTotalCents: closures.reduce((sum, item) => sum + finalizedNumber(item, 'finalizedDifferenceTotalCents', 'differenceTotalCents'), 0),
    dreRevenueTotalCents: closures.reduce((sum, item) => sum
      + number(item.expectedTotalCents)
      + finalizedNumber(item, 'finalizedDifferenceTotalCents', 'differenceTotalCents'), 0),
    countedCashCents: closures.reduce((sum, item) => sum + finalizedNumber(item, 'finalizedCountedCashCents', 'countedCashCents'), 0),
    allocatedCashCents: closures.filter((item) => ['allocated', 'issued', 'paid', 'adjusted'].includes(text(item.cashDeposit?.status))).reduce((sum, item) => sum + number(item.cashDeposit?.eligibleCents), 0),
    issuedCashCents: closures.filter((item) => ['issued', 'paid'].includes(text(item.cashDeposit?.status))).reduce((sum, item) => sum + number(item.cashDeposit?.eligibleCents), 0),
    paidCashCents: closures.filter((item) => item.cashDeposit?.status === 'paid').reduce((sum, item) => sum + number(item.cashDeposit?.eligibleCents), 0),
    lastSyncedAt: maxText(closures.map((item) => text(item.syncedAt))),
    lastApprovedDate: maxText(closures.filter((item) => item.status === 'approved').map((item) => text(item.date))),
    updatedAt: now,
  };
  const batch = financialDb.batch();
  batch.set(financialDb.collection('cashClosureMonthlySummaries').doc(id), summary);
  const current = currentPeriod();
  if (year === current.year && month === current.month) {
    const unitId = `${workspaceId}_${kioskId}`;
    batch.set(financialDb.collection('cashClosureUnitSummaries').doc(unitId), {
      ...summary, id: unitId, currentYear: year, currentMonth: month,
    });
  }
  await batch.commit();
}

export const cashClosureSummaryWritten = onDocumentWritten({
  document: 'cashClosures/{closureId}',
  database: 'coala-financeiro',
  region: 'southamerica-east1',
}, async (event) => {
  const data = event.data?.after.exists ? event.data.after.data() : event.data?.before.data();
  if (!data) return;
  await recomputeSummary(text(data.workspaceId), text(data.kioskId), number(data.year), number(data.month));
});

export const cashClosureSummaryReinforcement = onSchedule({
  schedule: '20 6 * * *',
  timeZone: 'America/Belem',
  retryCount: 2,
  memory: '256MiB',
}, async () => {
  const current = currentPeriod();
  const maximumClosureCount = new Date(Date.UTC(current.year, current.month, 0)).getUTCDate()
    * MAX_OPERATIONAL_KIOSKS;
  const documents: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: string | null = null;
  while (documents.length <= maximumClosureCount) {
    const remaining = maximumClosureCount + 1 - documents.length;
    let query: FirebaseFirestore.Query = financialDb.collection('cashClosures')
      .where('year', '==', current.year)
      .where('month', '==', current.month)
      .orderBy(FieldPath.documentId())
      .limit(Math.min(REINFORCEMENT_PAGE_SIZE, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    documents.push(...snapshot.docs);
    if (snapshot.empty || snapshot.size < Math.min(REINFORCEMENT_PAGE_SIZE, remaining)) break;
    cursor = snapshot.docs[snapshot.docs.length - 1]?.id ?? null;
    if (!cursor) break;
  }
  if (documents.length > maximumClosureCount) {
    throw new Error('A quantidade de fechamentos do mês ultrapassa o limite operacional do reforço.');
  }
  const keys = new Map<string, { workspaceId: string; kioskId: string }>();
  for (const document of documents) {
    const data = document.data();
    const workspaceId = text(data.workspaceId);
    const kioskId = text(data.kioskId);
    if (workspaceId && kioskId) keys.set(`${workspaceId}::${kioskId}`, { workspaceId, kioskId });
  }
  for (const value of keys.values()) {
    await recomputeSummary(value.workspaceId, value.kioskId, current.year, current.month);
  }
  console.log(`[cashClosureSummaryReinforcement] ${keys.size} unidade(s) recalculada(s).`);
});
