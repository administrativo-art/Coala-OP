import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decidePdvSnapshot,
  previousMonthDates,
  reconciliationDates,
  type PdvSnapshotMetrics,
} from '../../functions/src/pdv-reconciliation-policy';

function metrics(overrides: Partial<PdvSnapshotMetrics> = {}): PdvSnapshotMetrics {
  return {
    couponCount: 100,
    itemQuantity: 150,
    revenueCents: 100_000,
    fingerprint: 'base',
    ...overrides,
  };
}

test('reconcilia os sete dias fechados sem incluir o dia corrente', () => {
  assert.deepEqual(reconciliationDates('2026-09-15'), [
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
  ]);
});

test('nos dias 2 e 7 inclui todo o mês anterior sem duplicar datas', () => {
  assert.equal(previousMonthDates('2026-09-02').length, 31);
  assert.deepEqual(previousMonthDates('2026-03-02').slice(-2), ['2026-02-27', '2026-02-28']);
  assert.equal(reconciliationDates('2026-09-02').length, 32);
  assert.equal(reconciliationDates('2026-09-07').length, 37);
});

test('aplica imediatamente cupons tardios que aumentam o snapshot', () => {
  const existing = metrics({
    couponCount: 1_733,
    itemQuantity: 2_401,
    revenueCents: 1_988_800,
    fingerprint: 'snapshot-23h',
  });
  const incoming = metrics({
    couponCount: 1_750,
    itemQuantity: 2_426,
    revenueCents: 2_006_300,
    fingerprint: 'snapshot-reconciliado',
  });

  assert.deepEqual(
    decidePdvSnapshot({ existing, incoming, pendingDecrease: null }),
    { action: 'apply', reason: 'changed' },
  );
});

test('não regrava snapshot idêntico', () => {
  const existing = metrics();
  assert.deepEqual(
    decidePdvSnapshot({ existing, incoming: metrics(), pendingDecrease: null }),
    { action: 'unchanged', clearPending: false },
  );
});

test('queda precisa aparecer igual em duas consultas antes de ser aceita', () => {
  const existing = metrics();
  const incoming = metrics({ couponCount: 99, revenueCents: 99_000, fingerprint: 'queda' });

  assert.deepEqual(
    decidePdvSnapshot({ existing, incoming, pendingDecrease: null }),
    { action: 'hold', reason: 'unconfirmed_decrease', confirmations: 1 },
  );
  assert.deepEqual(
    decidePdvSnapshot({
      existing,
      incoming,
      pendingDecrease: { fingerprint: 'queda', confirmations: 1 },
    }),
    { action: 'apply', reason: 'confirmed_decrease' },
  );
});

test('resposta vazia nunca apaga automaticamente um dia com vendas', () => {
  assert.deepEqual(
    decidePdvSnapshot({
      existing: metrics(),
      incoming: metrics({ couponCount: 0, itemQuantity: 0, revenueCents: 0, fingerprint: 'vazio' }),
      pendingDecrease: { fingerprint: 'vazio', confirmations: 20 },
    }),
    { action: 'hold', reason: 'empty_after_data', confirmations: 0 },
  );
});
