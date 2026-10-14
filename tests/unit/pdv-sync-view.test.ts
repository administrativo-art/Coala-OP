import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SYNC_PRESETS,
  logHasIssue,
  summarizeSyncLogs,
  syncPresetRange,
  syncRangeDays,
  validateSyncRange,
  type SyncLog,
} from '../../src/lib/pdv-sync-view';

const NOW = new Date(2026, 9, 8, 12); // 08/10/2026

test('atalhos de período geram o intervalo esperado', () => {
  assert.deepEqual(syncPresetRange('week', NOW), { start: '2026-10-01', end: '2026-10-08' });
  assert.deepEqual(syncPresetRange('month', NOW), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(syncPresetRange('90days', NOW), { start: '2026-07-10', end: '2026-10-08' });
  assert.deepEqual(syncPresetRange('year', NOW), { start: '2026-01-01', end: '2026-10-08' });
});

test('o rótulo do atalho anual acompanha o ano corrente', () => {
  const year = SYNC_PRESETS.find((preset) => preset.id === 'year')!;
  assert.equal(year.label(NOW), 'Desde jan/2026');
  assert.equal(year.label(new Date(2027, 2, 1)), 'Desde jan/2027');
});

test('intervalo inválido devolve a mensagem para o campo', () => {
  assert.equal(validateSyncRange('2026-10-08', '2026-10-01'), 'A data inicial não pode ser maior que a final.');
  assert.equal(validateSyncRange('', '2026-10-01'), 'Informe a data inicial e a final.');
  assert.equal(validateSyncRange('2026-10-01', '2026-10-01'), null);
});

test('intervalo inclui os dois extremos', () => {
  assert.equal(syncRangeDays('2026-10-01', '2026-10-08').length, 8);
  assert.equal(syncRangeDays('2026-10-01', '2026-10-01').length, 1);
});

const log = (over: Partial<SyncLog>): SyncLog => ({ date: '2026-10-01', kioskName: 'Loja', status: 'success', ...over });

test('resumo conta só dias terminados e marca pendências', () => {
  const logs = [
    log({ revenue: 100, diagnostics: { couponsReceived: 5, itemsMapped: 9, itemsUnmapped: 1 } as never }),
    log({ date: '2026-10-02', status: 'error', errorMessage: 'falhou' }),
    log({ date: '2026-10-03', status: 'success', revenue: 50, warnings: ['sem ficha'] }),
    log({ date: '2026-10-04', status: 'pending' }),
  ];
  const summary = summarizeSyncLogs(logs);
  assert.equal(summary.finished, 3);
  assert.equal(summary.revenue, 150);
  assert.equal(summary.coupons, 5);
  assert.equal(summary.errorDays, 1);
  assert.equal(summary.warnDays, 1);
  assert.equal(summary.healthy, false);
  assert.equal(logs.filter(logHasIssue).length, 2);
  assert.equal(summarizeSyncLogs([log({ revenue: 10 })]).healthy, true);
});

test('a tela mantém a chamada e os blocos de 7 dias, e não usa diálogo nativo nem hex', () => {
  const screen = readFileSync('src/components/pdv-sync-management.tsx', 'utf8');
  const qr = readFileSync('src/components/catalogo/catalogo-qr-panel.tsx', 'utf8');
  assert.match(screen, /httpsCallable\(functions, 'syncGoalsForRange'\)/);
  assert.match(screen, /i \+= 7/);
  assert.match(screen, /loading=\{isSyncing\}/);
  for (const source of [screen, qr]) {
    assert.doesNotMatch(source, /\balert\(|\bconfirm\(/);
  }
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b/);
  assert.match(qr, /role="alert"/);
});
