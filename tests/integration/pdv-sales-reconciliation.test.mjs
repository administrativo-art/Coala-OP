import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

const PROJECT_ID = 'demo-coala-repository';
const DATABASE_ID = 'coala';
const KIOSK_ID = 'integration-pdv-kiosk';
const DATE = '2026-08-31';
const PERIOD_ID = 'integration-pdv-period';
const EMPLOYEE_GOAL_ID = 'integration-pdv-employee-goal';
const LATE_PERIOD_ID = 'integration-pdv-late-period';
const LATE_EMPLOYEE_GOAL_ID = 'integration-pdv-late-employee-goal';
const USER_ID = 'integration-pdv-user';
const NON_REVENUE_PERIOD_IDS = Array.from(
  { length: 5 },
  (_, index) => `integration-pdv-product-period-${index + 1}`,
);
const REPORT_ID = `sales_sync_${KIOSK_ID}_${DATE.replaceAll('-', '_')}`;
const CONSUMPTION_ID = `cons_sync_${KIOSK_ID}_${DATE.replaceAll('-', '_')}`;
const STATE_ID = `${KIOSK_ID}_${DATE}`;

assertFirestoreEmulatorSafety({ projectId: PROJECT_ID, databaseId: DATABASE_ID });
process.env.PDVLEGAL_COD_EMPRESA = 'integration-company';
process.env.PDVLEGAL_TOKEN = 'integration-token';

const { Timestamp } = await import('firebase-admin/firestore');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { syncDayAdmin } = await import('../../functions/src/pdv-sync.ts');

const catalog = {
  simulationBySku: new Map([['122', { id: 'sim-cascao-misto', name: 'CASCÃO MISTO', ppo: { sku: '122' } }]]),
  simulationItemsBySimulation: new Map(),
  baseProductById: new Map(),
};

function coupon(id, hour) {
  return {
    id,
    dtrecebimento: `${DATE} ${hour}:00`,
    usuariorecebimento_id: 'operator-1',
    Itens: [{
      codigoVenda: '122',
      quantidade: 1,
      valortotal: 7,
      Descricao: 'CASCÃO MISTO',
      dtmovimento: `${DATE} ${hour}:00`,
    }],
  };
}

async function cleanup() {
  await Promise.all([
    dbAdmin.collection('salesReports').doc(REPORT_ID).delete(),
    dbAdmin.collection('consumptionReports').doc(CONSUMPTION_ID).delete(),
    dbAdmin.collection('pdvSyncReconciliationStates').doc(STATE_ID).delete(),
    dbAdmin.collection('goalPeriods').doc(PERIOD_ID).delete(),
    dbAdmin.collection('employeeGoals').doc(EMPLOYEE_GOAL_ID).delete(),
    dbAdmin.collection('goalPeriods').doc(LATE_PERIOD_ID).delete(),
    dbAdmin.collection('employeeGoals').doc(LATE_EMPLOYEE_GOAL_ID).delete(),
    dbAdmin.collection('users').doc(USER_ID).delete(),
    ...NON_REVENUE_PERIOD_IDS.map((id) => dbAdmin.collection('goalPeriods').doc(id).delete()),
  ]);
}

