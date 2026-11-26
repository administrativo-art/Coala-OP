import assert from 'node:assert/strict';
import test from 'node:test';
import { serverModuleLoader } from '../helpers/load-server-module';
import { computeBankDay, isReadableTimeBankAlgorithmVersion, type BankDayInput } from '../../src/features/dp/time-bank/core';

async function disabled<T>(run: () => Promise<T> | T) {
  const keys = ['DP_TIME_POLICY_RULES_ENABLED', 'DP_TIME_REVIEW_ENABLED'] as const;
  const saved = keys.map(key => process.env[key]);
  for (const key of keys) delete process.env[key];
  try { return await run(); } finally { keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; }); }
}

test('draft rules cannot be published until release and current published rules stay legacy without mutation', async () => disabled(() => {
  const gates = serverModuleLoader({})('src/features/dp/time-config/rollout.server.ts') as typeof import('../../src/features/dp/time-config/rollout.server');
  const indemnity = { code: 'HEI', ratePercent: 50, source: { origin: 'internal_policy', reference: 'Synthetic' } };
  for (const draft of [{ tolerances: {} }, { intrajornada: indemnity }, { tolerances: {}, intrajornada: indemnity }]) {
    assert.throws(() => gates.assertPolicyRulesPublication(draft), (e: unknown) => (e as { code: string }).code === 'DP_TIME_POLICY_RULES_PENDING');
  }
  assert.doesNotThrow(() => gates.assertPolicyRulesPublication({ intrajornada: false }));
  for (const status of ['published', 'archived']) {
    const stored = { id: 'policy', status, tolerances: { markingMinutes: 5 }, intrajornada: indemnity, categories: [{ id: 'kept' }] };
    const before = structuredClone(stored);
    const active = gates.activeOvertimePolicy(stored as unknown as Parameters<typeof gates.activeOvertimePolicy>[0]);
    assert.equal(active.tolerances, undefined); assert.equal(active.intrajornada, undefined);
    assert.deepEqual(active.categories, stored.categories); assert.deepEqual(stored, before);
  }
  process.env.DP_TIME_POLICY_RULES_ENABLED = 'true';
  assert.doesNotThrow(() => gates.assertPolicyRulesPublication({ tolerances: {}, intrajornada: true }));
}));

test('disabled preview does not read published or archived policy data', async () => disabled(async () => {
  const mod = serverModuleLoader({ '@/lib/dp-journey-resolution': {} })('src/features/dp/time-config/policy-tolerance.server.ts') as typeof import('../../src/features/dp/time-config/policy-tolerance.server');
  const db = { collection() { throw new Error('unexpected policy read'); } };
  const rules = await mod.policyDayRulesFor(db as never, 'synthetic-user');
  assert.equal(rules('2026-11-01'), null);
}));

