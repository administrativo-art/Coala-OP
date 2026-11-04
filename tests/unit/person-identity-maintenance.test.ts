import assert from 'node:assert/strict';
import test from 'node:test';

import { personIdentityWriteBlocked } from '../../src/features/privacy/person-identity-maintenance.server';

const future = { toMillis: () => 2_000 };

test('maintenance blocks only the explicitly scoped user and process while active', () => {
  const window = {
    enabled: true,
    expiresAt: future,
    userIds: ['user-a'],
    onboardingProcessIds: ['process-a'],
  };
  assert.equal(personIdentityWriteBlocked(window, { userId: 'user-a' }, 1_000), true);
  assert.equal(personIdentityWriteBlocked(window, { onboardingProcessId: 'process-a' }, 1_000), true);
  assert.equal(personIdentityWriteBlocked(window, { userId: 'user-b' }, 1_000), false);
  assert.equal(personIdentityWriteBlocked(window, { onboardingProcessId: 'process-b' }, 1_000), false);
});

test('maintenance does not block when disabled or expired', () => {
  assert.equal(personIdentityWriteBlocked({ enabled: false }, { userId: 'user-a' }, 1_000), false);
  assert.equal(personIdentityWriteBlocked({ enabled: true, expiresAt: future, userIds: ['user-a'] }, { userId: 'user-a' }, 2_000), false);
});
