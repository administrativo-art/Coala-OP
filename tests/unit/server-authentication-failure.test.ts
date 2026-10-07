import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rethrowServerAuthenticationFailure } from '../../src/lib/server-authentication-failure';
import { AppError } from '../../src/lib/observability/app-error';

test('missing/expired tokens map to 401, compliance to 403, without hiding infrastructure failures', () => {
  for (const error of [new Error('Authorization header ausente ou inválido.'),
    Object.assign(new Error('private provider detail'), { code: 'auth/id-token-expired' })]) {
    assert.throws(() => rethrowServerAuthenticationFailure(error),
      (value: unknown) => value instanceof AppError && value.httpStatus === 401 && !value.safeMessage.includes('private'));
  }
  assert.throws(() => rethrowServerAuthenticationFailure(new Error('Atualização cadastral obrigatória pendente.')),
    (value: unknown) => value instanceof AppError && value.httpStatus === 403);
  const outage = new Error('database unavailable');
  assert.throws(() => rethrowServerAuthenticationFailure(outage), (value: unknown) => value === outage);
});
