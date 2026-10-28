import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { defaultAdminPermissions, defaultGuestPermissions } from '../../src/types/index';

const page = readFileSync('src/features/dp/rep-p/my-time-recording-page.tsx', 'utf8');
const dayPanel = readFileSync('src/features/dp/rep-p/day-list.tsx', 'utf8') + readFileSync('src/features/dp/rep-p/day-detail.tsx', 'utf8');
const route = readFileSync('src/app/api/dp/time-recording/employees/[employeeUid]/route.ts', 'utf8');
const service = readFileSync('src/features/dp/rep-p/employee-month.server.ts', 'utf8');
const access = readFileSync('src/features/dp/rep-p/employee-time-access.server.ts', 'utf8');

test('consulta de terceiros nasce fechada e é explícita para o administrador padrão', () => {
  assert.equal(defaultGuestPermissions.dp.timeRecording?.view, false);
  assert.equal(defaultAdminPermissions.dp.timeRecording?.view, true);
});

test('rota administrativa não oferece batida e audita a abertura por POST', () => {
  assert.match(route, /export const POST = secureRoute/);
  assert.doesNotMatch(route, /export const GET/);
  assert.match(route, /effects: \{ mode: 'write', audit: 'server-authoritative' \}/);
  assert.match(route, /canReadEmployeeTimeRecording/);
  assert.match(service, /canAccessUserByUnit/);
  assert.match(access, /permissions\.dp\.timeRecording\?\.view/);
  assert.match(service, /dp_timeRecordingAccessAudit/);
  assert.match(route, /audit: 'server-authoritative'/);
});

test('modo de conferência não oferece batida nem ações pessoais', () => {
  assert.match(page, /enabled: !readOnly/);
  assert.match(page, /Ela não registra ponto em nome do colaborador/);
  assert.match(page, /readOnly \? null : receipts/);
  assert.match(page, /adjustDate && !readOnly && \(options\?\.mode === "official" \|\| options\?\.mode === "pilot"\)/);
  assert.match(dayPanel, /if \(readOnly \|\| day\.date > today\) return "hidden"/);
  assert.match(dayPanel, /markingMode === "official" \? "available"/);
  assert.match(dayPanel, /incident === "missing" && !readOnly/);
});
