import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import type { ServerUserContext } from '../../src/lib/auth-server';
import { defaultAdminPermissions } from '../../src/types';
import { sha256 } from '../../src/features/dp/time-adjustments/closure-core';
import type { ProviderClosureContent, ProviderClosureRelease } from '../../src/features/service-portal/closure-types';
import { comparePayslipQuantities, normalizeReconciliationLines, payslipReconciliationPreviewSchema,
  payslipReconciliationSubmitSchema, type ReconciliationLine, type ReconciliationSubmitInput } from '../../src/features/dp/time-adjustments/payslip-reconciliation';
import { assertCurrentPayslipReconciliation, assertReconciliationPackageLease, previewPayslipReconciliation,
  readPayslipReconciliation, readReconciliationPayslip, reserveReconciliationForPackage, releaseReconciliationPackageLease,
  submitPayslipReconciliation, type PayslipReconciliationDependencies } from '../../src/features/dp/time-adjustments/payslip-reconciliation.server';
import { sendClosingPackage, readClosingPackage } from '../../src/features/dp/time-adjustments/closing-package.server';

type Row = Record<string, unknown>;
class MemoryDatabase {
  rows = new Map<string, Row>();
  private queue = Promise.resolve();
  collection(name: string) { return new MemoryCollection(this, name); }
  async getAll(...refs: MemoryReference[]) { return Promise.all(refs.map((ref) => ref.get())); }
  async runTransaction<T>(callback: (tx: MemoryTransaction) => Promise<T>) {
    let release = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const tx = new MemoryTransaction(this);
      const result = await callback(tx);
      tx.commit(); return result;
    } finally { release(); }
  }
}
class MemoryReference {
  constructor(readonly db: MemoryDatabase, readonly path: string) {}
  get id() { return this.path.split('/').at(-1)!; }
  collection(name: string) { return new MemoryCollection(this.db, this.path + '/' + name); }
  async get() { return snapshot(this, this.db.rows.get(this.path)); }
  async create(row: Row) { assert.equal(this.db.rows.has(this.path), false); this.db.rows.set(this.path, structuredClone(row)); }
}
function snapshot(ref: MemoryReference, row?: Row) {
  return { exists: Boolean(row), id: ref.id, ref, data: () => row ? structuredClone(row) : undefined, get: (key: string) => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Row)[part] : undefined, row) };
}
class MemoryCollection {
  private filters: Array<[string, unknown]> = [];
  private maximum = Infinity;
  constructor(private db: MemoryDatabase, private name: string) {}
  doc(id: string) { return new MemoryReference(this.db, this.name + '/' + id); }
  select(..._fields: string[]) { return this; }
  where(field: string, _operator: string, value: unknown) { this.filters.push([field, value]); return this; }
  limit(value: number) { this.maximum = value; return this; }
  async get() {
    const depth = this.name.split('/').length + 1;
    const docs = [...this.db.rows].filter(([path, row]) => path.startsWith(this.name + '/') && path.split('/').length === depth
      && this.filters.every(([field, value]) => row[field] === value)).sort(([left], [right]) => left.localeCompare(right))
      .slice(0, this.maximum).map(([path, row]) => snapshot(new MemoryReference(this.db, path), row));
    return { docs, size: docs.length, empty: !docs.length };
  }
}
class MemoryTransaction {
  private changes: Array<{ ref: MemoryReference; row: Row; create: boolean }> = [];
  constructor(private db: MemoryDatabase) {}
  get<T extends { get(): Promise<unknown> }>(ref: T): ReturnType<T['get']> { return ref.get() as ReturnType<T['get']>; }
  set(ref: MemoryReference, row: Row) { this.changes.push({ ref, row, create: false }); }
  create(ref: MemoryReference, row: Row) { this.changes.push({ ref, row, create: true }); }
  update(ref: MemoryReference, row: Row) { this.changes.push({ ref, row: { ...this.db.rows.get(ref.path), ...row }, create: false }); }
  commit() {
    for (const item of this.changes) {
      if (item.create) assert.equal(this.db.rows.has(item.ref.path), false);
      this.db.rows.set(item.ref.path, structuredClone(item.row));
    }
  }
}

