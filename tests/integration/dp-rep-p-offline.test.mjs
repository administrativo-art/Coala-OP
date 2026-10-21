import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions } = await import('../../src/types/index.ts');
const { publishEmploymentReference } = await import('../../src/features/dp/employment-reference/service.server.ts');
const { canonicalRepPOfflineEvent, deriveRepPOfflineMarkedAt, hashRepPOfflineEvent, repPDeviceKeyId }
  = await import('../../src/features/dp/rep-p/offline.ts');
const { issueOwnRepPOfflinePermit, provisionRepPReferenceData, recordOwnRepPMarking, repPIdentifiersForTest }
  = await import('../../src/features/dp/rep-p/service.server.ts');

test('Coala Go preserva offline, servidor valida a corrente e só então atribui NSR modo 1', async () => {
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
  const dependencies = { repDb: hrDbAdmin, mainDb: dbAdmin, hrDb: hrDbAdmin, clock, markingEnabled: true,
    signer: { async signDetached() { throw new Error('unused'); } },
    receiptSigner: { async signPdf() { throw new Error('receipt pending'); } } };
  const profile = { establishmentId, employerCnpj, employerLegalName: 'CT Sorvetes LTDA',
    inpiRegistration: '12345678901234567', developerCnpj: employerCnpj };
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const devicePublicKey = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const deviceKeyId = repPDeviceKeyId(devicePublicKey);
  let permitId = '';
  try {
    await Promise.all([
      employer.set({ name: 'Empregadora', address: 'Rua fiscal, 1', cnpj: employerCnpj, timeZone: 'America/Belem' }),
      execution.set({ name: 'Execução', address: 'Rua operacional, 2', timeZone: 'America/Manaus' }),
      user.set({ isActive: true, unitId: employerUnitId, unitIds: [employerUnitId, executionUnitId] }),
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
    assert.equal((await recordOwnRepPMarking(context, request, dependencies)).status, 'replayed');
    const nsrAfterFirst = (await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr');
    await assert.rejects(recordOwnRepPMarking(context, { ...request, attemptId: 'offline-tampered', offline: {
      ...request.offline, sequence: 2, previousLocalHash: localHash,
    } }, dependencies), (cause) => cause?.code === 'REP_P_OFFLINE_SIGNATURE_INVALID');
    assert.equal((await hrDbAdmin.collection('repP_establishments').doc(establishmentId).get()).get('lastNsr'), nsrAfterFirst);

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
    const closureRef = hrDbAdmin.collection('ptrp_competenceClosures').doc(`${workspaceId}_2026-10`);
    await closureRef.set({ workspaceId, competence: '2026-10', status: 'closed' });
    await assert.rejects(recordOwnRepPMarking(context, secondRequest, dependencies),
      (cause) => cause?.code === 'REP_P_OFFLINE_COMPETENCE_CLOSED');
    await closureRef.delete();
    assert.equal((await hrDbAdmin.collection('repP_offlinePermits').doc(permitId).get()).get('lastAcceptedSequence'), 1);
    assert.equal((await recordOwnRepPMarking(context, secondRequest, dependencies)).status, 'recorded');
    const storedPermit = await hrDbAdmin.collection('repP_offlinePermits').doc(permitId).get();
    assert.equal(storedPermit.get('lastAcceptedSequence'), 2); assert.equal(storedPermit.get('lastAcceptedHash'), secondHash);
    const eventDoc = (await hrDbAdmin.collection('repP_events').where('establishmentId', '==', establishmentId)
      .where('recordType', '==', '7').get()).docs[0];
    assert.equal(eventDoc.get('mode'), '1'); assert.equal(eventDoc.get('offlineEvidence.localHash'), localHash);
  } finally {
    const collections = await Promise.all(['repP_events', 'repP_attempts', 'repP_receipts', 'repP_offlinePermits']
      .map((name) => hrDbAdmin.collection(name).where('workspaceId', '==', workspaceId).get()));
    await Promise.all(collections.flatMap((snapshot) => snapshot.docs.filter((doc) =>
      doc.get('employeeId') === userId || doc.get('establishmentId') === establishmentId).map((doc) => doc.ref.delete())));
    await Promise.all([hrDbAdmin.collection('repP_employees').doc(repPIdentifiersForTest.employeeKey(establishmentId, userId)),
      hrDbAdmin.collection('repP_establishments').doc(establishmentId), cpfField, employee, employer, execution, user]
      .map((ref) => ref.delete().catch(() => undefined)));
    const headId = createHash('sha256').update(JSON.stringify([workspaceId, userId])).digest('hex');
    const refs = await Promise.all(['dp_employmentReferenceHistories', 'dp_employmentReferenceRequests']
      .map((collection) => dbAdmin.collection(collection).where('userId', '==', userId).get()));
    await Promise.all([...refs.flatMap((snapshot) => snapshot.docs.map((doc) => doc.ref)),
      dbAdmin.collection('dp_employmentReferenceHeads').doc(headId)].map((ref) => ref.delete().catch(() => undefined)));
  }
});
