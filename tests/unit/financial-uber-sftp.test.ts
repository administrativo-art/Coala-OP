import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideUberTripMatch,
  normalizeSha256HostFingerprint,
  parseUberTripCsv,
  recognizeUberFinancialCandidate,
  uberDailyFileDate,
  uberMatchKey,
  type UberTripMatchCandidate,
} from '../../functions/src/uber-sftp/domain';

const HEADER = [
  'Trip/Eats ID',
  'Transaction Timestamp (UTC)',
  'Request Date (Local)',
  'Request Time (Local)',
  'First Name',
  'Last Name',
  'Email',
  'Employee ID',
  'Service',
  'Program',
  'Payment Method',
  'Transaction Type',
  'Transaction Amount (Local Currency)',
  'Local Currency Code',
  'Receipts',
  'Short Reference',
].join(',');

test('agrupa tarifa e ajuste da mesma viagem sem duplicar linhas', () => {
  const fare = [
    'trip-1', '2026-09-09T14:00:00Z', '09/09/2026', '11:00:00', 'Ana', 'Souza',
    'ana@example.com', 'EMP-1', 'UberX', 'Viagens', 'Visa 1234', 'Fare', '21.50', 'BRL',
    'https://example.test/receipt', 'ABC123',
  ].join(',');
  const adjustment = [
    'trip-1', '2026-09-09T15:00:00Z', '09/09/2026', '11:00:00', 'Ana', 'Souza',
    'ana@example.com', 'EMP-1', 'UberX', 'Viagens', 'Visa 1234', 'Adjustment', '3.50', 'BRL',
    '', 'DEF456',
  ].join(',');
  const eats = [
    'order-1', '2026-09-09T16:00:00Z', '09/09/2026', '12:00:00', 'Ana', 'Souza',
    'ana@example.com', 'EMP-1', 'Uber Eats', 'Refeições', 'Visa 1234', 'Fare', '40.00', 'BRL',
    '', 'EATS1',
  ].join(',');
  const trips = parseUberTripCsv([HEADER, fare, fare, adjustment, eats].join('\n'));

  assert.equal(trips.length, 1);
  assert.equal(trips[0]?.tripId, 'trip-1');
  assert.equal(trips[0]?.requesterName, 'Ana Souza');
  assert.equal(trips[0]?.requesterEmail, 'ana@example.com');
  assert.equal(trips[0]?.transactionAmountCents, 2500);
  assert.equal(trips[0]?.transactions.length, 2);
});

test('aceita o cabeçalho legado de valor e números no formato brasileiro', () => {
  const csv = [
    'Trip ID,Request Date (Local),First Name,Last Name,Service,Transaction Type,Transaction Amount in Local Currency (incl. Taxes),Local Currency Code',
    'trip-2,10/09/2026,Caio,Lima,Uber Comfort,Fare,"1.234,56",BRL',
  ].join('\n');
  const trips = parseUberTripCsv(csv);

  assert.equal(trips.length, 1);
  assert.equal(trips[0]?.transactionAmountCents, 123456);
  assert.equal(trips[0]?.requestDateLocal, '2026-09-10');
});

test('reconhece apenas saídas da Uber e cria uma janela de datas para conciliação', () => {
  const candidate = recognizeUberFinancialCandidate('transaction', 'tx-1', {
    direction: 'out',
    amount: 25,
    date: { toDate: () => new Date('2026-09-11T12:00:00Z') },
    description: 'UBER *TRIP',
  });

  assert.ok(candidate);
  assert.equal(candidate.primaryMatchKey, uberMatchKey('BRL', 2500, '2026-09-11'));
  assert.equal(candidate.matchKeys.length, 7);
  assert.equal(recognizeUberFinancialCandidate('transaction', 'tx-2', {
    direction: 'in', amount: 25, date: '2026-09-11', description: 'UBER *TRIP',
  }), null);
  assert.equal(recognizeUberFinancialCandidate('expense', 'expense-1', {
    totalValue: 25, cardChargeDate: '2026-09-11', description: 'Uber Eats',
  }), null);
});

function trip(overrides: Partial<UberTripMatchCandidate> = {}): UberTripMatchCandidate {
  const primaryMatchKey = uberMatchKey('BRL', 2500, '2026-09-11');
  return {
    documentId: 'trip-doc-1',
    tripId: 'trip-1',
    primaryMatchKey,
    matchKeys: [primaryMatchKey],
    requesterName: 'Ana Souza',
    requesterEmail: 'ana@example.com',
    employeeId: 'EMP-1',
    service: 'UberX',
    requestDateLocal: '2026-09-11',
    transactionAmountCents: 2500,
    currencyCode: 'BRL',
    receiptUrl: null,
    matchedExpenseIds: [],
    matchedTransactionIds: [],
    ...overrides,
  };
}

test('só concilia automaticamente quando há uma viagem única e não reivindicada', () => {
  const candidate = recognizeUberFinancialCandidate('expense', 'expense-1', {
    totalValue: 25,
    cardChargeDate: '2026-09-11',
    supplier: 'Uber',
  });
  assert.ok(candidate);

  assert.equal(decideUberTripMatch(candidate, []).status, 'waiting');
  assert.equal(decideUberTripMatch(candidate, [trip()]).status, 'matched');
  assert.deepEqual(decideUberTripMatch(candidate, [
    trip(),
    trip({ documentId: 'trip-doc-2', tripId: 'trip-2' }),
  ]), {
    status: 'ambiguous',
    reason: 'multiple_trips',
    tripDocumentIds: ['trip-doc-1', 'trip-doc-2'],
  });
  assert.deepEqual(decideUberTripMatch(candidate, [trip({ matchedExpenseIds: ['expense-other'] })]), {
    status: 'ambiguous',
    reason: 'trip_already_claimed',
    tripDocumentIds: ['trip-doc-1'],
  });
});

test('normaliza a impressão digital OpenSSH para o formato usado pelo cliente SFTP', () => {
  const openssh = 'SHA256:viFHQH8NXMY/G9U+V1C3emnceLaREBZ54naW9277Gwo';
  const normalized = normalizeSha256HostFingerprint(openssh);

  assert.match(normalized, /^[a-f0-9]{64}$/);
  assert.equal(normalizeSha256HostFingerprint(normalized.toUpperCase()), normalized);
});

test('aceita os dois formatos diários de nome e rejeita datas inválidas', () => {
  assert.equal(uberDailyFileDate('daily_trips-2026-09-09.csv'), '2026-09-09');
  assert.equal(uberDailyFileDate('daily_trips_2026_09_09.csv'), '2026-09-09');
  assert.equal(uberDailyFileDate('daily_trips-2026-02-30.csv'), null);
  assert.equal(uberDailyFileDate('monthly_trips-2026-09.csv'), null);
});