const uid = 'employee-a';
const competence = '2026-02';
function content(): ProviderClosureContent {
  return { schemaVersion: 1, employee: { uid, name: 'Ana' }, employer: { unitId: 'employer', name: 'Empresa', cnpj: '12345678000195' },
    competence, closureVersion: 1, mirror: { days: [] }, documents: [],
    payroll: { overtime: [{ ratePercent: 50, destination: 'payroll', minutes: 480, creditFactor: null }],
      absenceEffects: [], unjustifiedAbsenceDates: ['2026-02-05'], scheduledDays: 20, workedDays: 19,
      creditMinutes: 10, debitMinutes: 5, monthBalanceMinutes: 5, discountMinutes: 0, nightMinutes: 60,
      expiredCreditMinutes: 0, bankPayrollMinutes: 0, payrollOvertimeMinutes: 480 } };
}
const absentKinds = ['discount', 'expired_credit', 'bank_payroll'] as const;
function actual(minutes = 480, ratePercent = 50): ReconciliationLine[] {
  return [{ kind: 'overtime', unit: 'minutes', quantity: minutes, ratePercent }];
}
function fixture() {
  const main = new MemoryDatabase(); const hr = new MemoryDatabase();
  let now = new Date('2026-03-03T12:00:00Z');
  const context = { decoded: { uid: 'rh' }, workspace_id: 'coala', userDoc: {}, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true } as ServerUserContext;
  const bytes = Buffer.from('%PDF-1.7\nContracheque sintético');
  const documentHash = createHash('sha256').update(bytes).digest('hex');
  main.rows.set('users/' + uid, { username: 'Ana', email: 'ana@example.test', hrEmployeeId: 'hr-a' });
  hr.rows.set('employees/hr-a', { auth_uid: uid, source_user_id: uid });
  const closurePath = 'ptrp_competenceClosures/coala_' + competence;
  const frozen = closurePath + '/versions/1';
  hr.rows.set(closurePath, { workspaceId: 'coala', competence, status: 'closed', version: 1 });
  hr.rows.set(frozen, { workspaceId: 'coala', competence, status: 'closed', version: 1 });
  hr.rows.set(frozen + '/people/' + uid, { uid, name: 'Ana' });
  hr.rows.set('employeeDocuments/pdf', { employeeId: 'hr-a', documentTypeCode: 'PAYSLIP', caseId: 'month-' + competence,
    version: 1, contentHash: documentHash, storagePath: 'private/pdf', mimeType: 'application/pdf', size: bytes.length,
    createdAt: '2026-03-03T10:00:00Z', status: 'validated', displayName: 'Contracheque de teste' });
  const release = { id: 'release', workspaceId: 'coala', employeeUid: uid, employerUnitId: 'employer', employeeId: 'hr-a',
    competence, closureVersion: 1, content: content(), contentHash: sha256(content()), sourceHash: 'a'.repeat(64), employmentProofHash: 'b'.repeat(64),
    createdAt: '2026-03-03T10:00:00Z', createdBy: 'rh', memberId: 'member', officeId: 'office', grantId: 'grant',
    historyId: 'history', historyRevision: 1, requestId: randomUUID(), payslip: null } as ProviderClosureRelease;
  hr.rows.set('providerClosureReleases/release', release as unknown as Row);
  const seenTransactions: boolean[] = [];
  const deps: PayslipReconciliationDependencies = { mainDb: main as unknown as Firestore, hrDb: hr as unknown as Firestore,
    now: () => now, randomId: randomUUID, readStorage: async () => bytes,
    readRelease: async (_context, releaseId, tx) => {
      seenTransactions.push(Boolean(tx));
      if (releaseId !== release.id || hr.rows.get(closurePath)!.status !== 'closed' || hr.rows.get(closurePath)!.version !== release.closureVersion) throw new (await import('../../src/lib/observability/app-error')).AppError({ code: 'PROVIDER_CLOSURE_UNAVAILABLE', kind: 'CONFLICT', safeMessage: 'Entrega atualizada.' });
      return structuredClone(release);
    } };
  const input = (minutes = 480): ReconciliationSubmitInput => ({ competence, employeeUid: uid, releaseId: 'release', documentId: 'pdf', documentHash,
    lines: actual(minutes), absentKinds: [...absentKinds], acknowledgment: true, expectedVersion: 0, requestId: randomUUID() });
  return { main, hr, deps, context, input, release, bytes, documentHash, seenTransactions, closurePath, frozen,
    advance: (value: string) => { now = new Date(value); } };
}

