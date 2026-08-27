import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const financialDb = getFirestore('coala-financeiro');
const CHANNELS = ['cash', 'pix', 'debit_card', 'credit_card', 'voucher', 'signed_account', 'other'] as const;

function totals() {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, 0])) as Record<string, number>;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

async function recomputeClosure(closureId: string) {
  const closureRef = financialDb.collection('cashClosures').doc(closureId);
  const [closureSnapshot, linesSnapshot] = await Promise.all([
    closureRef.get(), closureRef.collection('lines').get(),
  ]);
  if (!closureSnapshot.exists) return;
  const expectedByChannelCents = totals();
  const countedByChannelCents = totals();
  const differenceByChannelCents = totals();
  let expectedTotalCents = 0;
  let countedTotalCents = 0;
  let differenceTotalCents = 0;
  let pendingLineCount = 0;
  let divergentLineCount = 0;
  let matchedLineCount = 0;
  const operatorIds = new Set<string>();
  const batch = financialDb.batch();
  let lineChanged = false;

  for (const document of linesSnapshot.docs) {
    const data = document.data();
    const channel = CHANNELS.includes(data.channel) ? data.channel : 'other';
    const expectedCents = number(data.expectedCents);
    const countedCents = typeof data.countedCents === 'number' ? data.countedCents : null;
    const differenceCents = countedCents === null ? null : countedCents - expectedCents;
    const status = differenceCents === null ? 'pending' : differenceCents === 0 ? 'matched' : 'divergent';
    expectedByChannelCents[channel] += expectedCents;
    expectedTotalCents += expectedCents;
    if (countedCents === null) pendingLineCount++;
    else {
      countedByChannelCents[channel] += countedCents;
      countedTotalCents += countedCents;
    }
    if (differenceCents !== null) {
      differenceByChannelCents[channel] += differenceCents;
      differenceTotalCents += differenceCents;
    }
    if (status === 'matched') matchedLineCount++;
    if (status === 'divergent') divergentLineCount++;
    if (text(data.operatorId)) operatorIds.add(text(data.operatorId));
    if (data.differenceCents !== differenceCents || data.status !== status) {
      lineChanged = true;
      batch.set(document.ref, { differenceCents, status, updatedAt: new Date().toISOString() }, { merge: true });
    }
  }

  batch.set(closureRef, {
    expectedTotalCents,
    countedTotalCents,
    differenceTotalCents,
    expectedByChannelCents,
    countedByChannelCents,
    differenceByChannelCents,
    expectedCashCents: expectedByChannelCents.cash,
    countedCashCents: countedByChannelCents.cash,
    operatorCount: operatorIds.size,
    pendingLineCount,
    divergentLineCount,
    matchedLineCount,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();
  if (lineChanged) console.log(`[cashClosureLineWritten] Linhas derivadas corrigidas em ${closureId}.`);
}

function maxText(values: string[]) {
  const sorted = values.filter(Boolean).sort();
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

async function recomputeSummary(workspaceId: string, kioskId: string, year: number, month: number) {
  const snapshot = await financialDb.collection('cashClosures')
    .where('workspaceId', '==', workspaceId)
    .where('kioskId', '==', kioskId)
    .where('year', '==', year)
    .where('month', '==', month)
    .get();
  const closures = snapshot.docs.map((document) => document.data());
  const first = closures[0] ?? {};
  const now = new Date().toISOString();
  const id = `${workspaceId}_${kioskId}_${year}_${String(month).padStart(2, '0')}`;
  const summary = {
    id, workspaceId, kioskId,
    kioskName: text(first.kioskName) || kioskId,
    pdvFilialId: text(first.pdvFilialId), year, month,
    closureCount: closures.length,
    pendingCount: closures.filter((item) => ['draft', 'pending_review', 'reopened'].includes(text(item.status))).length,
    divergentCount: closures.filter((item) => number(item.divergentLineCount) > 0).length,
    approvedCount: closures.filter((item) => item.status === 'approved').length,
    syncErrorCount: closures.filter((item) => item.status === 'sync_error' || !!item.syncError).length,
    expectedTotalCents: closures.reduce((sum, item) => sum + number(item.expectedTotalCents), 0),
    countedTotalCents: closures.reduce((sum, item) => sum + number(item.countedTotalCents), 0),
    differenceTotalCents: closures.reduce((sum, item) => sum + number(item.differenceTotalCents), 0),
    countedCashCents: closures.reduce((sum, item) => sum + number(item.countedCashCents), 0),
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

export const cashClosureLineWritten = onDocumentWritten({
  document: 'cashClosures/{closureId}/lines/{lineId}',
  database: 'coala-financeiro',
  region: 'southamerica-east1',
}, async (event) => {
  await recomputeClosure(event.params.closureId);
});

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
  const snapshot = await financialDb.collection('cashClosures')
    .where('year', '==', current.year)
    .where('month', '==', current.month)
    .get();
  const keys = new Map<string, { workspaceId: string; kioskId: string }>();
  for (const document of snapshot.docs) {
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
