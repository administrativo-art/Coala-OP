import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';
import PizZip from 'pizzip';
import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');
assert.match(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost):\d+$/);
process.env.REP_P_MARKING_ENABLED = 'false';
process.env.REP_P_AVAILABILITY_MONITOR_SECRET = 'synthetic-monitor-secret';
process.env.REP_P_AVAILABILITY_POLICY_NAME = 'synthetic-policy';
process.env.REP_P_AVAILABILITY_CONDITION_NAME = 'synthetic-condition';
process.env.REP_P_OFFLINE_ATTESTATION_MODE = 'enforce';
process.env.MOBILE_APP_ATTESTATION_SECRET = 'synthetic-local-attestation-secret-with-64-characters-for-tests-only';

const { authAdmin, dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { FieldValue, Timestamp } = await import('firebase-admin/firestore');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { repPDbAdmin } = await import('../../src/lib/firebase-rep-p-admin.ts');
const receiptRoute = await import('../../src/app/api/dp/time-recording/receipts/[receiptId]/route.ts');
const exportRoute = await import('../../src/app/api/dp/time-recording/receipts/export/route.ts');
const mirrorRoute = await import('../../src/app/api/dp/time-recording/mirrors/pdf/route.ts');
const employeeRoute = await import('../../src/app/api/dp/time-recording/employees/[employeeUid]/route.ts');
const afdRoute = await import('../../src/app/api/dp/time-recording/afd/route.ts');
const aejRoute = await import('../../src/app/api/dp/time-recording/aej/route.ts');
const fiscalRoute = await import('../../src/app/api/dp/time-recording/fiscal-options/route.ts');
const monitorRoute = await import('../../src/app/api/jobs/rep-p/availability-events/route.ts');
const locationRoute = await import('../../src/app/api/dp/time-recording/location-access/route.ts');
const cycleRoute = await import('../../src/app/api/dp/time-recording/offline-cycles/route.ts');
const { signMobileAttestation } = await import('../../src/lib/security/mobile-app-attestation.ts');
const { canonicalRepPCycleAction, repPDeviceKeyId } = await import('../../src/features/dp/rep-p/offline.ts');
const { readLocation, LOCATION_ACCESS_AUDIT } = await import('../../src/features/dp/rep-p/location-access.server.ts');
const { WORKSPACE_ID } = await import('../../src/lib/workspace.ts');
const { DEVELOPER_VIEW_AS_EMAIL } = await import('../../src/features/auth/developer-view-as.ts');
const prefix = 'synthetic-rep-security';
const range = 'startDate=2026-10-27&endDate=2026-10-27';
const emptyParams = { params: Promise.resolve({}) };

function request(path, token, init = {}) {
  return new NextRequest(`http://localhost${path}`, { ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
}

test('APIs REP-P impedem exportação de terceiros, escalada de perfil e monitor forjado', { timeout: 120_000 }, async (t) => {
  const users = ['a', 'b', 'dp', 'global', 'stale-admin', 'developer'].map((role) => `${prefix}-${role}`);
  const [a, b, dp, global, staleAdmin, developer] = users;
  const unitA = `${prefix}-unit-a`; const unitB = `${prefix}-unit-b`;
  const tokens = new Map();
  const ids = ['a', 'b', 'c'].map((char) => `${char.repeat(64)}_000000001`);
  const pdfA = Buffer.from('%PDF-1.7 SYNTHETIC-PERSON-A-PRIVATE');
  const pdfB = Buffer.from('%PDF-1.7 SYNTHETIC-PERSON-B-PRIVATE');
  const pdfOther = Buffer.from('%PDF-1.7 SYNTHETIC-OTHER-WORKSPACE-PRIVATE');
  const refs = [];
  const receiptParams = (receiptId) => ({ params: Promise.resolve({ receiptId }) });
  const employeeParams = (employeeUid) => ({ params: Promise.resolve({ employeeUid }) });
  try {
    for (const uid of users) {
      // Endereço permitido apenas no Auth Emulator: nenhuma conta/mensagem real é utilizada.
      const email = uid === developer ? DEVELOPER_VIEW_AS_EMAIL : `${uid}@example.test`;
      const password = 'synthetic-password-123';
      await authAdmin.createUser({ uid, email, password });
      await authAdmin.setCustomUserClaims(uid, { profileId: uid, sessionVersion: 0, isDefaultAdmin: uid === staleAdmin });
      const manager = uid === dp || uid === global;
      const profile = dbAdmin.collection('profiles').doc(uid);
      const user = dbAdmin.collection('users').doc(uid);
      const permissions = manager ? { dp: { timeRecording: { view: true }, timeClosure: { close: true, reopen: true },
        settings: { manageTime: true } } } : {};
      await profile.set({ permissions, isDefaultAdmin: uid === staleAdmin });
      await user.set({ username: `Pessoa fictícia ${uid}`, email, profileId: uid, isActive: true, sessionVersion: 0,
        profileCompliance: { status: 'complete', policyVersion: 1 }, unitIds: [uid === b ? unitB : unitA],
        unitAccessScope: uid === global ? 'all' : 'selected', unitAccessUnitIds: [uid === b ? unitB : unitA] });
      refs.push(profile, user);
      const login = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
      assert.equal(login.ok, true);
      tokens.set(uid, (await login.json()).idToken);
    }
    for (const [id, employeeId, workspaceId, pdf] of [
      [ids[0], a, WORKSPACE_ID, pdfA], [ids[1], b, WORKSPACE_ID, pdfB], [ids[2], a, 'synthetic-other-workspace', pdfOther],
    ]) {
      const ref = repPDbAdmin.collection('repP_receipts').doc(id);
      await ref.set({ schemaVersion: 1, workspaceId, employeeId, recordedDate: '2026-10-27', status: 'issued',
        snapshot: { nsr: 1, markedAt: '2026-10-27T09:00:00-0300', executionUnitId: employeeId === b ? unitB : unitA,
          collectorId: '02', hash: 'a'.repeat(64) },
        pdf, filename: `synthetic-${employeeId}.pdf`, sha256: createHash('sha256').update(pdf).digest('hex') });
      refs.push(ref);
    }
    for (const unit of [unitA, unitB]) {
      const ref = dbAdmin.collection('dp_units').doc(unit);
      await ref.set({ name: 'Unidade fictícia', timeZone: 'America/Belem' }); refs.push(ref);
    }

    await t.test('download e ZIP contêm somente o titular e o workspace autenticados', async () => {
      for (const [uid, ownId, ownPdf, forbiddenPdf] of [[a, ids[0], pdfA, pdfB], [b, ids[1], pdfB, pdfA]]) {
        const own = await receiptRoute.GET(request(`/api/dp/time-recording/receipts/${ownId}`, tokens.get(uid)), receiptParams(ownId));
        assert.equal(own.status, 200);
        assert.deepEqual(Buffer.from(await own.arrayBuffer()), ownPdf);
        assert.equal(own.headers.get('cache-control'), 'private, no-store');
        const zip = await exportRoute.GET(request(`/api/dp/time-recording/receipts/export?${range}`, tokens.get(uid)), emptyParams);
        assert.equal(zip.status, 200);
        assert.equal(zip.headers.get('cache-control'), 'private, no-store');
        const bytes = Buffer.from(await zip.arrayBuffer());
        assert.ok(bytes.includes(ownPdf)); assert.equal(bytes.includes(forbiddenPdf), false); assert.equal(bytes.includes(pdfOther), false);
        assert.equal(Object.keys(new PizZip(bytes).files).filter((name) => name.endsWith('.pdf')).length, 1);
      }
    });

    await t.test('ID alheio, outro workspace e inexistente não revelam existência nem permitem reemissão', async () => {
      const responses = [];
      for (const id of [ids[1], ids[2], `${'d'.repeat(64)}_000000001`]) {
        for (const method of ['GET', 'POST']) {
          const result = await receiptRoute[method](request(`/api/dp/time-recording/receipts/${id}`, tokens.get(a), { method }), receiptParams(id));
          assert.equal(result.status, 404);
          const body = await result.json(); responses.push([body.error.code, body.error.message]);
        }
      }
      assert.ok(responses.every((entry) => JSON.stringify(entry) === JSON.stringify(responses[0])));
      const adminOwnRoute = await receiptRoute.GET(request(`/api/dp/time-recording/receipts/${ids[0]}`, tokens.get(global)), receiptParams(ids[0]));
      assert.equal(adminOwnRoute.status, 404, 'nem gestor global troca o dono numa rota pessoal');
    });

    await t.test('forjar titular no query ou cabeçalho não muda a identidade', async () => {
      for (const key of ['employeeId', 'employeeUid', 'userId', 'workspaceId']) {
        const response = await exportRoute.GET(request(`/api/dp/time-recording/receipts/export?${range}&${key}=${b}`, tokens.get(a)), emptyParams);
        assert.equal(response.status, 400, key);
      }
      const response = await exportRoute.GET(request(`/api/dp/time-recording/receipts/export?${range}`, tokens.get(a),
        { headers: { 'x-user-id': b, 'x-workspace-id': 'synthetic-other-workspace', 'x-coala-view-as': b,
          Cookie: `coala_dev_view_as=${b}` } }), emptyParams);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200); assert.ok(bytes.includes(pdfA)); assert.equal(bytes.includes(pdfB), false);
    });

    await t.test('modo de suporte não troca o titular das exportações pessoais', async () => {
      const headers = { 'x-coala-view-as': a, Cookie: `coala_dev_view_as=${a}` };
      const archive = await exportRoute.GET(request(`/api/dp/time-recording/receipts/export?${range}`,
        tokens.get(developer), { headers }), emptyParams);
      assert.equal(archive.status, 200);
      const bytes = Buffer.from(await archive.arrayBuffer());
      assert.equal(bytes.includes(pdfA), false, 'Visualizar como não autoriza baixar o ZIP de outra pessoa');
      const receipt = await receiptRoute.GET(request(`/api/dp/time-recording/receipts/${ids[0]}`,
        tokens.get(developer), { headers }), receiptParams(ids[0]));
      assert.equal(receipt.status, 404);
    });

    await t.test('perfil pessoal e gestor limitado não conseguem extração fiscal global', async () => {
      for (const uid of [a, dp]) {
        for (const [route, url] of [[afdRoute, '/api/dp/time-recording/afd'], [aejRoute, '/api/dp/time-recording/aej']]) {
          const response = await route.POST(request(url, tokens.get(uid), { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ establishmentId: 'synthetic-establishment', startDate: '2026-10-27', endDate: '2026-10-27' }) }), emptyParams);
          assert.equal(response.status, 403);
        }
        assert.equal((await fiscalRoute.GET(request('/api/dp/time-recording/fiscal-options', tokens.get(uid)), emptyParams)).status, 403);
      }
      assert.equal((await fiscalRoute.GET(request('/api/dp/time-recording/fiscal-options', tokens.get(global)), emptyParams)).status, 200);
    });

    await t.test('claim administrativo antigo não restaura privilégio retirado do perfil atual', async () => {
      const url = '/api/dp/time-recording/fiscal-options';
      assert.equal((await fiscalRoute.GET(request(url, tokens.get(staleAdmin)), emptyParams)).status, 200);
      await dbAdmin.collection('profiles').doc(staleAdmin).set({ isDefaultAdmin: false, permissions: {} });
      assert.equal((await fiscalRoute.GET(request(url, tokens.get(staleAdmin)), emptyParams)).status, 403);
      await dbAdmin.collection('profiles').doc(staleAdmin).set({ isDefaultAdmin: true, permissions: {} });
      for (const profileId of [null, '', FieldValue.delete(), a]) {
        await dbAdmin.collection('users').doc(staleAdmin).update({ profileId });
        assert.equal((await fiscalRoute.GET(request(url, tokens.get(staleAdmin)), emptyParams)).status, 403,
          'claim de perfil antigo não restaura atribuição removida ou trocada');
      }
    });

    await t.test('espelho alheio é negado e conferência DP exige permissão e unidade', async () => {
      const mirror = `/api/dp/time-recording/mirrors/pdf?competence=2026-10&employeeUid=${b}`;
      assert.equal((await mirrorRoute.GET(request(mirror, tokens.get(a)), emptyParams)).status, 403);
      assert.equal((await mirrorRoute.GET(request(mirror, tokens.get(dp)), emptyParams)).status, 404);
      const path = (uid) => `/api/dp/time-recording/employees/${uid}`;
      const read = (actor, subject) => employeeRoute.POST(request(path(subject), tokens.get(actor), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: '2026-10' }),
      }), employeeParams(subject));
      assert.equal((await read(a, b)).status, 403);
      assert.equal((await read(dp, b)).status, 404);
      const allowed = await read(dp, a);
      assert.equal(allowed.status, 200);
      const body = await allowed.json();
      assert.equal(body.employee.uid, a);
      assert.ok(body.history.markings.every((row) => row.receiptId === ids[0]));
      const audit = await hrDbAdmin.collection('dp_timeRecordingAccessAudit').where('employeeUid', '==', a).get();
      assert.ok(audit.docs.some((row) => row.get('actorUid') === dp));
      refs.push(...audit.docs.map((row) => row.ref));
    });

    await t.test('coordenadas exigem titular real ou permissão expressa por unidade e auditoria sem coordenadas', async () => {
      const input = { employeeUid: a, unitId: unitA, workDate: '2026-10-27', source: 'marking', reason: 'own_data', limit: 1 };
      const send = (uid, data = input, headers = {}) => locationRoute.POST(request('/api/dp/time-recording/location-access', tokens.get(uid),
        { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json', ...headers } }), emptyParams);
      const base = { workspaceId: WORKSPACE_ID, employeeId: a, executionUnitId: unitA, recordedDate: input.workDate,
        expiresAt: Timestamp.fromDate(new Date('2099-01-01')), capture: { status: 'captured', location: {
          latitude: -1.45583, longitude: -48.50444, accuracyMeters: 15, capturedAt: '2026-10-27T12:00:00Z' } },
        privateInternalField: 'MUST-NOT-LEAK', policy: { center: { latitude: -1, longitude: -48 } } };
      for (const [suffix, extra] of [['0', {}], ['1', {}], ['2', { employeeId: b }], ['3', { executionUnitId: unitB }],
        ['4', { workspaceId: 'other-workspace' }], ['5', { recordedDate: '2026-10-26' }], ['6', { expiresAt: Timestamp.fromMillis(1) }]]) {
        const ref = repPDbAdmin.collection('repP_locationEvidence').doc(`${prefix}-location-${suffix}`);
        await ref.set({ ...base, ...extra }); refs.push(ref);
      }
      assert.equal((await send(undefined)).status, 401);
      assert.equal((await send(b)).status, 403);
      assert.equal((await send(dp, { ...input, reason: 'operational_review' })).status, 403);
      await dbAdmin.collection('profiles').doc(global).update({ isDefaultAdmin: true });
      assert.equal((await send(global, { ...input, reason: 'privacy_review' })).status, 403, 'administrador não herda a permissão sensível');
      await dbAdmin.collection('profiles').doc(global).update({ 'permissions.dp.timeRecording.readLocation': true });
      assert.equal((await send(global, { ...input, reason: 'privacy_review' })).status, 200, 'administrador com concessão expressa pode consultar');
      await dbAdmin.collection('profiles').doc(global).update({ 'permissions.dp.timeRecording.readLocation': false });
      await dbAdmin.collection('profiles').doc(global).update({ isDefaultAdmin: false });
      const first = await send(a); assert.equal(first.status, 200);
      assert.match(first.headers.get('cache-control'), /no-store/);
      const page = await first.json(); assert.equal(page.entries.length, 1);
      assert.equal(page.entries[0].position.latitude, base.capture.location.latitude);
      assert.ok(page.nextCursor);
      assert.equal(JSON.stringify(page).includes('MUST-NOT-LEAK'), false);
      assert.equal(JSON.stringify(page).includes('policy'), false);
      const next = await send(a, { ...input, cursor: page.nextCursor, limit: 50 });
      const second = await next.json(); assert.equal(second.entries.length, 1); assert.equal(second.nextCursor, null);
      assert.notEqual(second.entries[0].id, page.entries[0].id);
      const viewAs = await send(developer, input, { 'x-coala-view-as-user-id': a, Cookie: `coala_view_as_user_id=${a}` });
      assert.equal(viewAs.status, 403);
      await dbAdmin.collection('profiles').doc(dp).update({ 'permissions.dp.view': true, 'permissions.dp.timeRecording.readLocation': true });
      const managed = await send(dp, { ...input, reason: 'employee_request', limit: 50 });
      assert.equal(managed.status, 200); assert.equal((await managed.json()).entries.length, 2);
      assert.equal((await send(dp, { ...input, unitId: unitB, reason: 'operational_review' })).status, 403);
      assert.equal((await send(dp, { ...input, workDate: '2026-02-30', reason: 'operational_review' })).status, 400);
      assert.equal((await send(a, { ...input, extra: true })).status, 400);
      const journey = hrDbAdmin.collection('dp_journeyLocationEvents').doc(`${prefix}-journey`);
      await journey.set({ ...base, workDate: input.workDate, capturedAt: Timestamp.fromDate(new Date('2026-10-27T12:00:00Z')),
        position: base.capture.location, eventType: 'sample' }); refs.push(journey);
      const journeyResponse = await send(a, { ...input, source: 'journey' });
      assert.equal(journeyResponse.status, 200); assert.equal((await journeyResponse.json()).entries.length, 1);
      const audits = await repPDbAdmin.collection(LOCATION_ACCESS_AUDIT).where('workspaceId', '==', WORKSPACE_ID).where('employeeUid', '==', a).get();
      refs.push(...audits.docs.map((doc) => doc.ref));
      assert.equal(audits.size, 5);
      assert.ok(audits.docs.some((doc) => doc.get('actorUid') === dp && doc.get('reason') === 'employee_request'));
      assert.equal(JSON.stringify(audits.docs.map((doc) => doc.data())).includes('latitude'), false);
      await dbAdmin.collection('profiles').doc(dp).update({ 'permissions.dp.timeRecording.readLocation': false });
      assert.equal((await send(dp, { ...input, reason: 'operational_review' })).status, 403, 'revogação vale na próxima requisição com o mesmo token');
    });

    await t.test('falha da auditoria impede devolver coordenadas mesmo ao titular', async () => {
      const actor = { decoded: { uid: a }, workspace_id: WORKSPACE_ID, permissions: {} };
      const database = { collection(name) { return name === LOCATION_ACCESS_AUDIT
        ? { doc() { return { async create() { throw new Error('synthetic-audit-failure'); } }; } }
        : repPDbAdmin.collection(name); } };
      await assert.rejects(readLocation(actor, { employeeUid: a, unitId: unitA, workDate: '2026-10-27', source: 'marking', reason: 'own_data' },
        { repDb: database }), /synthetic-audit-failure/);
    });

    await t.test('encerramento do ciclo exige conta ativa, passe do app, titularidade e assinatura', async () => {
      const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      const permit = repPDbAdmin.collection('repP_offlinePermits').doc(`${prefix}-cycle-permit`);
      await permit.set({ protocolVersion: 2, scope: 'official', workspaceId: WORKSPACE_ID, employeeId: a,
        permitId: permit.id, deviceKeyId: repPDeviceKeyId(publicKey), devicePublicKey: publicKey, bootCount: 7, status: 'active' });
      refs.push(permit);
      const core = { action: 'close', scope: 'official', permitId: permit.id, cycleId: `${prefix}-cycle`,
        startedElapsedRealtimeMs: 1000, elapsedRealtimeMs: 2000, bootCount: 7,
        deviceKeyId: repPDeviceKeyId(publicKey), receiptId: ids[0], lastSequence: 0 };
      const input = { ...core, signature: sign('sha256', Buffer.from(canonicalRepPCycleAction(core)), keys.privateKey).toString('base64') };
      const send = (uid, body = input, attested = true) => cycleRoute.POST(request('/api/dp/time-recording/offline-cycles', tokens.get(uid), {
        method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(attested && uid ? {
          'X-Coala-App-Attestation': signMobileAttestation(process.env.MOBILE_APP_ATTESTATION_SECRET, uid).token } : {}) },
      }), emptyParams);
      assert.equal((await send(undefined)).status, 401);
      assert.equal((await send(a, input, false)).status, 403);
      assert.equal((await send(b)).status, 409);
      assert.equal((await send(a, { ...input, signature: Buffer.alloc(64, 1).toString('base64') })).status, 409);
      assert.equal((await send(a, { ...input, employeeUid: b })).status, 400);
      assert.equal((await send(a, { ...input, action: 'online' })).status, 400, 'uma ação auxiliar não pode escolher a hora da primeira batida online');
      assert.equal((await permit.get()).get('status'), 'active');
    });

    await t.test('sem login, conta inativa e sessão revogada não exportam', async () => {
      const url = `/api/dp/time-recording/receipts/export?${range}`;
      assert.equal((await exportRoute.GET(request(url), emptyParams)).status, 401);
      const user = dbAdmin.collection('users').doc(a);
      await user.update({ isActive: false });
      const inactive = await exportRoute.GET(request(url, tokens.get(a)), emptyParams);
      assert.equal(inactive.status, 403);
      assert.equal((await inactive.json()).error.code, 'INACTIVE_ACCOUNT');
      await user.update({ isActive: true, sessionVersion: 1 });
      const revoked = await exportRoute.GET(request(url, tokens.get(a)), emptyParams);
      assert.equal(revoked.status, 401);
      assert.equal((await revoked.json()).error.code, 'AUTHENTICATION_REQUIRED');
      await authAdmin.setCustomUserClaims(a, { profileId: a, sessionVersion: 1 });
      const refreshed = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${a}@example.test`, password: 'synthetic-password-123', returnSecureToken: true }),
      });
      assert.equal(refreshed.ok, true);
      const newToken = (await refreshed.json()).idToken;
      assert.equal((await exportRoute.GET(request(url, newToken), emptyParams)).status, 200);
      assert.equal((await exportRoute.GET(request(url, tokens.get(a)), emptyParams)).status, 401);
      await dbAdmin.collection('users').doc(global).update({ sessionVersion: 1 });
      assert.equal((await fiscalRoute.GET(request('/api/dp/time-recording/fiscal-options', tokens.get(global)), emptyParams)).status, 401,
        'permissão administrativa não contorna a revogação da sessão');
      await authAdmin.updateUser(b, { disabled: true });
      assert.equal((await exportRoute.GET(request(url, tokens.get(b)), emptyParams)).status, 401);
    });

    await t.test('notificação do monitor exige segredo, origem e payload válidos sem consumir NSR com gate fechado', async () => {
      const url = '/api/jobs/rep-p/availability-events';
      const body = { incident: { incident_id: `${prefix}-incident`, state: 'open', started_at: 1793098800,
        policy_name: 'synthetic-policy', condition_name: 'synthetic-condition' } };
      const send = (token, payload) => monitorRoute.POST(request(url, token,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }), emptyParams);
      assert.equal((await send(undefined, body)).status, 401);
      assert.equal((await send('wrong-synthetic-secret', body)).status, 401);
      assert.equal((await send('synthetic-monitor-secret', { incident: { ...body.incident, policy_name: 'wrong-policy' } })).status, 403);
      assert.equal((await send('synthetic-monitor-secret', { incident: { ...body.incident, state: 'invalid' } })).status, 400);
      const accepted = await send('synthetic-monitor-secret', body);
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).status, 'official-collection-disabled');
      const cloudMonitoringOpen = await send('synthetic-monitor-secret', {
        incident: { ...body.incident, incident_id: `${prefix}-cloud-monitoring-open`, ended_at: null },
      });
      assert.equal(cloudMonitoringOpen.status, 200, 'Cloud Monitoring usa ended_at=null enquanto o incidente está aberto');
      assert.equal((await cloudMonitoringOpen.json()).status, 'official-collection-disabled');
      assert.equal((await repPDbAdmin.collection('repP_events').where('availabilityIncidentId', '==', body.incident.incident_id).get()).size, 0);
    });
  } finally {
    for (const ref of refs) await ref.delete();
    for (const uid of users) await authAdmin.deleteUser(uid).catch(() => undefined);
  }
});
