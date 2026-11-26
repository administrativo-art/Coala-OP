import assert from 'node:assert/strict';
import test from 'node:test';
import { serverModuleLoader } from '../helpers/load-server-module';
const load = serverModuleLoader({ '@/lib/auth-server': { requireUser: () => undefined } });
const { toRouteAccessError } = load('src/lib/security/route-access.server.ts') as typeof import('../../src/lib/security/route-access.server');
const { AppError } = load('src/lib/observability/app-error.ts') as typeof import('../../src/lib/observability/app-error');

test('only recognized auth failures become 401; infrastructure stays reportable', () => {
  for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token']) {
    const cause = Object.assign(new Error('private diagnostic'), { code });
    assert.equal(toRouteAccessError(new Error('wrapped', { cause }), 'TEST_ACCESS').httpStatus, 401);
  }
  const session = new AppError({ code: 'SESSION_REVOKED', kind: 'AUTHENTICATION' });
  assert.equal(toRouteAccessError(new Error('wrapped', { cause: session }), 'TEST_ACCESS'), session);
  const prefixed = toRouteAccessError(new Error('Sem permissão diagnostic-private-secret'), 'TEST_ACCESS');
  assert.equal(prefixed.httpStatus, 500); assert.equal(prefixed.reportable, true); assert.ok(!prefixed.safeMessage.includes('diagnostic-private-secret'));
  const database = Object.assign(new Error('private backend failure'), { code: 'unavailable' });
  const result = toRouteAccessError(database, 'TEST_ACCESS');
  assert.equal(result.httpStatus, 500); assert.equal(result.reportable, true); assert.equal(result.cause, database);
  assert.ok(!result.safeMessage.includes(database.message));
  assert.equal(toRouteAccessError(new Error('Usuário selecionado não está disponível.'), 'TEST_ACCESS').httpStatus, 403);
});
