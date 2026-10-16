import assert from 'node:assert/strict';
import test from 'node:test';

import { safeAbsenceNotificationPath } from '../../src/components/notification-center';

test('avisos de ausência aceitam somente as duas rotas internas explícitas', () => {
  assert.equal(safeAbsenceNotificationPath('/dashboard/collaborator/requests'), '/dashboard/collaborator/requests');
  assert.equal(safeAbsenceNotificationPath('/dashboard/dp/requests'), '/dashboard/dp/requests');
  assert.equal(safeAbsenceNotificationPath('/dashboard/dp/requests?token=secret'), null);
  assert.equal(safeAbsenceNotificationPath('//outside.example'), null);
  assert.equal(safeAbsenceNotificationPath('/dashboard/forms'), null);
});