test('point quantities distinguish six hours, another percentage, absent and unexpected lines', () => {
  assert.equal(comparePayslipQuantities(content(), actual(480), [...absentKinds]).status, 'match');
  assert.equal(comparePayslipQuantities(content(), actual(360), [...absentKinds]).differences[0].code, 'quantity');
  assert.equal(comparePayslipQuantities(content(), actual(480, 100), [...absentKinds]).differences[0].code, 'rate');
  assert.equal(comparePayslipQuantities(content(), [], ['overtime', ...absentKinds]).differences[0].code, 'missing');
  const extra = comparePayslipQuantities(content(), [...actual(), { kind: 'overtime', unit: 'minutes', quantity: 30, ratePercent: 100 }], [...absentKinds]);
  assert.equal(extra.differences[0].code, 'unexpected');
  assert.equal(comparePayslipQuantities(content(), [...actual(240), ...actual(240)], [...absentKinds]).status, 'match');
  assert.equal(normalizeReconciliationLines([...actual(240), ...actual(240)])[0].quantity, 480);
});

test('strict schemas reject omitted quantities, null, foreign units and incomplete declarations', () => {
  const f = fixture(); const input = f.input();
  assert.equal(payslipReconciliationSubmitSchema.safeParse(input).success, true);
  for (const invalid of [ { ...input, lines: [{ ...actual()[0], quantity: null }] },
    { ...input, lines: [{ kind: 'overtime', ratePercent: 50, unit: 'hours', quantity: 8 }] },
    { ...input, absentKinds: [] }, { ...input, acknowledgment: false },
    { ...input, lines: [{ ...actual()[0], unexpectedField: true }] },
    { ...input, lines: [{ kind: 'discount', unit: 'minutes', quantity: 0, ratePercent: 50 }] } ]) {
    assert.equal(payslipReconciliationSubmitSchema.safeParse(invalid).success, false);
  }
  assert.equal(payslipReconciliationPreviewSchema.safeParse({ ...input, requestId: undefined, expectedVersion: undefined }).success, false);
});

test('bank transfers and expired credits remain separate and night/absence values stay references', () => {
  const value = content(); value.payroll.expiredCreditMinutes = 30; value.payroll.bankPayrollMinutes = 40; value.payroll.payrollOvertimeMinutes = 550;
  const compared = comparePayslipQuantities(value, [...actual(), { kind: 'expired_credit', unit: 'minutes', quantity: 30 }, { kind: 'bank_payroll', unit: 'minutes', quantity: 40 }], ['discount']);
  assert.equal(compared.status, 'match');
  assert.equal(compared.references.nightMinutes, 60);
  assert.deepEqual(compared.references.unjustifiedAbsenceDates, ['2026-02-05']);
  assert.equal(compared.expected.find((line) => line.kind === 'discount')!.quantity, 0);
  value.payroll.payrollOvertimeMinutes = 560;
  assert.throws(() => comparePayslipQuantities(value, actual(), [...absentKinds]));
});

test('submissions are immutable, idempotent and concurrent pointer replacement requires its current version', async () => {
  const f = fixture(); const input = f.input();
  const first = await submitPayslipReconciliation(f.context, input, f.deps);
  const replay = await submitPayslipReconciliation(f.context, input, f.deps);
  assert.equal(first.id, replay.id);
  assert.equal([...f.hr.rows.keys()].filter((key) => key.startsWith('ptrp_payslipReconciliations/')).length, 1);
  await assert.rejects(submitPayslipReconciliation(f.context, { ...input, lines: actual(360) }, f.deps));
  const changed = await submitPayslipReconciliation(f.context, { ...f.input(360), expectedVersion: 1 }, f.deps);
  assert.equal(changed.comparison.status, 'divergent');
  const concurrent = await Promise.allSettled([submitPayslipReconciliation(f.context, { ...f.input(), expectedVersion: 2 }, f.deps), submitPayslipReconciliation(f.context, { ...f.input(), expectedVersion: 2 }, f.deps)]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(f.seenTransactions.includes(true));
  assert.equal((await readPayslipReconciliation(f.context, { competence, employeeUid: uid }, f.deps)).version, 3);
});

test('permissions and workspace membership precede document names and file access', async () => {
  const f = fixture(); let reads = 0; f.deps.readStorage = async () => { reads++; return f.bytes; };
  const partial = { ...f.context, isDefaultAdmin: false, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['employer'] } } as ServerUserContext;
  await assert.rejects(readPayslipReconciliation(partial, { competence, employeeUid: uid }, f.deps));
  await assert.rejects(previewPayslipReconciliation({ ...f.context, viewAs: { targetUserId: uid } } as unknown as ServerUserContext, f.input(), f.deps));
  await assert.rejects(readPayslipReconciliation({ ...f.context, workspace_id: 'other-workspace' }, { competence, employeeUid: uid }, f.deps));
  assert.equal(reads, 0);
});

