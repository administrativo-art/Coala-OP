import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import type { ServerUserContext } from '../../src/lib/auth-server';
import { defaultAdminPermissions } from '../../src/types';
import { buildStatement, monthTotals, type BankDay, type BankManualMovement } from '../../src/features/dp/time-bank/core';
import type { BankMonthDocument } from '../../src/features/dp/time-bank/service.server';
import { mirrorSnapshotHash, MIRROR_RENDERER_VERSION, type MirrorSnapshot } from '../../src/features/dp/time-adjustments/mirror-core';
import { sha256 } from '../../src/features/dp/time-adjustments/closure-core';
import {
  buildProviderClosureContent, listClosureReleaseCandidates, listReleasedClosures, previewClosureRelease,
  readReleasedClosure, readReleasedPayslip, recordClosureAccess, releaseClosureToProvider,
} from '../../src/features/service-portal/closure-server';
import type { ClosureReleaseDependencies } from '../../src/features/service-portal/closure-types';
import type { PortalPrincipal } from '../../src/features/service-portal/types';

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
  return { exists: Boolean(row), id: ref.id, ref, data: () => row ? structuredClone(row) : undefined, get: (key: string) => row?.[key] };
}
class MemoryCollection {
  private filters: Array<[string, unknown]> = [];
  private maximum = Infinity;
  constructor(private db: MemoryDatabase, private name: string) {}
  doc(id: string) { return new MemoryReference(this.db, this.name + '/' + id); }
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
  commit() {
    for (const item of this.changes) {
      if (item.create) assert.equal(this.db.rows.has(item.ref.path), false);
      this.db.rows.set(item.ref.path, structuredClone(item.row));
    }
  }
}
const uid = 'employee-a';
const competence = '2026-02';
const cnpj = '12345678000195';
function fixture() {
  const main = new MemoryDatabase(); const hr = new MemoryDatabase();
  const grantId = 'grant-a'; const closurePath = 'ptrp_competenceClosures/coala_' + competence;
  const frozen = closurePath + '/versions/1'; const manifestHash = 'a'.repeat(64);
  const days: BankDay[] = Array.from({ length: 28 }, (_, index) => ({ date: competence + '-' + String(index + 1).padStart(2, '0'),
    kind: index === 0 ? 'workday' : 'no_schedule', holiday: false, sunday: false, referenceMinutes: index === 0 ? 480 : null,
    plannedMinutes: index === 0 ? 480 : null, workedMinutes: index === 0 ? 540 : 0, consideredMinutes: index === 0 ? 540 : null,
    deltaMinutes: index === 0 ? 60 : null, toleranceApplied: false, abonoMinutes: 0, nightMinutes: 0, absences: [], unjustifiedAbsence: false,
    policy: { id: 'policy', version: 1 }, issues: [], lines: index === 0 ? [{ nature: 'payroll_overtime', minutes: 60, reason: 'worked_more', ratePercent: 50 }] : [] }));
  days[1].absences = [{ id: 'private-absence-id', effect: 'excused_absence' }];
  const month: BankMonthDocument = { schemaVersion: 1, algorithmVersion: 'time-bank-v3', uid, competence, closureVersion: 1,
    days, totals: monthTotals(days), inputHash: 'b'.repeat(64), generatedAt: '2026-03-03T12:00:00Z', createdBy: 'internal-actor', policies: [{ id: 'policy', version: 1 }] };
  const mirror: MirrorSnapshot = { schemaVersion: 1, title: 'Espelho de ponto', workspaceId: 'coala', competence, closureVersion: 1, manifestHash,
    employee: { uid, name: 'Ana', cpf: '12345678901' }, employer: { legalName: 'Empresa A', cnpj }, generatedAt: '2026-03-03T12:00:00Z', clockSource: 'server',
    days: days.map((day, index) => ({ date: day.date, shift: index === 0 ? 'Turno' : null, pairedMinutes: index === 0 ? 540 : 0,
      absences: index === 1 ? ['Diagnóstico reservado'] : [], punches: index === 0 ? [{ time: '08:00', at: day.date + 'T08:00:00-0300', nsr: 1, mark: 'original' }, { time: '17:00', at: day.date + 'T17:00:00-0300', nsr: 2, mark: 'original' }] : [] })),
    adjustments: [], absences: [], shiftSwaps: [], actors: { 'internal-actor': 'Revisor Reservado' }, truncated: false, arpReading: { count: 2, maxNsr: 2, readAt: '2026-03-03T12:00:00Z' } };
  main.rows.set('users/' + uid, { username: 'Ana', hrEmployeeId: 'hr-a' });
  main.rows.set('dp_units/employer-a', { name: 'Empresa A', cnpj });
  main.rows.set('providerMembers/member-a', { id: 'member-a', workspaceId: 'coala', officeId: 'office-a', active: true, status: 'active', profile: 'accounting', accountType: 'service_provider' });
  main.rows.set('providerOffices/office-a', { id: 'office-a', workspaceId: 'coala', active: true });
  main.rows.set('providerPortalGrants/' + grantId, { id: grantId, workspaceId: 'coala', officeId: 'office-a', memberId: 'member-a', employerUnitId: 'employer-a', competence, expiresAt: '2026-04-01T12:00:00Z', revokedAt: null });
  const head = createHash('sha256').update(JSON.stringify(['coala', uid])).digest('hex');
  const historyId = head + '_r1';
  main.rows.set('dp_employmentReferenceHeads/' + head, { revision: 1, historyId });
  main.rows.set('dp_employmentReferenceHistories/' + historyId, { workspaceId: 'coala', userId: uid, revision: 1, historyId,
    periods: [{ validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: 'employer-a', unitId: 'employer-a', unitIds: ['employer-a'],
      jobFunctionIds: [], jobRoleName: null, jobFunctionNames: [], sourceDocumentId: 'contract', sourceReason: 'Contrato confirmado',
      employer: { unitId: 'employer-a', unitName: 'Empresa A', cnpj, address: 'Rua A', identityStatus: 'catalog_identifiers_consistent_unverified' } }] });
  hr.rows.set(closurePath, { workspaceId: 'coala', competence, status: 'closed', version: 1, peopleCount: 1, manifestHash });
  hr.rows.set(frozen, { manifestHash });
  hr.rows.set(frozen + '/people/' + uid, { uid, name: 'Ana', adjustments: [], absences: [], shiftSwaps: [] });
  hr.rows.set(frozen + '/mirrors/' + uid, { snapshot: mirror, snapshotHash: mirrorSnapshotHash(mirror), rendererVersion: MIRROR_RENDERER_VERSION });
  hr.rows.set(frozen + '/timeBank/' + uid, structuredClone(month) as unknown as Row);
  hr.rows.set('employees/hr-a', { auth_uid: uid, source_user_id: uid });
  const context = { decoded: { uid: 'rh' }, workspace_id: 'coala', userDoc: {}, permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true } as ServerUserContext;
  const principal: PortalPrincipal = { memberId: 'member-a', officeId: 'office-a', workspaceId: 'coala', name: 'Contadora', email: 'contador@example.test', accountType: 'service_provider', profile: 'accounting' };
  let extraLines: ReturnType<typeof buildStatement>['lines'] = [];
  let expiration: { days: number | null; destination: 'payroll' } = { days: null, destination: 'payroll' };
  let missing: string[] = [];
  const deps: ClosureReleaseDependencies = { mainDb: main as unknown as Firestore, hrDb: hr as unknown as Firestore,
    now: () => new Date('2026-03-04T12:00:00Z'), randomId: randomUUID,
    readReadiness: async () => ({ competence, version: 1, total: 1, readyCount: 1, ready: true, people: [{ uid, status: 'ready', reason: 'Apuração concluída' }] }),
    readStatement: async () => {
      const current = hr.rows.get(frozen + '/timeBank/' + uid) as unknown as BankMonthDocument;
      const movements = [...hr.rows].filter(([key]) => key.startsWith(closurePath + '/timeBankMovements/')).map(([, row]) => row as unknown as BankManualMovement);
      const statement = buildStatement({ period: null, today: '2026-02-28', months: [current], movements, missing, openingMinutes: 0,
        timeBank: { allowNegativeBalance: true, positiveLimitMinutes: undefined, negativeLimitMinutes: undefined } });
      statement.lines.push(...extraLines);
      return { policy: { id: 'policy', version: 1, name: 'Política', enabled: true, cycle: null }, statement, closures: { [competence]: 1 }, expiration, previewCompetences: [], pilotPreview: false };
    } };
  const selection = { grantId, employeeUid: uid, includePayslip: false };
  const release = async () => {
    const preview = await previewClosureRelease(context, selection, deps);
    return releaseClosureToProvider(context, { ...selection, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash }, deps);
  };
  return { main, hr, month, mirror, deps, context, principal, grantId, selection, closurePath, frozen, release, historyId, addLines: (lines: typeof extraLines) => { extraLines = lines; }, setMissing: (months: string[], days: number | null) => { missing = months; expiration = { days, destination: 'payroll' }; } };
}

