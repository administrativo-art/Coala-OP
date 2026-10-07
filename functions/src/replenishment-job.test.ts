import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runMinimumStockRecalculation } from './stock-min-recalc.js';
import { assertFirestoreEmulatorSafety } from '../../tests/helpers/firestore-emulator-safety.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) {
  throw new Error('Firestore emulator and demo project required.');
}
assertFirestoreEmulatorSafety({ projectId: process.env.GCLOUD_PROJECT });
if (!getApps().length) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore('coala');
const NOW = new Date('2026-10-06T12:00:00Z');
after(async () => { await Promise.all(getApps().map(deleteApp)); });

async function report(kioskId: string, day: number, baseProductId: string, quantity: number) {
  const date = `2026-09-${String(day).padStart(2, '0')}`;
  const id = `sync_${kioskId}_2026_09_${String(day).padStart(2, '0')}`;
  await Promise.all([
    db.collection('consumptionReports').doc(`cons_${id}`).set({
      kioskId, year: 2026, month: 9, day, status: 'completed',
      consumptionQuality: { version: 1, issues: 0 },
      results: [{ baseProductId, consumedQuantity: quantity }],
    }),
    db.collection('salesReports').doc(`sales_${id}`).set({
      kioskId, reconciliationStatus: 'verified', sourceCouponCount: 1, sourceRevenueCents: 0,
      syncDiagnostics: { couponsReceived: 1, couponsCancelled: 0, couponsWithoutItems: 0,
        itemsUnmapped: 0, unmappedSkus: [] },
    }),
    db.collection('pdvSyncReconciliationStates').doc(`${kioskId}_${date}`).set({
      status: 'verified', appliedMetrics: { couponCount: 1, revenueCents: 0 },
    }),
  ]);
}

test('CD serves only CD routed units; zero when all direct; shadow preserves operational min', async () => {
  const suffix = randomUUID().slice(0, 8), baseId = `new-policy-${suffix}`;
  const a = `a-${suffix}`, b = `b-${suffix}`, cd = `cd-${suffix}`;
  await db.collection('dp_unitGroups').doc(`supply-${suffix}`).set({ suppliedGroupIds: [`commercial-${suffix}`] });
  for (const [id, groupId, stockRole] of [
    [a, `commercial-${suffix}`, 'commercial'],
    [b, `commercial-${suffix}`, 'commercial'],
    [cd, `supply-${suffix}`, 'supply'],
  ]) await db.collection('dp_units').doc(id).set({ externalSource: 'kiosk', externalId: id, groupId, stockRole });
  await db.collection('baseProducts').doc(baseId).set({
    name: 'Policy test', unit: 'un', category: 'Unidade', minStockRecalcPeriod: 'biweekly',
    stockLevels: { [a]: { supplyMode: 'cd', leadTime: 8, min: 77, override: true },
      [b]: { supplyMode: 'cd', leadTime: 9, min: 77, override: true },
      [cd]: { supplyMode: 'cd', leadTime: 5, min: 77, override: true } },
  });
  for (let day = 1; day <= 14; day++) {
    await Promise.all([report(a, day, baseId, 2), report(b, day, baseId, 3)]);
  }
  await runMinimumStockRecalculation(db, NOW, baseId, false);
  let levels = (await db.collection('baseProducts').doc(baseId).get()).data()!;
  assert.equal(levels.stockLevels[cd].min, 77);
  assert.equal(levels.replenishmentPreview[cd].min, 98);
  await runMinimumStockRecalculation(db, NOW, baseId, true);
  levels = (await db.collection('baseProducts').doc(baseId).get()).data()!.stockLevels;
  assert.equal(levels[cd].min, 98);
  assert.equal(levels[a].effectiveLeadTime, 2);
  assert.equal(levels[cd].effectiveLeadTime, 5);
  await db.collection('baseProducts').doc(baseId).update({ [`stockLevels.${a}.supplyMode`]: 'direct' });
  await runMinimumStockRecalculation(db, NOW, baseId, true);
  levels = (await db.collection('baseProducts').doc(baseId).get()).data()!.stockLevels;
  assert.equal(levels[cd].min, 59);
  assert.equal(levels[a].effectiveLeadTime, 8);
  await db.collection('baseProducts').doc(baseId).update({ [`stockLevels.${b}.supplyMode`]: 'direct' });
  await runMinimumStockRecalculation(db, NOW, baseId, true);
  levels = (await db.collection('baseProducts').doc(baseId).get()).data()!.stockLevels;
  assert.equal(levels[cd].min, 0);
  assert.equal(levels[cd].calculationStatus, 'no_dependents');
});

test('thirteen internally verified PDV days keep result pending', async () => {
  const id = randomUUID(), kiosk = `partial-${id}`;
  await db.collection('baseProducts').doc(id).set({ name: 'Partial', unit: 'un', category: 'Unidade',
    stockLevels: { [kiosk]: { min: 41, override: true } } });
  for (let day = 1; day <= 13; day++) await report(kiosk, day, id, 4);
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).data()!.stockLevels[kiosk];
  assert.equal(level.min, 0);
  assert.equal(level.calculationStatus, 'partial');
  assert.equal(level.validDays, 13);
});

