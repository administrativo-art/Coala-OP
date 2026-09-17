import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const reconciliationPages = [
  'src/features/financial/sales-reconciliation/components/sales-reconciliation-page.tsx',
  'src/features/financial/stone-integration/components/stone-integration-page.tsx',
  'src/features/financial/stone-receivables/components/stone-receivables-page.tsx',
  'src/features/financial/stone-receivables/components/stone-settlements-page.tsx',
  'src/features/financial/cash-differences/components/cash-differences-page.tsx',
];

test('páginas da conciliação usam o contêiner e o cabeçalho canônicos do sistema', () => {
  for (const path of reconciliationPages) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /<PageContainer variant="wide"/i, path);
    assert.match(source, /<PageHeader/i, path);
    assert.doesNotMatch(source, /<h1/i, path);
  }
});