test('projection preserves accounting quantities and omits HR reasons, third parties and full CPF', () => {
  const f = fixture();
  const content = buildProviderClosureContent({ mirror: f.mirror, month: f.month, movements: [], employer: { unitId: 'employer-a', name: 'Empresa A', cnpj } });
  assert.equal(content.payroll.payrollOvertimeMinutes, 60);
  assert.deepEqual(content.payroll.absenceEffects, [{ date: '2026-02-02', effect: 'excused_absence' }]);
  assert.equal(content.employee.cpfMasked, '***.***.789-01');
  const json = JSON.stringify(content);
  for (const secret of ['12345678901', 'Diagnóstico reservado', 'Revisor Reservado', 'internal-actor', 'private-absence-id', 'nsr', 'reason', 'actors', 'cpf"']) assert.equal(json.includes(secret), false);
  assert.throws(() => buildProviderClosureContent({ mirror: { ...f.mirror, days: [...f.mirror.days].reverse() }, month: f.month, movements: [], employer: content.employer }));
});

test('preview and release require explicit source confirmation and repeat without creating another release', async () => {
  const f = fixture();
  assert.equal((await listClosureReleaseCandidates(f.context, f.grantId, f.deps)).people.length, 1);
  const preview = await previewClosureRelease(f.context, f.selection, f.deps);
  const input = { ...f.selection, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash };
  await assert.rejects(releaseClosureToProvider(f.context, { ...input, expectedSourceHash: '0'.repeat(64) }, f.deps));
  const [first, second] = await Promise.all([releaseClosureToProvider(f.context, input, f.deps), releaseClosureToProvider(f.context, input, f.deps)]);
  assert.equal(first.releaseId, second.releaseId);
  assert.equal([...f.hr.rows.keys()].filter((key) => key.startsWith('providerClosureReleases/')).length, 1);
  const beforeReads = f.main.rows.size + f.hr.rows.size;
  assert.equal((await readReleasedClosure(f.principal, f.grantId, first.releaseId, f.deps)).employee.uid, uid);
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'available');
  assert.equal(f.main.rows.size + f.hr.rows.size, beforeReads);
  await recordClosureAccess(f.principal, { grantId: f.grantId, releaseId: first.releaseId, action: 'open' }, f.deps);
  assert.equal([...f.main.rows].filter(([key]) => key.startsWith('providerPortalAudit/')).length, 1);
});

