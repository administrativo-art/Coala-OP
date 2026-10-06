import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/dp/dp-settings-units.tsx', 'utf8');
const rowSource = source.slice(
  source.indexOf('function renderUnitRow'),
  source.indexOf('function renderGroupBlock'),
);

test('endereço oferece detalhe acessível e atalhos de cópia', () => {
  assert.match(source, /aria-label={`Ver e copiar endereço de \$\{unitName\}`}/);
  assert.match(source, /onClick=\{\(\) => void copy\(address, "address"\)\}/);
  assert.match(source, /onContextMenu=\{\(event\) => \{/);
  assert.match(source, /Copiar endereço/);
  assert.match(source, /Copiar CEP/);
});

test('turnos ficam em consulta compacta e funcionamento deixa de ser truncado', () => {
  assert.match(rowSource, /<UnitShiftsQuickFact shifts=\{shifts\}/);
  assert.match(rowSource, /<CalendarClock/);
  assert.doesNotMatch(rowSource, /title=\{coverageSummary\}/);
  assert.doesNotMatch(rowSource, /truncate text-xs/);
  assert.match(source, /Consulta somente: nenhuma informação é copiada ou alterada/);
});