test('transfer proxy converts package, ignores reversion and counts distinct entries', async () => {
  const id = randomUUID(), sku = `sku-${id}`, kiosk = `proxy-${id}`;
  await db.collection('baseProducts').doc(id).set({ name: 'Proxy', unit: 'g', category: 'Massa',
    stockLevels: { [kiosk]: { override: false } } });
  await db.collection('products').doc(sku).set({ baseProductId: id, packageSize: 2, unit: 'kg' });
  for (const [suffix, reverted] of [['one', false], ['two', false], ['reverted', true]] as const) {
    await db.collection('movementHistory').doc(`${sku}-${suffix}`).set({
      type: 'TRANSFERENCIA_ENTRADA', productId: sku, toKioskId: kiosk,
      activityId: `activity-${id}`, lotNumber: 'same', quantityChange: 1,
      timestamp: '2026-09-10T12:00:00.000Z', reverted,
    });
  }
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).data()!.stockLevels[kiosk];
  assert.equal(level.source, 'transfer_proxy');
  assert.equal(level.min, 6000);
  assert.equal(level.validDays, 26);
  assert.match(level.sourceLimitation, /proxy/);
});

test('CD includes a new unit only from its first daily report', async () => {
  const id = randomUUID(), a = `old-${id}`, b = `new-${id}`, cd = `cd-${id}`;
  const group = `commercial-${id}`, supply = `supply-${id}`;
  await db.collection('dp_unitGroups').doc(supply).set({ suppliedGroupIds: [group] });
  for (const [unit, groupId, stockRole] of [[a, group, 'commercial'], [b, group, 'commercial'], [cd, supply, 'supply']]) {
    await db.collection('dp_units').doc(unit).set({ externalSource: 'kiosk', externalId: unit, groupId, stockRole });
  }
  await db.collection('baseProducts').doc(id).set({ unit: 'un', category: 'Unidade', minStockRecalcPeriod: 'biweekly',
    stockLevels: { [a]: { supplyMode: 'cd' }, [b]: { supplyMode: 'cd' }, [cd]: { min: 999 } } });
  for (let day = 1; day <= 14; day++) {
    await report(a, day, id, 2);
    if (day >= 8) await report(b, day, id, 3);
  }
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).get(`stockLevels.${cd}`);
  assert.equal(level.validDays, 14);
  assert.equal(level.min, 69);
});

test('PDV with missing quality never silently falls back to transfer demand', async () => {
  const id = randomUUID(), kiosk = `quality-${id}`, sku = `sku-${id}`;
  await db.collection('baseProducts').doc(id).set({ unit: 'un', category: 'Unidade', stockLevels: { [kiosk]: {} } });
  await db.collection('products').doc(sku).set({ baseProductId: id, packageSize: 1, unit: 'un' });
  for (let day = 1; day <= 14; day++) {
    await report(kiosk, day, id, 4);
    await db.collection('consumptionReports').doc(`cons_sync_${kiosk}_2026_09_${String(day).padStart(2, '0')}`)
      .set({ consumptionQuality: null }, { merge: true });
  }
  await db.collection('movementHistory').doc(sku).set({ type: 'TRANSFERENCIA_ENTRADA', productId: sku,
    toKioskId: kiosk, activityId: id, quantityChange: 900, timestamp: '2026-09-01T12:00:00.000Z' });
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).get(`stockLevels.${kiosk}`);
  assert.equal(level.source, 'pdv_internal');
  assert.equal(level.calculationStatus, 'pending');
  assert.equal(level.min, 0);
});

test('typed movement queries use complete Belém days and count only entry side', async () => {
  const id = randomUUID(), kiosk = `boundary-${id}`, sku = `sku-${id}`;
  await db.collection('baseProducts').doc(id).set({ unit: 'un', category: 'Unidade', stockLevels: { [kiosk]: {} } });
  await db.collection('products').doc(sku).set({ baseProductId: id, packageSize: 1, unit: 'un' });
  const times = ['2026-04-09T02:59:59.000Z', '2026-04-09T03:00:00.000Z',
    new Date('2026-10-06T02:59:59.000Z'), '2026-10-06T03:00:00.000Z'];
  for (const [index, timestamp] of times.entries()) {
    await db.collection('movementHistory').doc(`${sku}-${index}`).set({ type: 'TRANSFERENCIA_ENTRADA',
      productId: sku, toKioskId: kiosk, activityId: id, quantityChange: 1, timestamp });
  }
  await db.collection('movementHistory').doc(`${sku}-exit`).set({ type: 'TRANSFERENCIA_SAIDA',
    productId: sku, toKioskId: kiosk, activityId: id, quantityChange: 1, timestamp: times[1] });
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).get(`stockLevels.${kiosk}`);
  assert.equal(level.validDays, 180);
  assert.equal(level.avgDaily, 0.0111);
  assert.equal(level.lastAutoCalculatedMean, 0.33);
});

test('one invalid derivative makes proxy pending without changing physical lots', async () => {
  const id = randomUUID(), kiosk = `conversion-${id}`;
  await db.collection('baseProducts').doc(id).set({ unit: 'g', category: 'Massa', stockLevels: { [kiosk]: {} } });
  await db.collection('lots').doc(id).set({ quantity: 45, reservedQuantity: 2, kioskId: kiosk });
  for (const [suffix, unit] of [['good', 'g'], ['bad', 'minutes']]) {
    const sku = `${id}-${suffix}`;
    await db.collection('products').doc(sku).set({ baseProductId: id, packageSize: 1, unit });
    await db.collection('movementHistory').doc(sku).set({ type: 'TRANSFERENCIA_ENTRADA',
      productId: sku, toKioskId: kiosk, activityId: id, quantityChange: 10, timestamp: '2026-09-10T12:00:00.000Z' });
  }
  await runMinimumStockRecalculation(db, NOW, id, true);
  const level = (await db.collection('baseProducts').doc(id).get()).get(`stockLevels.${kiosk}`);
  assert.equal(level.calculationStatus, 'pending');
  assert.match(level.sourceLimitation, /conversão inválida/);
  assert.equal((await db.collection('lots').doc(id).get()).get('quantity'), 45);
});