test('external access rejects a different member, revoked grant, reopened month and changed employment proof', async () => {
  const f = fixture(); const released = await f.release();
  await assert.rejects(readReleasedClosure({ ...f.principal, memberId: 'other-person' }, f.grantId, released.releaseId, f.deps));
  f.main.rows.get('providerPortalGrants/' + f.grantId)!.revokedAt = '2026-03-04T12:00:00Z';
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
  f.main.rows.get('providerPortalGrants/' + f.grantId)!.revokedAt = null;
  f.hr.rows.get(f.closurePath)!.status = 'open';
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'reopened');
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
  f.hr.rows.get(f.closurePath)!.status = 'closed';
  f.main.rows.get('users/' + uid)!.operationalUnitPeriods = [];
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'employment_changed');
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
});

test('material movements invalidate the same closure version and expired credits enter payroll explicitly', async () => {
  const f = fixture(); const released = await f.release();
  f.hr.rows.set(f.closurePath + '/timeBankMovements/movement', { id: 'movement', uid, date: '2026-02-01', competence, status: 'active', kind: 'adjustment',
    minutes: 20, reason: 'Motivo reservado do ajuste', createdAt: '2026-03-04T12:00:00Z', createdBy: 'private-actor', line: { nature: 'bank_credit', minutes: 20, reason: 'manual_adjustment' } });
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'outdated');
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
  f.addLines([{ competence, date: '2026-02-25', closureVersion: 0, line: { nature: 'bank_debit', minutes: 30, reason: 'credit_expired' } },
    { competence, date: '2026-02-25', closureVersion: 0, line: { nature: 'payroll_overtime', minutes: 30, reason: 'credit_expired' } }]);
  const preview = await previewClosureRelease(f.context, f.selection, f.deps);
  assert.equal(preview.content.payroll.expiredCreditMinutes, 30);
  assert.equal(preview.content.payroll.payrollOvertimeMinutes, 90);
  assert.equal(preview.content.payroll.creditMinutes, 20);
  assert.equal(preview.content.payroll.debitMinutes, 30);
  assert.equal(preview.content.payroll.monthBalanceMinutes, -10);
  f.addLines([{ competence, date: '2026-02-28', closureVersion: 0, line: { nature: 'payroll_overtime', minutes: 15, reason: 'payroll_settlement' } }]);
  assert.equal((await previewClosureRelease(f.context, f.selection, f.deps)).content.payroll.bankPayrollMinutes, 15);
});