test('reconcilia cupom tardio, período encerrado e respostas regressivas atomicamente', async (t) => {
  await cleanup();
  t.after(cleanup);

  await Promise.all([
    dbAdmin.collection('goalPeriods').doc(PERIOD_ID).set({
      kioskId: KIOSK_ID,
      templateType: 'revenue',
      status: 'closed',
      startDate: Timestamp.fromDate(new Date('2026-08-01T03:00:00Z')),
      endDate: Timestamp.fromDate(new Date('2026-09-01T02:59:59Z')),
      currentValue: 0,
      dailyProgress: {},
      targetValue: 24_000,
      shifts: [],
    }),
    dbAdmin.collection('employeeGoals').doc(EMPLOYEE_GOAL_ID).set({
      periodId: PERIOD_ID,
      kioskId: KIOSK_ID,
      employeeId: USER_ID,
      currentValue: 0,
      targetValue: 24_000,
      dailyProgress: {},
    }),
    dbAdmin.collection('users').doc(USER_ID).set({
      assignedKioskIds: [KIOSK_ID],
      pdvOperatorIds: { [KIOSK_ID]: 'operator-1' },
    }),
    ...NON_REVENUE_PERIOD_IDS.map((id, index) => dbAdmin.collection('goalPeriods').doc(id).set({
      kioskId: KIOSK_ID,
      templateType: 'product_specific',
      status: 'active',
      startDate: Timestamp.fromDate(new Date(`2026-08-${String(26 + index).padStart(2, '0')}T03:00:00Z`)),
      endDate: Timestamp.fromDate(new Date('2026-09-01T02:59:59Z')),
      currentValue: 0,
      dailyProgress: {},
      targetValue: 100,
    })),
  ]);

  const originalFetch = globalThis.fetch;
  let coupons = [coupon('first', '15:00')];
  globalThis.fetch = async () => new Response(JSON.stringify(coupons), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const options = {
    accessToken: 'integration-access-token',
    catalog,
    mode: 'reconciliation',
    runId: 'integration-run',
  };

  const first = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(first.persistence, 'applied');
  assert.equal(first.dailyRevenue, 7);
  // A missing recipe must be observable, without changing revenue or financial flow.
  assert.deepEqual((await dbAdmin.collection('consumptionReports').doc(CONSUMPTION_ID).get()).get('consumptionQuality'),
    { version: 1, issues: 1 });

  coupons = [coupon('first', '15:00'), coupon('late', '19:00')];
  const reconciled = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(reconciled.persistence, 'applied');
  assert.equal(reconciled.dailyRevenue, 14);

  const [reportAfterGrowth, periodAfterGrowth, employeeAfterGrowth] = await Promise.all([
    dbAdmin.collection('salesReports').doc(REPORT_ID).get(),
    dbAdmin.collection('goalPeriods').doc(PERIOD_ID).get(),
    dbAdmin.collection('employeeGoals').doc(EMPLOYEE_GOAL_ID).get(),
  ]);
  assert.equal(reportAfterGrowth.get('sourceCouponCount'), 2);
  assert.equal(reportAfterGrowth.get('sourceRevenueCents'), 1_400);
  assert.equal(periodAfterGrowth.get(`dailyProgress.${DATE}`), 14);
  assert.equal(periodAfterGrowth.get('currentValue'), 14);
  assert.equal(employeeAfterGrowth.get(`dailyProgress.${DATE}`), 14);

  // Simula uma meta criada depois que o relatório do dia já foi persistido.
  await Promise.all([
    dbAdmin.collection('goalPeriods').doc(LATE_PERIOD_ID).set({
      kioskId: KIOSK_ID,
      templateType: 'revenue',
      status: 'active',
      startDate: Timestamp.fromDate(new Date('2026-08-01T03:00:00Z')),
      endDate: Timestamp.fromDate(new Date('2026-09-01T02:59:59Z')),
      currentValue: 0,
      dailyProgress: {},
      targetValue: 24_000,
      shifts: [],
    }),
    dbAdmin.collection('employeeGoals').doc(LATE_EMPLOYEE_GOAL_ID).set({
      periodId: LATE_PERIOD_ID,
      kioskId: KIOSK_ID,
      employeeId: USER_ID,
      currentValue: 0,
      targetValue: 24_000,
      dailyProgress: {},
    }),
  ]);

  const unchangedTimestamp = reportAfterGrowth.get('updatedAt');
  const unchanged = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(unchanged.persistence, 'unchanged');
  const reportUnchanged = await dbAdmin.collection('salesReports').doc(REPORT_ID).get();
  assert.equal(reportUnchanged.get('updatedAt'), unchangedTimestamp);
  const [latePeriodAfterReplay, lateEmployeeAfterReplay] = await Promise.all([
    dbAdmin.collection('goalPeriods').doc(LATE_PERIOD_ID).get(),
    dbAdmin.collection('employeeGoals').doc(LATE_EMPLOYEE_GOAL_ID).get(),
  ]);
  assert.equal(latePeriodAfterReplay.get(`dailyProgress.${DATE}`), 14);
  assert.equal(latePeriodAfterReplay.get('currentValue'), 14);
  assert.equal(lateEmployeeAfterReplay.get(`dailyProgress.${DATE}`), 14);
  assert.equal(lateEmployeeAfterReplay.get('currentValue'), 14);

  coupons = [coupon('first', '15:00')];
  const held = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(held.persistence, 'held');
  assert.equal((await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).get('sourceCouponCount'), 2);

  const confirmedDecrease = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(confirmedDecrease.persistence, 'applied');
  assert.equal((await dbAdmin.collection('goalPeriods').doc(PERIOD_ID).get()).get('currentValue'), 7);

  coupons = [];
  const empty = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  assert.equal(empty.persistence, 'held');
  assert.equal((await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).get('sourceCouponCount'), 1);
  assert.equal((await dbAdmin.collection('pdvSyncReconciliationStates').doc(STATE_ID).get()).get('reason'), 'empty_after_data');
});

test('receita líquida confere com cupons, relatório e metas; prévia não escreve', async (t) => {
  await cleanup();
  t.after(cleanup);
  await Promise.all([
    dbAdmin.collection('goalPeriods').doc(PERIOD_ID).set({
      kioskId: KIOSK_ID, templateType: 'revenue', status: 'closed',
      startDate: Timestamp.fromDate(new Date('2026-08-01T03:00:00Z')),
      endDate: Timestamp.fromDate(new Date('2026-09-01T02:59:59Z')),
      currentValue: 0, dailyProgress: {}, shifts: [],
    }),
    dbAdmin.collection('employeeGoals').doc(EMPLOYEE_GOAL_ID).set({
      periodId: PERIOD_ID, kioskId: KIOSK_ID, employeeId: USER_ID,
      currentValue: 0, dailyProgress: {},
    }),
    dbAdmin.collection('users').doc(USER_ID).set({
      assignedKioskIds: [KIOSK_ID], pdvOperatorIds: { [KIOSK_ID]: 'operator-1' },
    }),
  ]);
  const originalFetch = globalThis.fetch;
  let coupons = [
    { ...coupon('discount-item', '15:00'), valortotal: 12, Itens: [{ ...coupon('x', '15:00').Itens[0], valortotal: 15, valordesconto: 3 }] },
    { ...coupon('discount-header', '16:00'), valortotal: 6, valordesconto: 1 },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(coupons), { status: 200 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const options = { accessToken: 'test-token', catalog, mode: 'manual', runId: 'discount-test' };
  const preview = await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, { ...options, dryRun: true });
  assert.equal(preview.persistence, 'preview');
  assert.equal(preview.dailyRevenue, 18);
  assert.equal((await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).exists, false);
  assert.equal((await dbAdmin.collection('pdvSyncReconciliationStates').doc(STATE_ID).get()).exists, false);
  assert.equal((await dbAdmin.collection('goalPeriods').doc(PERIOD_ID).get()).get('currentValue'), 0);
  await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options);
  const report = (await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).data();
  assert.equal(report.sourceRevenueCents, 1800);
  assert.equal(report.sourceCouponRevenueCents, 1800);
  assert.equal(report.sourceAdjustmentCents, -400);
  assert.equal(report.revenueAccountingVersion, 2);
  assert.equal(report.items.reduce((s, it) => s + Math.round(it.quantity * it.unitPrice * 100), 0), 1800);
  assert.equal((await dbAdmin.collection('goalPeriods').doc(PERIOD_ID).get()).get('currentValue'), 18);
  assert.equal((await dbAdmin.collection('employeeGoals').doc(EMPLOYEE_GOAL_ID).get()).get('currentValue'), 18);
  assert.equal((await syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options)).persistence, 'unchanged');
  await assert.rejects(syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, {
    ...options, expectedMetrics: { couponCount: 2, revenueCents: 1900 },
  }), { code: 'PREVIEW_CHANGED' });
  assert.equal((await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).get('sourceRevenueCents'), 1800);
  coupons = [{ ...coupon('bad', '15:00'), valortotal: 99 }];
  await assert.rejects(syncDayAdmin(DATE, KIOSK_ID, '17344', dbAdmin, options), { code: 'PDV_REVENUE_CONTRACT_FAILED' });
  assert.equal((await dbAdmin.collection('salesReports').doc(REPORT_ID).get()).get('sourceRevenueCents'), 1800);
});
