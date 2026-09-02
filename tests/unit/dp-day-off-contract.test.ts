import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { publishDayOffSchema, removeDayOffSchema } from '../../src/features/dp/day-offs/schemas';
import { isPredictedDayOffDate } from '../../src/lib/dp-shift-rules';
import { defaultAdminPermissions, defaultGuestPermissions } from '../../src/types/index';

const scheduleEditorSource = readFileSync('src/components/dp/dp-schedule-editor.tsx', 'utf8');

test('segrega a publicação no Bizneo da edição comum da escala', () => {
  assert.equal(defaultGuestPermissions.dp.schedules.publishBizneo, false);
  assert.equal(defaultAdminPermissions.dp.schedules.publishBizneo, true);
});

test('aceita confirmação prevista e lançamento manual de folga', () => {
  for (const source of ['predicted', 'manual', 'retry'] as const) {
    const result = publishDayOffSchema.safeParse({
      userId: 'user-1',
      unitId: 'unit-1',
      date: '2026-09-06',
      source,
    });
    assert.equal(result.success, true);
  }
});

test('rejeita data inexistente e origem desconhecida', () => {
  assert.equal(publishDayOffSchema.safeParse({
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-02-30',
    source: 'manual',
  }).success, false);
  assert.equal(publishDayOffSchema.safeParse({
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-09-06',
    source: 'automatic',
  }).success, false);
});

test('remoção exige a identidade completa da folga gerenciada', () => {
  assert.equal(removeDayOffSchema.safeParse({
    shiftId: 'day-off-1',
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-09-07',
  }).success, true);
  assert.equal(removeDayOffSchema.safeParse({
    userId: 'user-1',
    unitId: 'unit-1',
    date: '2026-09-07',
  }).success, false);
});

test('prevê folga somente ao final de cada bloco completo de seis dias', () => {
  const sixDays = new Set([
    '2026-09-01',
    '2026-09-02',
    '2026-09-03',
    '2026-09-04',
    '2026-09-05',
    '2026-09-06',
  ]);
  assert.equal(isPredictedDayOffDate(sixDays, '2026-09-07'), true);

  const sevenDays = new Set([...sixDays, '2026-09-07']);
  assert.equal(isPredictedDayOffDate(sevenDays, '2026-09-08'), false);

  const twelveDays = new Set(Array.from({ length: 12 }, (_, index) => (
    `2026-09-${String(index + 1).padStart(2, '0')}`
  )));
  assert.equal(isPredictedDayOffDate(twelveDays, '2026-09-13'), true);
});

test('usa o selo da folga prevista como ação sem renderizar botão avulso', () => {
  const start = scheduleEditorSource.indexOf('function DayOffBadge');
  const end = scheduleEditorSource.indexOf('// ─── Main Component', start);
  const component = scheduleEditorSource.slice(start, end);

  assert.match(component, /badgeLabel = canAction \? actionLabel : 'Folga prevista'/);
  assert.match(component, /className=\{cn\([\s\S]*?'ml-auto inline-flex h-6 shrink-0/);
  assert.equal(component.match(/onClick=\{onPublish\}/g)?.length, 1);
  assert.doesNotMatch(component, /mt-1\.5 flex h-6 w-full/);
});

test('mantém ausências de alocação e remoção de folga visíveis na própria célula', () => {
  assert.match(scheduleEditorSource, /Sem unidade vinculada/);
  assert.match(scheduleEditorSource, /Folga em \$\{sourceUnitName\}/);
  assert.match(scheduleEditorSource, /aria-label=\{removalFailed \?/);
  assert.match(scheduleEditorSource, /method: 'DELETE'/);
});