function attachPayslip(f: ReturnType<typeof fixture>) {
  const bytes = Buffer.from('%PDF-1.7\nContracheque sintético de teste.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  f.hr.rows.set(f.frozen + '/packages/' + uid, { uid, employeeId: 'hr-a', competence, closureVersion: 1,
    mirrorHash: mirrorSnapshotHash(f.mirror), payslip: { documentId: 'payslip-a', sha256: hash }, status: 'sent', updatedAt: '2026-03-03T12:00:00Z' });
  f.hr.rows.set('employeeDocuments/payslip-a', { employeeId: 'hr-a', documentTypeCode: 'PAYSLIP', caseId: 'month-' + competence,
    storagePath: 'private/payslip.pdf', contentHash: hash, version: 1, status: 'approved' });
  f.deps.readStorage = async () => bytes;
  return bytes;
}

test('payslip requires explicit selection, reciprocal HR identity and the package frozen hash', async () => {
  const f = fixture(); const bytes = attachPayslip(f);
  assert.deepEqual((await previewClosureRelease(f.context, f.selection, f.deps)).content.documents, []);
  const selected = { ...f.selection, includePayslip: true };
  const preview = await previewClosureRelease(f.context, selected, f.deps);
  assert.equal(preview.content.documents[0].kind, 'payslip');
  const released = await releaseClosureToProvider(f.context, { ...selected, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash }, f.deps);
  assert.deepEqual((await readReleasedPayslip(f.principal, f.grantId, released.releaseId, f.deps)).bytes, bytes);
  f.hr.rows.get(f.frozen + '/packages/' + uid)!.status = 'signed';
  f.hr.rows.get(f.frozen + '/packages/' + uid)!.updatedAt = '2026-03-04T12:00:00Z';
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'available');
  f.deps.readStorage = async () => Buffer.from('%PDF-1.7\nArquivo adulterado');
  await assert.rejects(readReleasedPayslip(f.principal, f.grantId, released.releaseId, f.deps));
  f.hr.rows.get('employees/hr-a')!.source_user_id = 'another-person';
  await assert.rejects(previewClosureRelease(f.context, selected, f.deps));
});

test('document type, bytes and absence of the frozen mirror fail closed', async () => {
  const f = fixture(); attachPayslip(f);
  f.hr.rows.get('employeeDocuments/payslip-a')!.documentTypeCode = 'MEDICAL_CERTIFICATE';
  await assert.rejects(previewClosureRelease(f.context, { ...f.selection, includePayslip: true }, f.deps));
  f.hr.rows.get('employeeDocuments/payslip-a')!.documentTypeCode = 'PAYSLIP';
  const invalid = Buffer.from('arquivo sem cabeçalho PDF');
  const badHash = createHash('sha256').update(invalid).digest('hex');
  f.hr.rows.get('employeeDocuments/payslip-a')!.contentHash = badHash;
  const pack = f.hr.rows.get(f.frozen + '/packages/' + uid)!;
  pack.payslip = { documentId: 'payslip-a', sha256: badHash };
  f.deps.readStorage = async () => invalid;
  await assert.rejects(previewClosureRelease(f.context, { ...f.selection, includePayslip: true }, f.deps));
  f.hr.rows.delete(f.frozen + '/mirrors/' + uid);
  await assert.rejects(previewClosureRelease(f.context, f.selection, f.deps));
});

test('history and overlays must match the same employer for each day with accounting activity', async () => {
  const f = fixture();
  const history = f.main.rows.get('dp_employmentReferenceHistories/' + f.historyId)!;
  const periods = history.periods as Array<Record<string, unknown>>;
  periods[0].validTo = '2026-02-01';
  periods.push({ ...periods[0], validFrom: '2026-02-02', validTo: undefined, employerUnitId: 'employer-b',
    employer: { unitId: 'employer-b', unitName: 'Empresa B', cnpj, address: 'Rua B', identityStatus: 'catalog_identifiers_consistent_unverified' } });
  await assert.rejects(previewClosureRelease(f.context, f.selection, f.deps));
});

