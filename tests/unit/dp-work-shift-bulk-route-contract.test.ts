import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bulkWorkShiftSchema } from '../../src/features/dp/shifts/schemas';

const serviceSource = readFileSync('src/features/dp/shifts/bulk-service.server.ts', 'utf8');
const publicationSource = readFileSync('src/features/dp/schedules/publication-service.server.ts', 'utf8');
const routeSource = readFileSync('src/app/api/dp/schedules/[scheduleId]/shifts/bulk/route.ts', 'utf8');
const hookSource = readFileSync('src/hooks/use-dp-shifts.ts', 'utf8');
const schemaSource = readFileSync('src/features/dp/shifts/schemas.ts', 'utf8');

test('edição manual em lote exige permissão e grava somente no rascunho com auditoria', () => {
  assert.match(routeSource, /requireUser\(request\)/);
  assert.match(routeSource, /bulkWorkShiftSchema\.safeParse/);
  assert.match(routeSource, /stageBulkWorkShift/);
  assert.match(routeSource, /schedules\.edit/);
  assert.match(publicationSource, /dbAdmin\.runTransaction/);
  assert.match(publicationSource, /canAccessUnit/);
  assert.match(publicationSource, /draftEdits/);
  assert.match(publicationSource, /shift_draft_changed/);
  assert.match(publicationSource, /actionLogs/);
  assert.match(serviceSource, /DP_SHIFT_BULK_VACATION_CONFLICT/);
  assert.match(serviceSource, /DP_SHIFT_BULK_DAY_OFF_CONFLICT/);
});

test('painel em lote não grava turnos diretamente pelo cliente', () => {
  assert.match(hookSource, /\/shifts\/bulk/);
  assert.doesNotMatch(hookSource, /const updateShiftsBatch/);
  assert.doesNotMatch(hookSource, /const deleteShiftsBatch/);
});

test('preenchimento em lote cria somente entradas declaradas e mantém os horários do turno', () => {
  assert.match(schemaSource, /action: z\.literal\('create'\)/);
  assert.match(schemaSource, /entries: z\.array\(bulkCreateEntrySchema\)\.min\(1\)\.max\(200\)/);
  assert.match(serviceSource, /shifts_bulk_created/);
  assert.match(serviceSource, /DP_SHIFT_DEFINITION_TIME_MISMATCH/);
  assert.match(serviceSource, /DP_SHIFT_BULK_DAY_OFF_CONFLICT|reason: 'day_off'/);
});

test('schema do preenchimento em lote rejeita duplicidade, limite e horário vazio', () => {
  const base = {
    action: 'create' as const,
    shiftDefinitionId: 'definition-1',
    startTime: '08:00',
    endTime: '17:00',
    entries: [{ userId: 'user-1', date: '2026-10-01' }],
  };

  assert.equal(bulkWorkShiftSchema.safeParse(base).success, true);
  assert.equal(bulkWorkShiftSchema.safeParse({
    ...base,
    entries: [...base.entries, ...base.entries],
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({
    ...base,
    entries: Array.from({ length: 201 }, (_, index) => ({ userId: `user-${index}`, date: '2026-10-01' })),
  }).success, false);
  assert.equal(bulkWorkShiftSchema.safeParse({ ...base, endTime: '08:00' }).success, false);
});
