import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { createOwnAdjustment, decideAdjustment, CLOSURES } = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { closeCompetence, readCompetenceClosure, reopenCompetence } = await import('../../src/features/dp/time-adjustments/closure.server.ts');
const { agreeWithMirror, generateMirror, mirrorPdf, readMirrorStatus } = await import('../../src/features/dp/time-adjustments/mirror.server.ts');
const { exportAej } = await import('../../src/features/dp/time-adjustments/aej.server.ts');
const { TREATMENTS, AEJ_EXPORTS } = await import('../../src/features/dp/time-adjustments/service.server.ts');
const { generateBankMonth, readBankStatement, settleBankCycle } = await import('../../src/features/dp/time-bank/service.server.ts');

test('fechamento da competência: pendência bloqueia, declaração congela, mês fechado recusa pedido, reabertura gera nova versão', async () => {
  const prefix = `closure-${randomUUID().slice(0, 6)}`;
  const workspaceId = `${prefix}-ws`;
  const userId = `${prefix}-employee`;
  const unitId = `${prefix}-unit`;
  const competence = '2026-08';
  const clock = { async read() { return { instant: new Date('2026-10-17T12:00:00.000Z') }; } };
  const deps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
  const closureDeps = { hrDb: hrDbAdmin, clock };
  const actor = (uid, permissions, extra = {}) => ({ decoded: { uid }, userDoc: { id: uid, unitIds: [unitId], ...extra }, profileId: null,
    permissions, isDefaultAdmin: false, workspace_id: workspaceId });
  const admin = { ...actor(`${prefix}-admin`, structuredClone(defaultAdminPermissions)), isDefaultAdmin: true };
  const titular = actor(userId, structuredClone(defaultGuestPermissions), { username: 'Maria' });
  const reviewerPermissions = structuredClone(defaultGuestPermissions);
  reviewerPermissions.dp.requests.review = true;
  const reviewer = actor(`${prefix}-reviewer`, reviewerPermissions);
  const closerPermissions = structuredClone(defaultGuestPermissions);
  closerPermissions.dp.timeClosure = { close: true, reopen: false };
  const closer = actor(`${prefix}-closer`, closerPermissions);
  const absenceRef = hrDbAdmin.collection('dp_absenceRequests').doc(`${prefix}-absence`);

  try {
    await Promise.all([
      dbAdmin.collection('dp_units').doc(unitId).set({ name: 'Quiosque', address: 'Rua fiscal, 1', cnpj: '14276603000125', timeZone: 'America/Fortaleza' }),
      dbAdmin.collection('users').doc(userId).set({ isActive: true, unitId, unitIds: [unitId] }),
    ]);
    await publishEmploymentReference(admin, { userId, expectedRevision: 0, requestId: `${prefix}-ref`, periods: [{
      validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId: unitId, unitId, unitIds: [unitId],
      jobFunctionIds: [], sourceDocumentId: 'admission', sourceReason: 'Admissão conferida para o ensaio' }] });

    // Sem permissão não lê nem fecha; quem só fecha não reabre.
    await assert.rejects(readCompetenceClosure(reviewer, competence, closureDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    await assert.rejects(closeCompetence(closer, { competence: '2026-10', expectedVersion: 0 }, closureDeps), { code: 'PTRP_CLOSURE_TOO_EARLY' });

    const pending = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-12', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps);
    await absenceRef.set({ id: absenceRef.id, workspaceId, beneficiaryUid: userId, beneficiaryName: 'Maria', status: 'in_review', startDate: '2026-07-30', endDate: '2026-08-02',
      input: { startDate: '2026-07-30', endDate: '2026-08-02', unit: 'day' }, quantity: 4, unit: 'day', typeId: 'medical', typeSnapshot: { name: 'Atestado médico' },
      attachments: [{ id: 'a' }], history: [], reason: 'dado de saúde que não entra na declaração' });

    const before = await readCompetenceClosure(closer, competence, closureDeps);
    assert.deepEqual(before.pending, { adjustments: 1, absences: 1 });
    assert.equal(before.people.length, 1);
    assert.equal(JSON.stringify(before.people).includes('dado de saúde'), false);
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 0 }, closureDeps), { code: 'PTRP_CLOSURE_PENDING' });

    await decideAdjustment(reviewer, pending.id, { action: 'approve', expectedVersion: 1, reason: 'Conferido com a gerente da unidade.' }, deps);
    await absenceRef.update({ status: 'approved', approvalOrigin: 'tacit_timeout', decidedAt: '2026-08-05T12:00:00.000Z' });
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 3 }, closureDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    const first = await closeCompetence(closer, { competence, expectedVersion: 0 }, closureDeps);
    assert.equal(first.status, 'closed');
    assert.equal(first.version, 1);
    assert.deepEqual(first.counts, { adjustments: 1, absences: 1 });
    assert.equal(first.closedBy, closer.decoded.uid);
    assert.equal(first.clockSource, 'hora_legal');
    assert.match(first.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(first.changes, null);

    const frozen = await readCompetenceClosure(closer, competence, closureDeps);
    assert.equal(frozen.people[0].adjustments[0].decidedBy, reviewer.decoded.uid);
    assert.equal(frozen.people[0].absences[0].approval, 'tacit_timeout');
    await assert.rejects(closeCompetence(closer, { competence, expectedVersion: 1 }, closureDeps), { code: 'PTRP_CLOSURE_ALREADY_CLOSED' });
    await assert.rejects(createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-20', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps), { code: 'PTRP_COMPETENCE_CLOSED' });

    await assert.rejects(reopenCompetence(closer, competence, { action: 'reopen', expectedVersion: 1, reason: 'Atestado entregue depois.' }, closureDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    const reopened = await reopenCompetence(admin, competence, { action: 'reopen', expectedVersion: 1, reason: 'Atestado entregue depois do fechamento.' }, closureDeps);
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.reopenings[0].fromVersion, 1);

    const late = await createOwnAdjustment(titular, { attemptId: randomUUID(), workDate: '2026-08-20', kind: 'include', newTime: '08:00',
      reason: 'Esqueci de bater a entrada.' }, deps);
    await decideAdjustment(reviewer, late.id, { action: 'reject', expectedVersion: 1, reason: 'Sem registro da presença neste dia.' }, deps);
    const second = await closeCompetence(closer, { competence, expectedVersion: 1 }, closureDeps);
    assert.equal(second.version, 2);
    assert.deepEqual(second.changes, { added: [`adjustment:${late.id}`], changed: [], removed: [] });
    // A versão anterior continua guardada.
    const versions = await hrDbAdmin.collection(CLOSURES).doc(`${workspaceId}_${competence}`).collection('versions').get();
    assert.deepEqual(versions.docs.map((doc) => doc.id).sort(), ['1', '2']);

    // Espelho da versão 2: gerado uma vez, concordância uma vez e sobre o instantâneo aberto.
    await hrDbAdmin.collection('repP_receipts').doc(`${prefix}-r1`).set({ workspaceId, employeeId: userId, recordedDate: '2026-08-12', status: 'issued',
      snapshot: { nsr: 41, markedAt: '2026-08-12T12:00:00-0300', executionUnitId: unitId, collectorId: '01', employeeName: 'Maria Fiscal', employeeCpf: '52998224725',
        employerLegalName: 'Empregador do ensaio LTDA', employerCnpj: '14276603000125' } });
    const mirrorDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, clock };
    assert.equal((await readMirrorStatus(titular, competence, undefined, mirrorDeps)).mirror, null);
    await assert.rejects(generateMirror(titular, { action: 'generate', competence, expectedVersion: 1 }, mirrorDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    await assert.rejects(generateMirror(reviewer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, mirrorDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    const mirror = await generateMirror(titular, { action: 'generate', competence, expectedVersion: 2 }, mirrorDeps);
    assert.equal(mirror.snapshot.employee.name, 'Maria Fiscal');
    assert.equal(mirror.snapshot.employer.cnpj, '14276603000125');
    const day = mirror.snapshot.days.find((item) => item.date === '2026-08-12');
    assert.deepEqual(day.punches.map((item) => `${item.time}:${item.mark}`), ['08:00:included', '12:00:original']);
    assert.equal(day.pairedMinutes, 240);
    assert.equal(mirror.snapshot.adjustments.length, 2);
    assert.equal(mirror.snapshot.actors[reviewer.decoded.uid], undefined);
    assert.equal((await generateMirror(closer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, mirrorDeps)).snapshotHash, mirror.snapshotHash);
    await assert.rejects(agreeWithMirror(closer, { action: 'agree', competence, expectedVersion: 2, employeeUid: userId, snapshotHash: mirror.snapshotHash }, 'web', mirrorDeps), { code: 'PTRP_MIRROR_AGREEMENT_OWNER' });
    await assert.rejects(agreeWithMirror(titular, { action: 'agree', competence, expectedVersion: 2, snapshotHash: 'f'.repeat(64) }, 'web', mirrorDeps), { code: 'PTRP_MIRROR_HASH_MISMATCH' });
    const agreed = await agreeWithMirror(titular, { action: 'agree', competence, expectedVersion: 2, snapshotHash: mirror.snapshotHash }, 'mobile', mirrorDeps);
    assert.equal(agreed.agreement.channel, 'mobile');
    assert.equal((await agreeWithMirror(titular, { action: 'agree', competence, expectedVersion: 2, snapshotHash: mirror.snapshotHash }, 'web', mirrorDeps)).agreement.at, agreed.agreement.at);
    const status = await readMirrorStatus(closer, competence, userId, mirrorDeps);
    assert.equal(status.mirror.agreement.uid, userId);
    const pdf = await mirrorPdf(titular, competence, undefined, mirrorDeps);
    assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
    assert.equal(pdf.filename, 'espelho-ponto-2026-08-v2.pdf');
    await assert.rejects(mirrorPdf(reviewer, competence, userId, mirrorDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });

    // Banco de horas do mês fechado: jornada de 7h20, turno de 4h com batida incluída, dia escalado sem batida e folga.
    const journeyId = `${prefix}-journey`;
    const scheduleRef = dbAdmin.collection('dp_schedules').doc(`${prefix}-schedule`);
    await Promise.all([
      dbAdmin.collection('dp_journeys').doc(journeyId).set({ lineageId: journeyId, version: 1, status: 'published', validFrom: '2026-08-10', cycleLengthDays: 7,
        days: [1, 2, 3, 4, 5, 6, 7].map((dayIndex) => ({ dayIndex, plannedMinutes: dayIndex === 7 ? 0 : 440, isRestDay: dayIndex === 7 })), toleranceMinutes: 5 }),
      dbAdmin.collection('dp_overtimePolicies').doc(`${prefix}-policy`).set({ lineageId: `${prefix}-policy`, version: 1, status: 'published', name: 'Banco do ensaio',
        applicability: { scope: { kind: 'company' }, collaboratorIds: [userId] }, validFrom: '2026-01-01', externalCoverageRule: 'origin',
        categories: [{ id: 'banco', name: 'Banco', trigger: 'workday', ratePercent: 50, destination: 'time_bank', bankCreditFactor: 1, requiresApproval: false }],
        timeBank: { enabled: true, allowNegativeBalance: true, expiredBalanceDestination: 'review', cycle: { unit: 'month', length: 1, anchorDate: '2026-01-01', residualDestination: 'review' } } }),
      scheduleRef.set({ year: 2026, month: 8, unitId, locked: true, createdAt: new Date('2026-07-20T00:00:00Z') }),
    ]);
    const plannedShift = (id, data) => scheduleRef.collection('shifts').doc(id).set({ scheduleId: scheduleRef.id, unitId, userId, type: 'work', startTime: '08:00', endTime: '12:00',
      journeyResolution: { journeyId, lineageId: journeyId, version: 1 }, ...data });
    await Promise.all([plannedShift('a', { date: '2026-08-12' }), plannedShift('b', { date: '2026-08-13' }), plannedShift('c', { date: '2026-08-16', type: 'day_off', startTime: '00:00', endTime: '00:00' })]);
    const bankDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: hrDbAdmin, now: () => new Date('2026-10-17T12:00:00.000Z') };
    await assert.rejects(generateBankMonth(titular, { action: 'generate', competence, expectedVersion: 1 }, bankDeps), { code: 'PTRP_CLOSURE_VERSION_CONFLICT' });
    await assert.rejects(readBankStatement(reviewer, { employeeUid: userId }, bankDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    const pendingStatement = await readBankStatement(titular, { date: '2026-08-20' }, bankDeps);
    assert.deepEqual([pendingStatement.statement.missing, pendingStatement.closures], [['2026-08'], { '2026-08': 2 }]);
    const bankMonth = await generateBankMonth(titular, { action: 'generate', competence, expectedVersion: 2 }, bankDeps);
    assert.deepEqual(bankMonth.days.filter((item) => item.lines.length).map((item) => [item.date, item.lines.map((line) => `${line.nature}:${line.minutes}:${line.reason}`)]),
      [['2026-08-12', ['bank_debit:200:worked_less']], ['2026-08-13', ['bank_debit:440:missing_day']]]);
    assert.equal(bankMonth.totals.balance, -640);
    assert.deepEqual(bankMonth.policies, [{ id: `${prefix}-policy`, version: 1 }]);
    assert.equal((await generateBankMonth(closer, { action: 'generate', competence, expectedVersion: 2, employeeUid: userId }, bankDeps)).generatedAt, bankMonth.generatedAt);
    const statement = (await readBankStatement(closer, { employeeUid: userId, date: '2026-08-20' }, bankDeps)).statement;
    assert.deepEqual([statement.balanceMinutes, statement.debit, statement.missing, statement.ended], [-640, 640, [], true]);
    assert.deepEqual(statement.residual, { minutes: -640, destination: 'review' });
    assert.equal(statement.settlement, null);
    // Encerramento do ciclo: só quem fecha, com o residual conferido; uma vez, sem apagar nada.
    await assert.rejects(settleBankCycle(titular, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -640 }, bankDeps), { code: 'PTRP_CLOSURE_FORBIDDEN' });
    await assert.rejects(settleBankCycle(closer, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -600 }, bankDeps), { code: 'PTRP_BANK_RESIDUAL_CHANGED' });
    const settled = await settleBankCycle(closer, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -640 }, bankDeps);
    assert.deepEqual([settled.minutes, settled.destination, settled.settledBy, settled.closureVersions], [-640, 'review', closer.decoded.uid, { '2026-08': 2 }]);
    assert.equal((await settleBankCycle(closer, { action: 'settle', employeeUid: userId, date: '2026-08-31', expectedMinutes: -640 }, bankDeps)).settledAt, settled.settledAt);
    assert.equal((await readBankStatement(titular, { date: '2026-08-20' }, bankDeps)).statement.settlement.minutes, -640);

    // AEJ do estabelecimento: só de competência fechada, com a inclusão aprovada e o motivo do AEJ.
    const treatment = (await hrDbAdmin.collection(TREATMENTS).where('workspaceId', '==', workspaceId).where('employeeUid', '==', userId).limit(1).get()).docs[0].data();
    const readArp = async () => ({ profile: { establishmentId: treatment.establishmentId, employerCnpj: '14276603000125', employerLegalName: 'Empregador do ensaio LTDA',
      inpiRegistration: '512026000001', developerCnpj: '14276603000125' }, timeZone: 'America/Fortaleza', generatedAt: '2026-10-17T09:00:00-0300',
      markings: [{ receiptId: `${prefix}-r1`, nsr: 41, markedAt: '2026-08-12T12:00:00-0300', employeeCpf: '52998224725', workDate: '2026-08-12' }],
      people: [{ cpf: '52998224725', uid: userId, name: 'Maria Fiscal' }] });
    const sign = async () => ({ bytes: Buffer.from('p7s'), format: 'CAdES', detached: true, certificateCnpj: '14276603000125' });
    const readIdentity = async () => ({ cpf: '52998224725', name: 'Maria Fiscal' });
    const aejDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, developerEmail: 'dev@exemplo.com', readArp, readIdentity, sign };
    const input = { establishmentId: treatment.establishmentId, startDate: '2026-08-01', endDate: '2026-08-31' };
    await assert.rejects(exportAej(admin, { ...input, endDate: '2026-09-30' }, aejDeps), { code: 'PTRP_AEJ_COMPETENCE_OPEN' });
    await assert.rejects(exportAej(admin, input, { ...aejDeps, developerEmail: undefined }), { code: 'PTRP_AEJ_DEVELOPER_EMAIL_MISSING' });
    // Batida na ARP sem comprovante catalogado: o AEJ não pode divergir do AFD.
    const orphan = async () => ({ ...(await readArp()), people: [] });
    await assert.rejects(exportAej(admin, input, { ...aejDeps, readArp: orphan }), { code: 'PTRP_AEJ_MARKING_WITHOUT_CATALOG' });
    // Quem só tem inclusão (esqueceu o dia todo) entra pelo cadastro do RH.
    const onlyInclusion = async () => ({ ...(await readArp()), markings: [], people: [] });
    const inclusionOnly = await exportAej(admin, input, { ...aejDeps, readArp: onlyInclusion });
    assert.match(Buffer.from(inclusionOnly.aejBase64, 'base64').toString('latin1'), /03\|1\|52998224725\|Maria Fiscal/);
    await assert.rejects(exportAej(admin, input, { ...aejDeps, readArp: onlyInclusion, readIdentity: async () => { throw new Error('x'); } }), { code: 'PTRP_AEJ_IDENTITY_UNRESOLVED' });
    const aej = await exportAej(admin, input, aejDeps);
    const lines = Buffer.from(aej.aejBase64, 'base64').toString('latin1').split('\r\n');
    assert.deepEqual(lines.filter((line) => line.startsWith('05|')), [
      '05|1|2026-08-12T08:00:00-0300||E|001|I|HC001|Esqueci de bater a entrada.',
      '05|1|2026-08-12T12:00:00-0300|1|S|001|O||',
    ]);
    assert.equal(aej.counts['05'], 2);
    assert.deepEqual(aej.warnings, []);
    // Registro 07: débitos do banco por dia, falta não justificada como "2" e folga sem trabalho como DSR.
    assert.deepEqual(lines.filter((line) => line.startsWith('07|')), ['07|1|3|2026-08-12|200|2', '07|1|2|2026-08-13||', '07|1|3|2026-08-13|440|2', '07|1|1|2026-08-16||']);
    const audit = (await hrDbAdmin.collection(AEJ_EXPORTS).where('workspaceId', '==', workspaceId).where('sha256', '==', aej.sha256).get()).docs[0].data();
    assert.equal(audit.sha256, aej.sha256);
    assert.deepEqual(audit.closureVersions, { '2026-08': 2 });
  } finally {
    await absenceRef.delete();
  }
});
