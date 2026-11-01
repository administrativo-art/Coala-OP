import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { assertFirestoreEmulatorSafety } from '../helpers/firestore-emulator-safety.mjs';
import { enableServerOnlyTestImports } from '../helpers/server-only-runtime.mjs';

assertFirestoreEmulatorSafety({ projectId: 'demo-coala-repository' });
enableServerOnlyTestImports('demo-coala-repository');

const { dbAdmin } = await import('../../src/lib/firebase-admin.ts');
const { requestCorporateDevice, ownCorporateDevice } =
  await import('../../src/features/mobile/corporate-device/server.ts');

const HEUCILENE = 'fvrLOh1JOIOtU5QhZQZydN3UBf22';
const workspace = `synthetic-corporate-${randomUUID()}`;
const actor = (uid) => ({ workspace_id: workspace, decoded: { uid } });
const input = (installationId, key = 'a') => ({ installationId, deviceKeyId: key.repeat(64),
  devicePublicKey: key.repeat(120), keySecurity: 'tee', appVersion: '0.3.35', model: 'Synthetic Android', androidVersion: '16' });

test('ativação automática pertence só à Heucilene e não desfaz decisões administrativas', async () => {
  const first = randomUUID();
  const second = randomUUID();
  const heucilene = actor(HEUCILENE);
  const other = actor('synthetic-other');
  const refs = [];
  try {
    assert.equal((await ownCorporateDevice(other, first)).autoEnrollAllowed, false);
    await assert.rejects(requestCorporateDevice(other, input(first)), /Vínculo empresarial indisponível/);
    assert.equal((await ownCorporateDevice(heucilene, first)).autoEnrollAllowed, true);
    const created = await requestCorporateDevice(heucilene, input(first));
    refs.push(dbAdmin.collection('mobileCorporateDevices').doc(created.deviceId));
    assert.equal(created.status, 'active');
    assert.equal((await requestCorporateDevice(heucilene, input(first))).deviceId, created.deviceId);
    await assert.rejects(requestCorporateDevice(heucilene, input(first, 'b')), /chave deste aparelho mudou/);
    await assert.rejects(requestCorporateDevice(heucilene, input(second)), /Outro aparelho já está vinculado/);

    await refs[0].update({ status: 'revoked' });
    assert.equal((await ownCorporateDevice(heucilene, first)).reviewRequired, true);
    await assert.rejects(requestCorporateDevice(heucilene, input(first)), /revisão administrativa/);
    const replacement = await requestCorporateDevice(heucilene, input(second));
    refs.push(dbAdmin.collection('mobileCorporateDevices').doc(replacement.deviceId));
    await refs[0].update({ status: 'active' });
    await refs[1].update({ status: 'replaced' });
    assert.equal((await ownCorporateDevice(heucilene, second)).reviewRequired, true);
    await assert.rejects(requestCorporateDevice(heucilene, input(second)), /revisão administrativa/);

    await refs[0].update({ status: 'revoked' });
    const shared = randomUUID();
    const sharedId = createHash('sha256').update(JSON.stringify(['coala-corporate-device', workspace, shared])).digest('hex');
    const sharedRef = dbAdmin.collection('mobileCorporateDevices').doc(sharedId);
    refs.push(sharedRef);
    await sharedRef.set({ workspaceId: workspace, ownerUid: other.decoded.uid, status: 'active' });
    assert.equal((await ownCorporateDevice(heucilene, shared)).reviewRequired, true);
    await assert.rejects(requestCorporateDevice(heucilene, input(shared)), /já pertence a outro cadastro/);
    await sharedRef.update({ status: 'revoked' });
    assert.equal((await ownCorporateDevice(heucilene, shared)).autoEnrollAllowed, true);
    assert.equal((await requestCorporateDevice(heucilene, input(shared))).status, 'active');
  } finally {
    await Promise.all(refs.map((ref) => ref.delete()));
  }
});
