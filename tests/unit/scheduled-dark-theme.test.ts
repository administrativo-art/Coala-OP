import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isNightHour } from '../../src/components/theme/scheduled-dark-theme';

test('tema escuro segue a regra do Coala Go: escuro das 18h às 05h59', () => {
  for (const hour of [0, 5, 18, 23]) assert.equal(isNightHour(hour), true, String(hour));
  for (const hour of [6, 12, 17]) assert.equal(isNightHour(hour), false, String(hour));
  const app = readFileSync('apps/coala-one-android/app/src/main/java/com/coalaone/go/ui/Theme.kt', 'utf8');
  assert.match(app, /fun timeBasedDarkTheme\(hour: Int\) = hour !in 6\.\.17/);
});

test('a paleta escura só vale nas telas revisadas e redefine os tokens do design system', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const block = css.slice(css.indexOf(':root[data-ds-theme="dark"]'));
  for (const token of ['--ds-bg-page', '--ds-surface', '--ds-ink', '--ds-border', '--background', '--foreground']) assert.match(block, new RegExp(`${token}:`), token);
  // Fora do ponto e do painel do colaborador o sistema continua forçado no claro.
  assert.match(readFileSync('src/components/app-providers.tsx', 'utf8'), /forcedTheme="light"/);
  for (const file of ['src/features/dp/rep-p/my-time-recording-page.tsx', 'src/components/collaborator-dashboard-panel.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /<ScheduledDarkTheme \/>/, file);
  }
});
