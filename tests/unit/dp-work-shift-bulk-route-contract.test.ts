import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync('src/features/dp/shifts/bulk-service.server.ts', 'utf8');
const routeSource = readFileSync('src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts', 'utf8');
const hookSource = readFileSync('src/hooks/use-dp-shifts.ts', 'utf8');

test('edição em lote passa por autenticação, transação e auditoria', () => {
  assert.match(routeSource, /requireUser\(request\)/);
  assert.match(routeSource, /bulkWorkShiftSchema\.safeParse/);
  assert.match(serviceSource, /dbAdmin\.runTransaction/);
  assert.match(serviceSource, /DP_SHIFT_SCHEDULE_LOCKED/);
  assert.match(serviceSource, /canAccessUnit/);
  assert.match(serviceSource, /DP_SHIFT_BULK_VACATION_CONFLICT/);
  assert.match(serviceSource, /DP_SHIFT_BULK_DAY_OFF_CONFLICT/);
  assert.match(serviceSource, /actionLogs/);
});

test('painel em lote não grava turnos diretamente pelo cliente', () => {
  assert.match(hookSource, /\/shifts\/bulk/);
  assert.doesNotMatch(hookSource, /const updateShiftsBatch/);
  assert.doesNotMatch(hookSource, /const deleteShiftsBatch/);
});