test('disabled authenticated review service cannot query, write or notify through daily and manual paths', async () => disabled(async () => {
  let effects = 0;
  const forbidden = () => { effects++; throw new Error('unexpected review effect'); };
  const db = { collection: forbidden, runTransaction: forbidden };
  const stubs: Record<string, unknown> = {
    '@/lib/firebase-admin': { dbAdmin: db }, '@/lib/firebase-rh-admin': { hrDbAdmin: db },
    '@/lib/dp-schedule-publication': {}, '@/lib/observability/reporter': { reportSystemError: forbidden }, '@/lib/unit-access': {},
    '@/features/dp/rep-p/employee-time-access.server': { canReadEmployeeTimeRecording: () => true }, '@/features/dp/rep-p/month-days': {},
    '@/features/dp/rep-p/time-recording-month.server': {}, '@/features/dp/schedules/official-revision.server': {},
    '@/features/dp/absences/coverage/service.server': {}, '@/features/dp/rep-p/time-zones': {},
    '@/features/dp/schedules/split-journey': {}, '@/features/dp/time-adjustments/automatic-absence-core': {},
    '@/features/mobile/push/send.server': { sendUserPush: forbidden },
  };
  const service = serverModuleLoader(stubs)('src/features/dp/time-review/service.server.ts') as typeof import('../../src/features/dp/time-review/service.server');
  assert.deepEqual(await service.runTimeReviewJob('synthetic-workspace'), { evaluated: 0, opened: 0, reopened: 0, resolved: 0, notified: 0, skipped: true });
  await assert.rejects(service.requestReviewByDp({} as never, 'synthetic-user', { date: '2026-11-01', reason: 'other' as never }), (e: unknown) => (e as { code: string }).code === 'TIME_REVIEW_PENDING');
  await assert.rejects(service.markReviewRequestReviewed({} as never, 'synthetic-open-request'), (e: unknown) => (e as { code: string }).code === 'TIME_REVIEW_PENDING');
  const reader = serverModuleLoader(stubs)('src/features/dp/time-review/read.server.ts') as typeof import('../../src/features/dp/time-review/read.server');
  assert.deepEqual(await reader.listReviewRequestsOfPerson('synthetic-workspace', 'synthetic-user', '2026-11'), []);
  assert.equal(effects, 0);
}));

test('deployed daily scheduler stays inert without release and does not read its secret', async () => disabled(async () => {
  let effects = 0;
  const mod = serverModuleLoader({
    'firebase-functions/params': {
      defineSecret: () => ({ value() { effects++; throw new Error('unexpected secret read'); } }),
      defineString: () => ({ value() { effects++; throw new Error('unexpected endpoint read'); } }),
    },
    'firebase-functions/v2/scheduler': { onSchedule: (_options: unknown, handler: unknown) => handler },
  })('functions/src/system-notice-jobs.ts') as { timeReviewDailyJob: () => Promise<void> };
  await mod.timeReviewDailyJob();
  assert.equal(effects, 0);
}));

test('stored v3 and v4 calculations are readable while unknown algorithms fail closed', () => {
  assert.equal(isReadableTimeBankAlgorithmVersion('time-bank-v3'), true);
  assert.equal(isReadableTimeBankAlgorithmVersion('time-bank-v4'), true);
  for (const value of ['time-bank-v2', 'time-bank-v999', null, undefined]) assert.equal(isReadableTimeBankAlgorithmVersion(value), false);
});

test('coverage keeps the separately approved extension limit with policy rules disabled', async () => disabled(() => {
  const gates = serverModuleLoader({})('src/features/dp/time-config/rollout.server.ts') as typeof import('../../src/features/dp/time-config/rollout.server');
  const input: BankDayInput = { date: '2026-12-01', holiday: false, absences: [], markings: [],
    shift: { type: 'work', startTime: '09:00', endTime: '15:15', overnight: false, plannedMinutes: 360, referenceMinutes: 480,
      toleranceMinutes: 5, journeyId: 'coverage', coverage: true },
    policy: { id: 'legacy', version: 1, categories: [{ id: 'bank', name: 'Bank', trigger: 'workday', ratePercent: 50, destination: 'time_bank', requiresApproval: false }],
      timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review' } } };
  // Coverage was approved on 25/11 separately from the new policy tolerances/intrajornada.
  input.policy = gates.activeOvertimePolicy(input.policy as never);
  const calculate = (...times: string[]) => computeBankDay({ ...input, markings: times.map(time => `${input.date}T${time}:00-0300`) });
  assert.equal(calculate('09:00', '12:00', '12:15', '15:15').deltaMinutes, -120);
  assert.equal(calculate('09:00', '12:00', '13:00', '18:03').deltaMinutes, 0);
  assert.equal(calculate('09:00', '12:00', '13:00', '18:06').deltaMinutes, 6);
  input.shift = { ...input.shift!, coverage: false };
  assert.equal(calculate('09:00', '12:00', '13:00', '18:03').deltaMinutes, 3);
}));
