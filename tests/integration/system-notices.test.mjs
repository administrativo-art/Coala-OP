import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
const { Timestamp } = await import('firebase-admin/firestore');
const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { hrDbAdmin } = await import('../../src/lib/firebase-rh-admin.ts');
const { defaultAdminPermissions, defaultGuestPermissions } = await import('../../src/types/index.ts');
const { runRepPDailyMonitor } = await import('../../src/features/dp/rep-p/monitor.server.ts');
const { listSystemNotices } = await import('../../src/features/system-notices/service.server.ts');
const { createTestIcpCredential } = await import('../helpers/rep-p-test-certificate.ts');

test('vigia diário abre um aviso por marco, resolve superados e entrega só a quem tem permissão', async () => {
  const workspaceId = 'system-notices-integration';
  const prefix = 'system-notices-it';
  // Certificado de teste válido até 01/01/2030 00:00 UTC, que em Fortaleza ainda é 31/12/2029.
  const signerPem = createTestIcpCredential().pem;
  const renewedPem = createTestIcpCredential({ notAfter: new Date('2032-01-01T00:00:00Z') }).pem;
  const managerProfile = dbAdmin.collection('profiles').doc(`${prefix}-manager`);
  const viewerProfile = dbAdmin.collection('profiles').doc(`${prefix}-viewer`);
  const manager = dbAdmin.collection('users').doc(`${prefix}-manager-user`);
  const viewer = dbAdmin.collection('users').doc(`${prefix}-viewer-user`);
  const pendingReceipt = hrDbAdmin.collection('repP_receipts').doc(`${prefix}-receipt`);
  const permissions = (manageTime) => ({ settings: { view: true, viewSystemNotices: true }, dp: { settings: { manageTime } } });
  const context = (overrides) => ({ workspace_id: workspaceId, decoded: { uid: 'x' }, profileId: null,
    userDoc: { id: 'x', unitAccessScope: 'all' }, ...overrides });
  try {
    await Promise.all([
      managerProfile.set({ name: 'Gestor de Tempo', permissions: permissions(true) }),
      viewerProfile.set({ name: 'Só avisos', permissions: permissions(false) }),
      manager.set({ isActive: true, profileId: managerProfile.id, unitAccessScope: 'all' }),
      viewer.set({ isActive: true, profileId: viewerProfile.id, unitAccessScope: 'all' }),
      pendingReceipt.set({ workspaceId, status: 'pending', createdAt: Timestamp.fromDate(new Date('2029-11-09T00:00:00Z')) }),
    ]);

    const first = await runRepPDailyMonitor({ workspaceId, signerPem, now: new Date('2029-11-10T12:00:00Z') });
    assert.equal(first.certificateState, 'valid');
    assert.equal(first.pendingReceipts, 1);
    assert.equal(first.normsReviewOverdue, true);
    assert.equal(first.opened.length, 3);
    assert.ok(first.opened.some((key) => key.endsWith(':60')));
    // Mesmo dia de novo: nada duplicado.
    assert.deepEqual((await runRepPDailyMonitor({ workspaceId, signerPem, now: new Date('2029-11-10T18:00:00Z') })).opened, []);

    const second = await runRepPDailyMonitor({ workspaceId, signerPem, now: new Date('2029-11-18T12:00:00Z') });
    assert.ok(second.opened.some((key) => key.endsWith(':45')));

    const admin = context({ isDefaultAdmin: true, permissions: structuredClone(defaultAdminPermissions) });
    const open = await listSystemNotices(admin, { status: 'open' });
    const certificateNotices = open.notices.filter((notice) => notice.category === 'rep-p.certificate');
    assert.equal(certificateNotices.length, 1);
    assert.equal(certificateNotices[0].title, 'Certificado de assinatura do ponto vence em 43 dias');
    assert.equal(certificateNotices[0].severity, 'info');
    const resolved = await listSystemNotices(admin, { status: 'resolved' });
    assert.ok(resolved.notices.some((notice) => notice.category === 'rep-p.certificate' && notice.resolvedReason === 'superseded_or_renewed'));

    // Quem só abre a central, sem gerenciar Tempo, não vê avisos do ponto.
    const viewerContext = context({ isDefaultAdmin: false,
      permissions: { ...structuredClone(defaultGuestPermissions), settings: { ...defaultGuestPermissions.settings, view: true, viewSystemNotices: true } } });
    assert.deepEqual((await listSystemNotices(viewerContext, { status: 'open' })).notices, []);
    await assert.rejects(listSystemNotices(context({ isDefaultAdmin: false, permissions: structuredClone(defaultGuestPermissions) }),
      { status: 'open' }), { code: 'SYSTEM_NOTICES_FORBIDDEN' });

    // Sino: só o gestor de Tempo recebe.
    const managerBell = await dbAdmin.collection('userNotifications').where('ownerUid', '==', manager.id).get();
    const viewerBell = await dbAdmin.collection('userNotifications').where('ownerUid', '==', viewer.id).get();
    assert.ok(managerBell.size >= 4);
    assert.equal(viewerBell.size, 0);

    const expired = await runRepPDailyMonitor({ workspaceId, signerPem, now: new Date('2030-01-02T12:00:00Z') });
    assert.ok(expired.opened.some((key) => key.endsWith(':expired')));
    const expiredOpen = (await listSystemNotices(admin, { status: 'open' })).notices.filter((notice) => notice.category === 'rep-p.certificate');
    assert.equal(expiredOpen[0].title, 'Certificado de assinatura do ponto vencido');
    assert.equal(expiredOpen[0].severity, 'critical');

    // ARP indisponível: a contagem é pulada sem derrubar certificado e normas nem resolver avisos às cegas.
    const unavailable = await runRepPDailyMonitor({ workspaceId, signerPem, now: new Date('2030-01-02T13:00:00Z'),
      repDatabase: { collection() { throw new Error('banco coala-rep ausente'); } } });
    assert.equal(unavailable.receiptsCheck, 'unavailable');
    assert.equal(unavailable.certificateState, 'expired');
    assert.ok((await listSystemNotices(admin, { status: 'open' })).notices.some((notice) => notice.category === 'rep-p.receipts'));

    // Renovação: certificado novo fora da janela resolve o aviso de vencido; pendência zerada resolve a de comprovantes.
    await pendingReceipt.update({ status: 'issued' });
    const renewed = await runRepPDailyMonitor({ workspaceId, signerPem: renewedPem, now: new Date('2030-01-03T12:00:00Z') });
    assert.equal(renewed.pendingReceipts, 0);
    const afterRenewal = (await listSystemNotices(admin, { status: 'open' })).notices;
    assert.deepEqual(afterRenewal.map((notice) => notice.category), ['rep-p.norms-review']);
  } finally {
    const [notices, bells] = await Promise.all([
      dbAdmin.collection('systemNotices').where('workspaceId', '==', workspaceId).get(),
      dbAdmin.collection('userNotifications').where('workspaceId', '==', workspaceId).get(),
    ]);
    await Promise.all([...notices.docs.map((doc) => doc.ref), ...bells.docs.map((doc) => doc.ref),
      managerProfile, viewerProfile, manager, viewer, pendingReceipt].map((ref) => ref.delete().catch(() => undefined)));
  }
});