test('a newly approved release replaces the pointer without overwriting the old immutable delivery', async () => {
  const f = fixture(); const first = await f.release();
  f.hr.rows.set(f.closurePath + '/timeBankMovements/new-credit', { id: 'new-credit', uid, date: '2026-02-01', competence, status: 'active', kind: 'adjustment',
    minutes: 10, reason: 'Motivo privado', createdAt: '2026-03-04T12:00:00Z', createdBy: 'rh', line: { nature: 'bank_credit', minutes: 10, reason: 'manual_adjustment' } });
  const second = await f.release();
  assert.notEqual(first.releaseId, second.releaseId);
  assert.equal([...f.hr.rows.keys()].filter((key) => key.startsWith('providerClosureReleases/')).length, 2);
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, first.releaseId, f.deps));
  assert.equal((await readReleasedClosure(f.principal, f.grantId, second.releaseId, f.deps)).payroll.creditMinutes, 10);
  assert.equal(sha256(f.hr.rows.get('providerClosureReleases/' + first.releaseId)!.content), sha256(first.content));
});


test('missing months before employment and missing cycle history without expiration do not block monthly release', async () => {
  const f = fixture();
  f.setMissing(['2025-12'], 30);
  assert.equal((await previewClosureRelease(f.context, f.selection, f.deps)).content.employee.uid, uid);
  f.setMissing(['2026-01'], null);
  assert.equal((await previewClosureRelease(f.context, f.selection, f.deps)).content.employee.uid, uid);
  f.setMissing(['2026-01'], 30);
  await assert.rejects(previewClosureRelease(f.context, f.selection, f.deps));
});

function transferOnThirdDay(f: ReturnType<typeof fixture>) {
  const history = f.main.rows.get('dp_employmentReferenceHistories/' + f.historyId)!;
  const periods = history.periods as Array<Record<string, unknown>>;
  periods[0].validTo = '2026-02-02';
  periods.push({ ...periods[0], validFrom: '2026-02-03', validTo: undefined, employerUnitId: 'employer-b',
    unitId: 'employer-b', unitIds: ['employer-b'],
    employer: { unitId: 'employer-b', unitName: 'Empresa B', cnpj: '11222333000181', address: 'Rua B', identityStatus: 'catalog_identifiers_consistent_unverified' } });
}

test('a monthly payslip checks employment on zero-activity days and financial lines extend the summary proof', async () => {
  const f = fixture(); attachPayslip(f); transferOnThirdDay(f);
  const summary = await previewClosureRelease(f.context, f.selection, f.deps);
  assert.equal(summary.content.employee.uid, uid);
  const released = await releaseClosureToProvider(f.context, { ...f.selection, requestId: randomUUID(), expectedSourceHash: summary.sourceHash, expectedEmploymentProofHash: summary.employmentProofHash }, f.deps);
  await assert.rejects(previewClosureRelease(f.context, { ...f.selection, includePayslip: true }, f.deps));
  await assert.rejects(releaseClosureToProvider(f.context, { ...f.selection, includePayslip: true, requestId: randomUUID(), expectedSourceHash: summary.sourceHash, expectedEmploymentProofHash: summary.employmentProofHash }, f.deps));
  f.addLines([{ competence, date: '2026-02-03', closureVersion: 0, line: { nature: 'bank_credit', minutes: 10, reason: 'manual_adjustment' } }]);
  await assert.rejects(previewClosureRelease(f.context, f.selection, f.deps));
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
});

