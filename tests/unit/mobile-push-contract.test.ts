import assert from 'node:assert/strict';
import test from 'node:test';
import { registerPushDeviceSchema, removePushDeviceSchema, safePushPath } from '@/features/mobile/push/schemas';

const input = { installationId: '4ea3866e-0bd2-43a4-9de5-11b720e0e5b4', token: 'a'.repeat(128), packageName: 'coalaone.go', permissionGranted: true };

test('registro exige opt-in e rejeita campos de proprietário, workspace e destino', () => {
  assert.equal(registerPushDeviceSchema.safeParse(input).success, true);
  for (const extra of [{ ownerUid: 'bob' }, { workspaceId: 'other' }, { recipientUid: 'bob' }, { permissionGranted: false }, { token: 'with space' }]) {
    assert.equal(registerPushDeviceSchema.safeParse({ ...input, ...extra }).success, false);
  }
  assert.equal(removePushDeviceSchema.safeParse({ installationId: input.installationId, ownerUid: 'bob' }).success, false);
});

test('destino de push aceita apenas caminhos web conhecidos sem query', () => {
  assert.equal(safePushPath('/dashboard/collaborator/requests'), true);
  assert.equal(safePushPath('/dashboard/dp/requests'), true);
  for (const path of ['//evil.example', '/admin', '/dashboard/../admin', '/dashboard?x=y', '/dashboard/%2e%2e/admin']) assert.equal(safePushPath(path), false);
});