test('current status detects changed document/release/version and does not swallow transient failures', async () => {
  const f = fixture(); await submitPayslipReconciliation(f.context, f.input(), f.deps);
  const count = f.main.rows.size + f.hr.rows.size;
  const state = await readPayslipReconciliation(f.context, { competence, employeeUid: uid }, f.deps);
  assert.equal(state.current?.status, 'match');
  assert.equal(f.main.rows.size + f.hr.rows.size, count);
  f.release.sourceHash = 'c'.repeat(64);
  assert.equal((await readPayslipReconciliation(f.context, { competence, employeeUid: uid }, f.deps)).current?.status, 'stale');
  f.release.sourceHash = 'a'.repeat(64);
  f.hr.rows.get('employeeDocuments/pdf')!.version = 2;
  assert.equal((await readPayslipReconciliation(f.context, { competence, employeeUid: uid }, f.deps)).current?.status, 'stale');
  f.hr.rows.get('employeeDocuments/pdf')!.version = 1;
  await assert.rejects(readPayslipReconciliation(f.context, { competence, employeeUid: uid }, { ...f.deps, readRelease: async () => { throw new Error('temporary database failure'); } }));
});

test('protected file download verifies bytes and current document before adding an audit event', async () => {
  const f = fixture();
  assert.deepEqual((await readReconciliationPayslip(f.context, { competence, employeeUid: uid, documentId: 'pdf', documentHash: f.documentHash }, f.deps)).bytes, f.bytes);
  assert.equal([...f.hr.rows.keys()].filter((key) => key.startsWith('ptrp_payslipReconciliationAudit/')).length, 1);
  f.deps.readStorage = async () => Buffer.from('%PDF-1.7\nOutro conteúdo');
  await assert.rejects(readReconciliationPayslip(f.context, { competence, employeeUid: uid, documentId: 'pdf', documentHash: f.documentHash }, f.deps));
});

test('a matching gate is reserved and CAS cleanup cannot erase another lease', async () => {
  const f = fixture(); await submitPayslipReconciliation(f.context, f.input(), f.deps);
  const query = { competence, employeeUid: uid, closureVersion: 1 };
  const reservation = await reserveReconciliationForPackage(f.context, query, f.deps);
  await assert.rejects(submitPayslipReconciliation(f.context, { ...f.input(), expectedVersion: 1 }, f.deps));
  await assertReconciliationPackageLease(f.context, query, reservation.stamp, reservation.lease, f.deps);
  f.advance('2026-03-03T12:11:00Z');
  const later = await reserveReconciliationForPackage(f.context, query, f.deps);
  await releaseReconciliationPackageLease(f.context, query, reservation.lease, f.deps);
  await assertReconciliationPackageLease(f.context, query, later.stamp, later.lease, f.deps);
  await assert.rejects(assertReconciliationPackageLease(f.context, query, reservation.stamp, reservation.lease, f.deps));
  await releaseReconciliationPackageLease(f.context, query, later.lease, f.deps);
});

test('divergent reconciliation stops package delivery before signing, storage or provider creation', async () => {
  const f = fixture(); await submitPayslipReconciliation(f.context, f.input(360), f.deps);
  const calls = { sign: 0, save: 0, provider: 0 };
  await assert.rejects(assertCurrentPayslipReconciliation(f.context, { competence, employeeUid: uid, closureVersion: 1 }, f.deps));
  await assert.rejects(sendClosingPackage(f.context, { action: 'send', competence, employeeUid: uid, expectedVersion: 1 }, {
    mainDb: f.main as unknown as Firestore, hrDb: f.hr as unknown as Firestore, now: f.deps.now,
    reconciliationDependencies: f.deps,
    sign: async () => { calls.sign++; return { bytes: Buffer.alloc(0), certificateCnpj: '12345678000195' }; },
    storage: { download: async () => f.bytes, save: async () => { calls.save++; } },
    createDocument: async () => { calls.provider++; throw new Error('provider must not be called'); },
  }));
  assert.deepEqual(calls, { sign: 0, save: 0, provider: 0 });
});


test('a reopen-only reviewer reads the legacy package without querying a restricted reconciliation', async () => {
  const f=fixture(); const permissions=structuredClone(defaultAdminPermissions);
  permissions.dp!.timeClosure!.close=false; permissions.dp!.timeClosure!.reopen=true;
  const actor={...f.context,isDefaultAdmin:false,permissions};
  const result=await readClosingPackage(actor,{competence,employeeUid:uid},{mainDb:f.main as unknown as Firestore,hrDb:f.hr as unknown as Firestore,now:f.deps.now});
  assert.equal(result.reconciliation.status,'restricted'); assert.equal(result.package,null);
});