test('candidate listing filters employees by granted employer and all actor-visible monthly units', async () => {
  const f = fixture();
  const another = 'employee-b';
  f.main.rows.set('users/' + uid, { username: 'Ana', hrEmployeeId: 'hr-a', unitIds: ['employer-a'] });
  f.main.rows.set('users/' + another, { username: 'Bruna Reservada B', hrEmployeeId: 'hr-b', unitIds: ['employer-b'] });
  const history = structuredClone(f.main.rows.get('dp_employmentReferenceHistories/' + f.historyId)!);
  const head = createHash('sha256').update(JSON.stringify(['coala', another])).digest('hex');
  const historyId = head + '_r1';
  history.userId = another; history.historyId = historyId;
  const period = (history.periods as Array<Record<string, unknown>>)[0];
  period.employerUnitId = 'employer-b'; period.unitId = 'employer-b'; period.unitIds = ['employer-b'];
  period.employer = { unitId: 'employer-b', unitName: 'Empresa B', cnpj: '11222333000181', address: 'Rua B', identityStatus: 'catalog_identifiers_consistent_unverified' };
  f.main.rows.set('dp_employmentReferenceHeads/' + head, { revision: 1, historyId });
  f.main.rows.set('dp_employmentReferenceHistories/' + historyId, history);
  f.hr.rows.set(f.frozen + '/people/' + another, { uid: another, name: 'Bruna Reservada B', adjustments: [], absences: [], shiftSwaps: [] });
  f.hr.rows.get(f.closurePath)!.peopleCount = 2;
  const scoped = { ...f.context, isDefaultAdmin: false, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['employer-a'] } } as ServerUserContext;
  const list = await listClosureReleaseCandidates(scoped, f.grantId, f.deps);
  assert.deepEqual(list.people.map((person) => person.uid), [uid]);
  assert.equal(JSON.stringify(list).includes('Bruna Reservada B'), false);
  assert.deepEqual((await listClosureReleaseCandidates(f.context, f.grantId, f.deps)).people.map((person) => person.uid), [uid]);
  transferOnThirdDay(f);
  assert.deepEqual((await listClosureReleaseCandidates(scoped, f.grantId, f.deps)).people, []);
  const mixed = (await listClosureReleaseCandidates(f.context, f.grantId, f.deps)).people;
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].hasOtherEmployer, true);
});

test('changing the reciprocal RH identifier invalidates a previously approved release', async () => {
  const f = fixture(); attachPayslip(f);
  const selected = { ...f.selection, includePayslip: true };
  const preview = await previewClosureRelease(f.context, selected, f.deps);
  const released = await releaseClosureToProvider(f.context, { ...selected, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash }, f.deps);
  f.main.rows.get('users/' + uid)!.hrEmployeeId = 'hr-b';
  assert.equal((await listReleasedClosures(f.principal, f.grantId, f.deps))[0].status, 'employment_changed');
  await assert.rejects(readReleasedClosure(f.principal, f.grantId, released.releaseId, f.deps));
  await assert.rejects(readReleasedPayslip(f.principal, f.grantId, released.releaseId, f.deps));
});


test('direct preview and release enforce the same complete unit scope as the candidate list', async () => {
  const f = fixture();
  f.main.rows.get('users/' + uid)!.unitIds = ['employer-a', 'work-b'];
  const history = f.main.rows.get('dp_employmentReferenceHistories/' + f.historyId)!;
  const periods = history.periods as Array<{ unitId: string; unitIds: string[] }>;
  periods[0].unitId = 'work-b';
  periods[0].unitIds = ['employer-a', 'work-b'];
  const preview = await previewClosureRelease(f.context, f.selection, f.deps);
  const input = { ...f.selection, requestId: randomUUID(), expectedSourceHash: preview.sourceHash, expectedEmploymentProofHash: preview.employmentProofHash };
  await releaseClosureToProvider(f.context, input, f.deps);
  const limited = { ...f.context, isDefaultAdmin: false, userDoc: { unitAccessScope: 'selected', unitAccessUnitIds: ['employer-a'] } } as ServerUserContext;
  assert.deepEqual((await listClosureReleaseCandidates(limited, f.grantId, f.deps)).people, []);
  await assert.rejects(previewClosureRelease(limited, f.selection, f.deps), { kind: 'AUTHORIZATION' });
  await assert.rejects(releaseClosureToProvider(limited, input, f.deps), { kind: 'AUTHORIZATION' });
});


test('transient data failures are reported instead of presented as an employment change', async () => {
  const f = fixture();
  await f.release();
  const failure = new Error('Emulated database unavailable');
  f.main.getAll = async () => { throw failure; };
  await assert.rejects(listReleasedClosures(f.principal, f.grantId, f.deps), (cause) => cause === failure);
});


test('unrelated legacy calculations from the previous month do not block a monthly delivery', async () => {
  const f = fixture();
  const previous = 'ptrp_competenceClosures/coala_2026-01';
  f.hr.rows.set(previous, { workspaceId: 'coala', competence: '2026-01', status: 'closed', version: 1 });
  f.hr.rows.set(previous + '/versions/1/timeBank/' + uid, { ...f.month, competence: '2026-01', algorithmVersion: 'legacy-bank' });
  const preview = await previewClosureRelease(f.context, f.selection, f.deps);
  assert.equal(preview.content.payroll.payrollOvertimeMinutes, 60);
});
