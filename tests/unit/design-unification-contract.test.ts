import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Decisão 0005 (docs/design/decisoes): o guia é a fonte única de padrões.
// O kit de Cadastros compõe as peças do guia e não pode voltar a ter visual próprio.
const kit = readFileSync('src/components/cadastros/cadastros-ui.tsx', 'utf8');
const workspace = readFileSync('src/components/cadastros/cadastros-workspace.tsx', 'utf8');
const eslintConfig = readFileSync('eslint.config.mjs', 'utf8');

test('kit de Cadastros não tem hex solto', () => {
  assert.doesNotMatch(kit, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(workspace, /#[0-9a-fA-F]{3,8}\b/);
});

test('kit de Cadastros delega ao guia em vez de reimplementar o padrão', () => {
  for (const pattern of ['control-panel', 'filter-chips', 'lift-row', 'side-panel', 'inline-confirm', 'segmented', 'bulk-bar', 'select-box']) {
    assert.match(kit, new RegExp(`@/components/patterns/${pattern}`), `deve usar patterns/${pattern}`);
  }
  assert.match(kit, /@\/components\/ui\/status-pill/);
  assert.doesNotMatch(kit, /@radix-ui\/react-dialog/, 'o painel lateral vem de SidePanel');
});

test('o lint trata hex solto em Cadastros como erro', () => {
  assert.match(eslintConfig, /"src\/components\/cadastros\/\*\*\/\*\.\{ts,tsx\}"/);
});
