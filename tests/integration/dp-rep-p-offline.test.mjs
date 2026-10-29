import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { offlineCycleRefs } = await import('../../src/features/dp/rep-p/offline-cycle.server.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { canonicalRepPOfflineEvent, canonicalRepPCycleAction, deriveRepPOfflineMarkedAt, hashRepPOfflineEvent, repPDeviceKeyId }
  = await import('../../src/features/dp/rep-p/offline.ts');
const { issueOwnRepPOfflinePermit, provisionRepPReferenceData, recordOwnRepPMarking, repPIdentifiersForTest, applyOwnRepPOfflineCycleAction }
  = await import('../../src/features/dp/rep-p/service.server.ts');
const { closeCompetence, reopenCompetence } = await import('../../src/features/dp/time-adjustments/closure.server.ts');

test('Coala Go preserva offline, servidor valida a corrente e só então atribui NSR modo 1', async (t) => {
  const prefix = 'rep-p-offline-integration';
  const workspaceId = 'coala-one'; const userId = `${prefix}-employee`;
  const employerUnitId = `${prefix}-employer`; const executionUnitId = `${prefix}-execution`;
  const cpf = '52998224725'; const employerCnpj = '14276603000125';
  const establishmentId = repPIdentifiersForTest.establishmentKey(workspaceId, employerCnpj);
  const context = { decoded: { uid: userId }, userDoc: { id: userId }, profileId: null,
    permissions: structuredClone(defaultAdminPermissions), isDefaultAdmin: true, workspace_id: workspaceId };
  const employer = dbAdmin.collection('dp_units').doc(employerUnitId);
  const execution = dbAdmin.collection('dp_units').doc(executionUnitId);
  const user = dbAdmin.collection('users').doc(userId);
  const employee = hrDbAdmin.collection('employees').doc(`${prefix}-hr`);
  const cpfField = employee.collection('field_values').doc('employee.cpf');
  let clockInstant = '2026-10-18T10:00:00.000Z';
  const clock = { async read() { return { instant: new Date(clockInstant), source: 'synthetic-hlb-test', assurance: 'hlb_verified',
    observedOffsetMs: 5, verifiedAt: new Date(), attestationId: 'c'.repeat(64), attestationMode: 'fresh', quorum: 2,
    observations: [{ server: 'a', status: 'accepted', offsetMs: 4, roundTripMs: 10, stratum: 1 },
      { server: 'b', status: 'accepted', offsetMs: 6, roundTripMs: 12, stratum: 1 }] }; } };
  const dependencies = { repDb: repPDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock, markingEnabled: true,
    officialUserIds: new Set([userId, `${prefix}-other`]),
    signer: { async signDetached() { throw new Error('unused'); } },
    receiptSigner: { async signPdf() { throw new Error('receipt pending'); } } };
  const profile = { establishmentId, employerCnpj, employerLegalName: 'CT Sorvetes LTDA',
    inpiRegistration: '12345678901234567', developerCnpj: employerCnpj };
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const devicePublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const deviceKeyId = repPDeviceKeyId(devicePublicKey);
  const closureRef = repPDbAdmin.collection('repP_competenceFences').doc(`${workspaceId}_2026-10`);
  const ptrpClosureRef = hrDbAdmin.collection('ptrp_competenceClosures').doc(`${workspaceId}_2026-10`);
  let permitId = '';
  try {
    await Promise.all([
      employer.set({ name: 'Empregadora', address: 'Rua fiscal, 1', cnpj: employerCnpj, timeZone: 'America/Belem' }),
      execution.set({ name: 'Execução', address: 'Rua operacional, 2', timeZone: 'America/Manaus' }),
      user.set({ isActive: true, unitId: employerUnitId, unitIds: [employerUnitId, executionUnitId],
        operationalUnitPeriods: [{ validFrom: '2026-01-01', unitIds: [employerUnitId, executionUnitId] }] }),
      employee.set({ auth_uid: userId, name: 'Maria Offline' }), cpfField.set({ value_text: cpf }),
    ]);
    await publishEmploymentReference(context, { userId, expectedRevision: 0, requestId: 'offline-employment', periods: [{
      validFrom: '2026-01-01', employmentRelationshipType: 'clt', employerUnitId, unitId: employerUnitId,
      unitIds: [employerUnitId, executionUnitId], jobFunctionIds: [], sourceDocumentId: 'admission-offline', sourceReason: 'Ensaio offline',
    }] });
    await provisionRepPReferenceData({ workspaceId, responsibleCpf: cpf, timeZone: 'America/Belem', profile,
      employee: { userId, cpf, name: 'Maria Offline' }, workLocation: 'Rua fiscal, 1' }, dependencies);
    clockInstant = '2026-10-18T11:00:00.000Z';
    const permit = await issueOwnRepPOfflinePermit(context, { permitRequestId: 'permit-request-1', workDate: '2026-10-18',
      installationId: '11111111-1111-4111-8111-111111111111', deviceKeyId, devicePublicKey,
      keySecurity: 'tee', bootCount: 7, anchorElapsedRealtimeMs: 1_000 }, dependencies);
    permitId = permit.permitId;
    const frozenOperationalReference = (await repPDbAdmin.collection('repP_offlinePermits').doc(permitId).get()).get('operationalUnitReference');
    assert.match(frozenOperationalReference.hash, /^[a-f0-9]{64}$/);
    await user.update({ operationalUnitPeriods: [
      { validFrom: '2026-01-01', validTo: '2026-10-17', unitIds: [employerUnitId, executionUnitId] },
      { validFrom: '2026-10-18', unitIds: [employerUnitId] },
    ] });
    const event = { permitId, attemptId: 'offline-attempt-1', executionUnitId, deviceKeyId,
      elapsedRealtimeMs: 1_801_000, bootCount: 7, sequence: 1, previousLocalHash: null,
      markedAt: deriveRepPOfflineMarkedAt({ anchorInstant: permit.anchorInstant, anchorElapsedRealtimeMs: permit.anchorElapsedRealtimeMs,
        elapsedRealtimeMs: 1_801_000, timeZone: 'America/Manaus' }) };
    const canonical = canonicalRepPOfflineEvent(event); const localHash = hashRepPOfflineEvent(canonical);
    const signature = sign('sha256', Buffer.from(canonical), privateKey).toString('base64');
    const request = { attemptId: event.attemptId, workDate: '2026-10-18', executionUnitId, channel: 'mobile',
      offline: { permitId, deviceKeyId, elapsedRealtimeMs: event.elapsedRealtimeMs, bootCount: 7, sequence: 1,
        previousLocalHash: null, markedAt: event.markedAt, localHash, signature } };
    clockInstant = '2026-10-18T12:00:00.000Z';
    const recorded = await recordOwnRepPMarking(context, request, dependencies);
    assert.equal(recorded.status, 'recorded'); assert.equal(recorded.marking.mode, '1');
    assert.equal(recorded.marking.markedAt, '2026-10-18T07:30:00-0400');
    assert.equal(recorded.marking.recordedAt, '2026-10-18T08:00:00-0400');
    const firstEvent = await repPDbAdmin.collection('repP_events').doc(`${establishmentId}_${String(recorded.marking.nsr).padStart(9, '0')}`).get();
    assert.deepEqual(firstEvent.get('operationalUnitReference'), frozenOperationalReference);
    await user.update({ operationalUnitPeriods: [{ validFrom: '2026-01-01', unitIds: [employerUnitId, executionUnitId] }] });
    assert.equal((await recordOwnRepPMarking(context, request, dependencies)).status, 'replayed');
    await t.test('permit legado sem metadado preserva unidade congelada após mudança operacional', async () => {
      const legacy = await issueOwnRepPOfflinePermit(context, { permitRequestId: 'legacy-permit-regression', workDate: '2026-10-18',
        installationId: '22222222-2222-4222-8222-222222222222', deviceKeyId, devicePublicKey,
        keySecurity: 'tee', bootCount: 7, anchorElapsedRealtimeMs: 1_000 }, dependencies);
      const { FieldValue } = await import('firebase-admin/firestore');
      await repPDbAdmin.collection('repP_offlinePermits').doc(legacy.permitId).update({ operationalUnitReference: FieldValue.delete() });
      await user.update({ operationalUnitPeriods: [
        { validFrom: '2026-01-01', validTo: '2026-10-17', unitIds: [employerUnitId, executionUnitId] },
        { validFrom: '2026-10-18', unitIds: [employerUnitId] },
      ] });
      const core = { ...event, permitId: legacy.permitId, attemptId: 'legacy-permit-attempt', elapsedRealtimeMs: 61_000,
        markedAt: deriveRepPOfflineMarkedAt({ anchorInstant: legacy.anchorInstant, anchorElapsedRealtimeMs: legacy.anchorElapsedRealtimeMs,
          elapsedRealtimeMs: 61_000, timeZone: 'America/Manaus' }) };
      const serialized = canonicalRepPOfflineEvent(core);
      clockInstant = '2026-10-18T12:02:00.000Z';
      const result = await recordOwnRepPMarking(context, { ...request, attemptId: core.attemptId, offline: {
        ...request.offline, permitId: legacy.permitId, elapsedRealtimeMs: core.elapsedRealtimeMs, markedAt: core.markedAt,
        localHash: hashRepPOfflineEvent(serialized), signature: sign('sha256', Buffer.from(serialized), privateKey).toString('base64'),
      } }, dependencies);
      assert.equal(result.status, 'recorded');
      assert.equal(result.marking.executionUnitId, executionUnitId);
      await user.update({ operationalUnitPeriods: [{ validFrom: '2026-01-01', unitIds: [employerUnitId, executionUnitId] }] });
    });
    const nsrAfterFirst = (await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    await t.test('autorização de outra pessoa ou chave não registra nem avança a fila', async () => {
      const before = (await repPDbAdmin.collection('repP_offlinePermits').doc(permitId).get()).data();
      const otherContext = { ...context, decoded: { uid: `${prefix}-other` }, userDoc: { id: `${prefix}-other` } };
      await assert.rejects(recordOwnRepPMarking(otherContext, request, dependencies), { code: 'REP_P_OFFLINE_PERMIT_INVALID' });
      const otherKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const otherPublicKey = otherKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
      const changedCore = { ...event, attemptId: 'offline-other-device', deviceKeyId: repPDeviceKeyId(otherPublicKey) };
      const changedCanonical = canonicalRepPOfflineEvent(changedCore);
      await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: changedCore.attemptId, offline: {
        ...request.offline, deviceKeyId: changedCore.deviceKeyId, localHash: hashRepPOfflineEvent(changedCanonical),
        signature: sign('sha256', Buffer.from(changedCanonical), otherKeys.privateKey).toString('base64'),
      } }, dependencies), { code: 'REP_P_OFFLINE_PERMIT_INVALID' });
      const forgedCore = { ...event, attemptId: 'offline-forged-key' };
      const forgedCanonical = canonicalRepPOfflineEvent(forgedCore);
      await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: forgedCore.attemptId, offline: {
        ...request.offline, localHash: hashRepPOfflineEvent(forgedCanonical),
        signature: sign('sha256', Buffer.from(forgedCanonical), otherKeys.privateKey).toString('base64'),
      } }, dependencies), { code: 'REP_P_OFFLINE_SIGNATURE_INVALID' });
      assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrAfterFirst);
      assert.deepEqual((await repPDbAdmin.collection('repP_offlinePermits').doc(permitId).get()).data(), before);
      assert.equal((await repPDbAdmin.collection('repP_attempts').where('employeeId', '==', `${prefix}-other`).get()).size, 0);
    });
    await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: 'offline-tampered', offline: {
      ...request.offline, sequence: 2, previousLocalHash: localHash,
    } }, dependencies), (cause) => cause?.code === 'REP_P_OFFLINE_SIGNATURE_INVALID');
    assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrAfterFirst);

    const secondEvent = { permitId, attemptId: 'offline-attempt-2', executionUnitId, deviceKeyId,
      elapsedRealtimeMs: 2_401_000, bootCount: 7, sequence: 2, previousLocalHash: localHash,
      markedAt: deriveRepPOfflineMarkedAt({ anchorInstant: permit.anchorInstant,
        anchorElapsedRealtimeMs: permit.anchorElapsedRealtimeMs, elapsedRealtimeMs: 2_401_000,
        timeZone: 'America/Manaus' }) };
    const secondCanonical = canonicalRepPOfflineEvent(secondEvent);
    const secondHash = hashRepPOfflineEvent(secondCanonical);
    const secondRequest = { attemptId: secondEvent.attemptId, workDate: '2026-10-18', executionUnitId, channel: 'mobile',
      offline: { permitId, deviceKeyId, elapsedRealtimeMs: secondEvent.elapsedRealtimeMs, bootCount: 7, sequence: 2,
        previousLocalHash: localHash, markedAt: secondEvent.markedAt, localHash: secondHash,
        signature: sign('sha256', Buffer.from(secondCanonical), privateKey).toString('base64') } };
    clockInstant = '2026-11-02T12:00:00.000Z';
    let releaseClosure;
    let confirmFence;
    const fenceAcquired = new Promise((resolve) => { confirmFence = resolve; });
    const continueClosure = new Promise((resolve) => { releaseClosure = resolve; });
    const closureDeps = { mainDb: dbAdmin, hrDb: hrDbAdmin, repDb: repPDbAdmin, clock, readRoster: async () => [],
      afterFenceAcquired: async () => { confirmFence(); await continueClosure; } };
    const closing = closeCompetence(context, { competence: '2026-10', expectedVersion: 0 }, closureDeps);
    await fenceAcquired;
    assert.equal((await closureRef.get()).get('status'), 'closing');
    await assert.rejects(recordOwnRepPMarking(context, secondRequest, dependencies),
      (cause) => cause?.code === 'REP_P_COMPETENCE_CLOSED');
    assert.equal((await repPDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrAfterFirst,
      'a marcação bloqueada pelo fechamento não consome NSR');
    releaseClosure();
    const closed = await closing;
    assert.equal(closed.status, 'closed');
    assert.equal((await closureRef.get()).get('status'), 'closed');
    assert.equal((await repPDbAdmin.collection('repP_offlinePermits').doc(permitId).get()).get('lastAcceptedSequence'), 1);
    await reopenCompetence(context, '2026-10', { action: 'reopen', expectedVersion: closed.version,
      reason: 'Ensaio de retomada da sincronização offline após reabertura.' }, closureDeps);
    assert.equal((await closureRef.get()).get('status'), 'open');
    assert.equal((await recordOwnRepPMarking(context, secondRequest, dependencies)).status, 'recorded');
    const storedPermit = await repPDbAdmin.collection('repP_offlinePermits').doc(permitId).get();
    assert.equal(storedPermit.get('lastAcceptedSequence'), 2); assert.equal(storedPermit.get('lastAcceptedHash'), secondHash);
    const eventDoc = (await repPDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId)
      .where('recordType', '==', '7').get()).docs[0];
    assert.equal(eventDoc.get('mode'), '1'); assert.equal(eventDoc.get('offlineEvidence.localHash'), localHash);

    for (const scope of ['official', 'pilot']) await t.test(`ciclo v2 ${scope}: primeiro offline, 24+24h, renovação e encerramento`, async () => {
      const scopeDeps = scope === 'official' ? dependencies : { ...dependencies, markingEnabled: false, pilotEnabled: true,
        pilotUserIds: new Set([userId]), officialStartDate: '2027-01-01' };
      const database = scope === 'official' ? repPDbAdmin : hrDbAdmin;
      const permits = scope === 'official' ? 'repP_offlinePermits' : 'repP_pilotOfflinePermits';
      const base = Date.parse(scope === 'official' ? '2026-11-03T08:00:00Z' : '2026-10-23T08:00:00Z');
      const hour = 3_600_000;
      const date = (instant) => new Date(instant - 4 * hour).toISOString().slice(0, 10);
      const issue = async (suffix, instant, protocolVersion = 2, device = { deviceKeyId, devicePublicKey }) => {
        clockInstant = new Date(instant).toISOString();
        return issueOwnRepPOfflinePermit(context, { ...(protocolVersion ? { protocolVersion } : {}), permitRequestId: `${scope}-${suffix}`,
          workDate: date(instant), installationId: '11111111-1111-4111-8111-111111111111', ...device,
          keySecurity: 'tee', bootCount: 7, anchorElapsedRealtimeMs: 1000 }, scopeDeps);
      };
      const make = (permit, attemptId, elapsed, cycle, sequence = 1, previousLocalHash = null, signingKey = privateKey) => {
        const core = { scope, permitId: permit.permitId, attemptId, executionUnitId, deviceKeyId: permit.deviceKeyId, elapsedRealtimeMs: elapsed,
          bootCount: 7, sequence, previousLocalHash, cycle,
          markedAt: deriveRepPOfflineMarkedAt({ ...permit, elapsedRealtimeMs: elapsed, timeZone: 'America/Manaus', maxElapsedMs: 72 * hour }) };
        const canonical = canonicalRepPOfflineEvent(core);
        return { attemptId, workDate: core.markedAt.slice(0, 10), executionUnitId, channel: 'mobile', declaredPurpose: 'journey_start',
          offline: { scope, permitId: permit.permitId, deviceKeyId: permit.deviceKeyId, elapsedRealtimeMs: elapsed, bootCount: 7,
            sequence, previousLocalHash, cycle, markedAt: core.markedAt, localHash: hashRepPOfflineEvent(canonical),
            signature: sign('sha256', Buffer.from(canonical), signingKey).toString('base64') } };
      };
      const action = (permit, cycle, receiptId, kind, elapsed, lastSequence) => {
        const core = { action: kind, scope, permitId: permit.permitId, cycleId: cycle.id,
          startedElapsedRealtimeMs: cycle.startedElapsedRealtimeMs, elapsedRealtimeMs: elapsed, bootCount: 7,
          deviceKeyId, receiptId, lastSequence };
        return { ...core, signature: sign('sha256', Buffer.from(canonicalRepPCycleAction(core)), privateKey).toString('base64') };
      };
      const legacyPermit = await issue('legacy-before-enrollment', base - hour, null);
      const legacyCapture = make(legacyPermit, `${scope}-legacy-before-v2`, 1000 + hour / 2, undefined);
      const permit = await issue('first-offline', base);
      clockInstant = new Date(base + 13 * hour).toISOString();
      assert.equal((await recordOwnRepPMarking(context, legacyCapture, scopeDeps)).status, 'recorded', 'fila v1 anterior ao preparo v2 é preservada');
      await assert.rejects(recordOwnRepPMarking(context, make(legacyPermit, `${scope}-legacy-after-v2`, 1000 + 2 * hour,
        undefined, 2, legacyCapture.offline.localHash), scopeDeps), { code: 'REP_P_OFFLINE_UPGRADE_REQUIRED' });
      await assert.rejects(issue('downgrade', base + 13 * hour + 60_000, null), { code: 'REP_P_OFFLINE_UPGRADE_REQUIRED' });
      const preKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const prePublic = preKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
      await assert.rejects(issue('device-before-first-upload', base + hour, 2,
        { deviceKeyId: repPDeviceKeyId(prePublic), devicePublicKey: prePublic }), { code: 'REP_P_OFFLINE_DEVICE_LOCKED' });
      assert.equal(permit.protocolVersion, 2);
      assert.equal(Date.parse(permit.preparationExpiresAt) - base, 24 * hour);
      const tooLate = { id: `${scope}-late-first`, startedElapsedRealtimeMs: 1000 + 24 * hour + 1 };
      clockInstant = new Date(base + 48 * hour).toISOString();
      await assert.rejects(recordOwnRepPMarking(context, make(permit, tooLate.id, tooLate.startedElapsedRealtimeMs, tooLate), scopeDeps),
        { code: 'REP_P_OFFLINE_CYCLE_EXPIRED' });

      const firstHour = scope === 'official' ? 23 : 18;
      const first = { id: `${scope}-first-v2`, startedElapsedRealtimeMs: 1000 + firstHour * hour };
      clockInstant = new Date(base + 23 * hour).toISOString();
      const captured = make(permit, first.id, first.startedElapsedRealtimeMs, first);
      // A web/online original may arrive while the phone still holds its earlier first capture.
      clockInstant = new Date(base + 23 * hour + 60_000).toISOString();
      const candidateInput = { attemptId: `${scope}-online-before-offline-upload`, workDate: date(base + 23 * hour + 60_000),
        executionUnitId, channel: 'browser', declaredPurpose: 'journey_start' };
      const onlineCandidate = await recordOwnRepPMarking(context, candidateInput, scopeDeps);
      const candidateHash = onlineCandidate.marking.hash;
      const accepted = await recordOwnRepPMarking(context, captured, scopeDeps);
      assert.equal(accepted.status, 'recorded');
      const cycles = await database.collection('repP_offlineCycles').where('employeeId', '==', userId).get();
      const cycleRef = cycles.docs.find((doc) => doc.get('cycleId') === first.id).ref;
      const initialCycle = (await cycleRef.get()).data();
      assert.equal(initialCycle.startedAtMs, base + firstHour * hour);
      assert.equal(initialCycle.expiresAtMs, base + (firstHour + 24) * hour);
      await assert.rejects(applyOwnRepPOfflineCycleAction(context,
        action(permit, { id: onlineCandidate.offlineCycle.id,
          startedElapsedRealtimeMs: onlineCandidate.offlineCycle.startedElapsedRealtimeMs }, onlineCandidate.receiptId,
          'close', 1000 + 24 * hour, 1), scopeDeps), { code: 'REP_P_OFFLINE_CYCLE_CONFLICT' });
      assert.equal((await database.collection(permits).doc(permit.permitId).get()).get('status'), 'active');

      const candidateReplay = await recordOwnRepPMarking(context, candidateInput, scopeDeps);
      assert.equal(candidateReplay.status, 'replayed');
      assert.equal(candidateReplay.marking.hash, candidateHash);
      assert.equal(candidateReplay.offlineCycle.id, first.id);
      assert.equal(Date.parse(candidateReplay.offlineCycle.expiresAt), initialCycle.expiresAtMs);

      // A fresh preparation or a second device cannot move the active cycle's deadline.
      const renewed = await issue('renewed-while-active', base + 23 * hour + 60_000);
      assert.equal(renewed.permitId, permit.permitId);
      assert.equal(Date.parse(renewed.cycle.expiresAt), initialCycle.expiresAtMs);
      clockInstant = new Date(base + 23 * hour + 120_000).toISOString();
      const replacement = { id: `${scope}-replacement`, startedElapsedRealtimeMs: 61_000 };
      await assert.rejects(recordOwnRepPMarking(context, make(renewed, replacement.id, 61_000, replacement), scopeDeps),
        { code: scope === 'official' ? 'REP_P_OFFLINE_SEQUENCE_INVALID' : 'REP_P_OFFLINE_CYCLE_FIRST_REQUIRED' });
      assert.equal((await cycleRef.get()).get('expiresAtMs'), initialCycle.expiresAtMs);
      const otherKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const otherPublic = otherKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
      await assert.rejects(issue('second-device', base + 23 * hour + 180_000, 2,
        { deviceKeyId: repPDeviceKeyId(otherPublic), devicePublicKey: otherPublic }), { code: 'REP_P_OFFLINE_DEVICE_LOCKED' });

      const afterEightHours = make(permit, `${scope}-eight-hours`, first.startedElapsedRealtimeMs + 8 * hour,
        first, 2, captured.offline.localHash);
      clockInstant = new Date(base + (firstHour + 8) * hour + 60_000).toISOString();
      assert.equal((await recordOwnRepPMarking(context, afterEightHours, scopeDeps)).status, 'recorded');
      if (scope === 'pilot') {
        assert.equal(captured.offline.markedAt.slice(11, 16), '22:00');
        assert.equal(afterEightHours.offline.markedAt.slice(11, 16), '06:00');
        assert.notEqual(afterEightHours.workDate, captured.workDate);
      }
      // Capture on the exact boundary is valid even if delivery happens much later.
      const boundary = make(permit, `${scope}-boundary`, first.startedElapsedRealtimeMs + 24 * hour, first, 3, afterEightHours.offline.localHash);
      clockInstant = new Date(base + 4 * 24 * hour).toISOString();
      assert.equal((await recordOwnRepPMarking(context, boundary, scopeDeps)).status, 'recorded');
      const expired = make(permit, `${scope}-expired`, first.startedElapsedRealtimeMs + 24 * hour + 1, first, 4, boundary.offline.localHash);
      await assert.rejects(recordOwnRepPMarking(context, expired, scopeDeps), { code: 'REP_P_OFFLINE_CYCLE_EXPIRED' });
      assert.equal((await recordOwnRepPMarking(context, captured, scopeDeps)).status, 'replayed');

      // A subsequent online cycle keeps mode0 and closes only after its queue is fully acknowledged.
      const nextBase = base + 5 * 24 * hour;
      clockInstant = new Date(nextBase + hour).toISOString();
      const onlineId = `${scope}-online-first`;
      const online = await recordOwnRepPMarking(context, { attemptId: onlineId, workDate: date(nextBase + hour), executionUnitId,
        channel: 'mobile', declaredPurpose: 'journey_start' }, scopeDeps);
      if (scope === 'official') assert.equal(online.marking.mode, '0');
      const nextPermit = await issue('online-cycle', nextBase + hour + 30_000);
      assert.equal(nextPermit.cycle.id, onlineId);
      const nextCycle = { id: onlineId, startedElapsedRealtimeMs: nextPermit.cycle.startedElapsedRealtimeMs };
      assert.equal(Date.parse(nextPermit.cycle.expiresAt), nextBase + 25 * hour);
      const reused = await issue('online-renew-does-not-reset', nextBase + hour + 60_000);
      assert.equal(reused.permitId, nextPermit.permitId);
      assert.equal(reused.cycle.expiresAt, nextPermit.cycle.expiresAt);
      clockInstant = new Date(nextBase + 2 * hour).toISOString();
      const later = make(nextPermit, `${scope}-offline-after-online`, 1000 + hour / 2, nextCycle);
      const synced = await recordOwnRepPMarking(context, later, scopeDeps);
      await assert.rejects(applyOwnRepPOfflineCycleAction(context,
        action(nextPermit, nextCycle, synced.receiptId, 'close', 1000 + 2 * hour, 0), scopeDeps), { code: 'REP_P_OFFLINE_CYCLE_PENDING' });
      const close = action(nextPermit, nextCycle, synced.receiptId, 'close', 1000 + 2 * hour, 1);
      assert.equal((await applyOwnRepPOfflineCycleAction(context, close, scopeDeps)).status, 'closed');
      assert.equal((await applyOwnRepPOfflineCycleAction(context, close, scopeDeps)).status, 'closed');
      assert.equal((await database.collection(permits).doc(nextPermit.permitId).get()).get('status'), 'closed');
      assert.equal((await recordOwnRepPMarking(context, later, scopeDeps)).status, 'replayed');
      await assert.rejects(recordOwnRepPMarking(context,
        make(nextPermit, `${scope}-after-close`, 1000 + 3 * hour, nextCycle, 2, later.offline.localHash), scopeDeps));

      // Unused preparations from before a confirmed close cannot open a replacement window.
      const thirdBase = nextBase + 2 * hour + 60_000;
      const thirdPermit = await issue('third-cycle', thirdBase);
      const spare = await issue('unused-spare-before-first', thirdBase + 60_000);
      const third = { id: `${scope}-third-first`, startedElapsedRealtimeMs: 1000 + hour };
      clockInstant = new Date(thirdBase + hour).toISOString();
      const thirdRequest = make(thirdPermit, third.id, third.startedElapsedRealtimeMs, third);
      const thirdRecorded = await recordOwnRepPMarking(context, thirdRequest, scopeDeps);
      clockInstant = new Date(thirdBase + hour + 60_000).toISOString();
      await applyOwnRepPOfflineCycleAction(context, action(thirdPermit, third, thirdRecorded.receiptId,
        'close', 1000 + hour + 60_000, 1), scopeDeps);
      const unusedStart = 1000 + hour + 60_000;
      await assert.rejects(recordOwnRepPMarking(context, make(spare, `${scope}-reuse-old-spare`, unusedStart,
        { id: `${scope}-reuse-old-spare`, startedElapsedRealtimeMs: unusedStart }), scopeDeps),
        { code: 'REP_P_OFFLINE_NEW_PREPARATION_REQUIRED' });

      // A first capture can arrive after a newer, disjoint journey: keep the newer head intact.
      const delayedBase = thirdBase + hour + 120_000;
      const delayedPermit = await issue('delayed-first', delayedBase);
      const delayedCycle = { id: `${scope}-delayed-first`, startedElapsedRealtimeMs: 1000 + hour };
      const delayed = make(delayedPermit, delayedCycle.id, delayedCycle.startedElapsedRealtimeMs, delayedCycle);
      const futureAt = delayedBase + 49 * hour;
      clockInstant = new Date(futureAt).toISOString();
      const future = await recordOwnRepPMarking(context, { attemptId: `${scope}-future-online`, workDate: date(futureAt),
        executionUnitId, channel: 'mobile', declaredPurpose: 'journey_start' }, scopeDeps);
      const futurePermit = await issue('future-prepared', futureAt + 60_000);
      const futureExpiry = futurePermit.cycle.expiresAt;
      assert.equal((await recordOwnRepPMarking(context, delayed, scopeDeps)).status, 'recorded');
      const head = await offlineCycleRefs(database, workspaceId, userId, delayedCycle.id).head.get();
      assert.equal(head.get('cycleId'), `${scope}-future-online`);
      assert.equal(head.get('expiresAtMs'), Date.parse(futureExpiry));
      assert.ok(future.receiptId);
      const recoveryAt = futureAt + 25 * hour;
      clockInstant = new Date(recoveryAt).toISOString();
      const broken = new Proxy(database, { get(target, property) {
        if (property === 'collection') return (name) => {
          if (name === 'repP_offlineCycleHeads' || name === 'repP_offlineCycles') throw new Error('synthetic auxiliary outage');
          return target.collection(name);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const recoveryInput = { onlineScope: scope, attemptId: `${scope}-auxiliary-outage`, workDate: date(recoveryAt), executionUnitId,
        channel: 'mobile', declaredPurpose: 'journey_start' };
      const preserved = await recordOwnRepPMarking(context, recoveryInput,
        { ...scopeDeps, ...(scope === 'official' ? { repDb: broken } : { pilotDb: broken }) });
      assert.equal(preserved.status, 'recorded');
      assert.ok(preserved.receiptId, 'original and receipt survive auxiliary outage');
      if (scope === 'official') {
        const rollback = { ...scopeDeps, repDb: broken, markingEnabled: false, pilotEnabled: false };
        assert.equal((await recordOwnRepPMarking(context, recoveryInput, rollback)).status, 'replayed');
        await assert.rejects(recordOwnRepPMarking(context, { ...recoveryInput, attemptId: 'new-after-rollback' }, rollback), { code: 'REP_P_MARKING_DISABLED' });
      }
      assert.equal(preserved.offlineCycle, undefined);
      const recovered = await issue('recover-auxiliary-outage', recoveryAt + hour);
      assert.equal(recovered.cycle.startedAt, new Date(recoveryAt).toISOString());
      assert.equal(recovered.cycle.expiresAt, new Date(recoveryAt + 24 * hour).toISOString());
      const replayedPermit = await issue('recover-auxiliary-outage', recoveryAt + 2 * hour);
      assert.deepEqual(replayedPermit.cycle, recovered.cycle, 'lost permit reply recovers original immutable context');
      if (scope === 'pilot') {
        const tagged = { ...recoveryInput, attemptId: `${scope}-tagged-online`, onlineScope: 'pilot' };
        const pilotOriginal = await recordOwnRepPMarking(context, tagged, scopeDeps);
        const officialDeps = { ...scopeDeps, markingEnabled: true, pilotEnabled: false, officialStartDate: '2026-01-01' };
        const replayAfterCutover = await recordOwnRepPMarking(context, tagged, officialDeps);
        assert.equal(replayAfterCutover.status, 'replayed'); assert.equal(replayAfterCutover.pilot, true);
        assert.equal(replayAfterCutover.marking.hash, pilotOriginal.marking.hash);
        await assert.rejects(recordOwnRepPMarking(context, { ...tagged, attemptId: 'pilot-unaccepted-after-cutover' }, officialDeps),
          { code: 'REP_P_PILOT_ONLINE_REPLAY_ONLY' });
      }
      const originalReplay = await recordOwnRepPMarking(context, recoveryInput, scopeDeps);
      assert.equal(originalReplay.status, 'replayed');
      assert.equal(originalReplay.marking.hash, preserved.marking.hash);
      assert.equal(originalReplay.offlineCycle.startedAt, recovered.cycle.startedAt);
      // HLB reads can finish in a different order from commits. Originals survive, offline fails closed.
      const orderedAt = recoveryAt + 25 * hour;
      clockInstant = new Date(orderedAt).toISOString();
      const earlierReading = await clock.read();
      let releaseEarlier, announceEarlier;
      const enteredEarlier = new Promise(resolve => { announceEarlier = resolve; });
      const release = new Promise(resolve => { releaseEarlier = resolve; });
      const earlierInput = { attemptId: `${scope}-earlier-clock-late-commit`, workDate: date(orderedAt), executionUnitId,
        channel: 'mobile', declaredPurpose: 'journey_start' };
      const earlierRequest = recordOwnRepPMarking(context, earlierInput, { ...scopeDeps,
        clock: { async read() { announceEarlier(); await release; return earlierReading; } } });
      await enteredEarlier;
      clockInstant = new Date(orderedAt + 60_000).toISOString();
      const newer = await recordOwnRepPMarking(context, { ...earlierInput, attemptId: `${scope}-newer-clock-first-commit` }, scopeDeps);
      const preparedBeforeLateCommit = await issue('before-late-original', orderedAt + 120_000);
      const closingCycle = { id: preparedBeforeLateCommit.cycle.id, startedElapsedRealtimeMs: preparedBeforeLateCommit.cycle.startedElapsedRealtimeMs };
      await applyOwnRepPOfflineCycleAction(context, action(preparedBeforeLateCommit, closingCycle, newer.receiptId, 'close', 1000 + 60_000, 0), scopeDeps);
      releaseEarlier();
      const earlier = await earlierRequest;
      assert.equal(earlier.status, 'recorded');
      assert.ok(earlier.receiptId); assert.ok(newer.receiptId);
      assert.equal(earlier.offlineCycle, undefined);
      const closedHeadAfterLateCommit = await offlineCycleRefs(database, workspaceId, userId, closingCycle.id).head.get();
      assert.equal(closedHeadAfterLateCommit.get('status'), 'closed', 'late original does not reopen a closed authorization');
      await assert.rejects(issue('after-late-original', orderedAt + 180_000), { code: 'REP_P_OFFLINE_CYCLE_ORDER_UNRESOLVED' });
      await assert.rejects(recordOwnRepPMarking(context, make(preparedBeforeLateCommit, `${scope}-no-window-after-late-original`,
        1000 + 60_000, { id: preparedBeforeLateCommit.cycle.id,
          startedElapsedRealtimeMs: preparedBeforeLateCommit.cycle.startedElapsedRealtimeMs }), scopeDeps),
        { code: 'REP_P_OFFLINE_CYCLE_ORDER_UNRESOLVED' });
      const earlierReplay = await recordOwnRepPMarking(context, earlierInput, scopeDeps);
      assert.equal(earlierReplay.status, 'replayed');
      assert.equal(earlierReplay.marking.hash, earlier.marking.hash);
      assert.equal(earlierReplay.offlineCycle, undefined);


    });
  } finally {
    for (const database of [repPDbAdmin, hrDbAdmin]) {
      for (const collection of ['repP_offlineCycles', 'repP_offlineCycleHeads', 'repP_pilotMarkings', 'repP_pilotHeads',
        'repP_pilotOfflinePermits', 'repP_pilotClassificationEvents', 'repP_pilotDayGuards']) {
        const docs = await database.collection(collection).where('employeeId', '==', userId).get();
        for (const doc of docs.docs) {
          const audit = await doc.ref.collection('audit').get();
          await Promise.all(audit.docs.map((row) => row.ref.delete()));
          await doc.ref.delete();
        }
      }
    }
    const collections = await Promise.all(['repP_events', 'repP_attempts', 'repP_receipts', 'repP_offlinePermits']
      .map((name) => repPDbAdmin.collection(name).where('workspaceId', '==', workspaceId).get()));
    await Promise.all(collections.flatMap((snapshot) => snapshot.docs.filter((doc) =>
      doc.get('employeeId') === userId || doc.get('establishmentId') === establishmentId).map((doc) => doc.ref.delete())));
    const closureVersions = await ptrpClosureRef.collection('versions').get();
    await Promise.all(closureVersions.docs.map((doc) => doc.ref.delete()));
    await Promise.all([repPDbAdmin.collection('repP_employees').doc(repPIdentifiersForTest.employeeKey(establishmentId, userId)), closureRef,
      repPDbAdmin.collection('repP_establishments').doc(establishmentId), cpfField, employee, employer, execution, user]
      .map((ref) => ref.delete().catch(() => undefined)));
    await ptrpClosureRef.delete().catch(() => undefined);
    const headId = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
    const refs = await Promise.all(['dp_employmentReferenceHistories', 'dp_employmentReferenceRequests']
      .map((collection) => dbAdmin.collection(collection).where('userId', '==', userId).get()));
    await Promise.all([...refs.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
      dbAdmin.collection('dp_employmentReferenceHeads').doc(headId)].map((ref) => ref.delete().catch(() => undefined)));
  }
});
