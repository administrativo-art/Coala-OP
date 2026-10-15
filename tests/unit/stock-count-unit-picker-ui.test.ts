import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/components/stock-session-management.tsx', 'utf8');
const picker = source.slice(
  source.indexOf('function KioskSelectionModal'),
  source.indexOf('interface StockSessionManagementProps'),
);

test('seletor da contagem segue a hierarquia visual da reposição', () => {
  assert.match(picker, /data-ui="stock-count-unit-picker"/);
  assert.match(picker, /kiosk\.id === 'matriz'/);
  assert.match(picker, /Centro de distribuição - Matriz/);
  assert.match(picker, /Centro de distribuição · disponível para contar/);
  assert.match(picker, />Quiosques<\/p>/);
  assert.match(picker, /grid gap-2 sm:grid-cols-2/);
  assert.match(picker, /COUNT_UNIT_PALETTE\[index % COUNT_UNIT_PALETTE\.length\]/);
  assert.match(picker, /replace\(\/\^Quiosque\\s\+\/i, ''\)/);
});

test('seleção fecha o modal e preserva o callback existente da contagem', () => {
  assert.match(picker, /onOpenChange\(false\);\s*onSelectKiosk\(kioskId\);/);
  assert.doesNotMatch(picker, /DialogClose/);
  assert.match(picker, /Nenhuma unidade está disponível para iniciar uma contagem/);
});
