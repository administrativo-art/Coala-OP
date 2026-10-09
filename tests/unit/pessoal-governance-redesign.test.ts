import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const files = {
  compliance: 'src/components/dp/profile-compliance-overview.tsx',
  audit: 'src/components/privacy/internal-audit-panel.tsx',
  privacy: 'src/components/privacy/internal-privacy-settings.tsx',
  governance: 'src/components/privacy/privacy-governance-panel.tsx',
} as const;
const source = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, readFileSync(path, 'utf8')])) as Record<keyof typeof files, string>;

test('as telas de Governança usam o guia e não têm hex nem diálogo nativo', () => {
  for (const [name, code] of Object.entries(source)) {
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b/, `${name}: hex solto`);
    assert.doesNotMatch(code, /\balert\(|\bconfirm\(|\bprompt\(/, `${name}: diálogo nativo`);
    assert.doesNotMatch(code, /\b(?:bg|text|border)-(?:slate|pink|rose|emerald|violet|amber|sky|blue)-\d{2,3}\b/, `${name}: cor Tailwind fora dos tokens`);
  }
  assert.match(source.compliance, /ControlIndicator/);
  assert.match(source.audit, /ControlIndicator/);
  assert.match(source.privacy, /ControlPanel/);
});

test('a lista abre um painel lateral em vez de linha expansível ou diálogo', () => {
  assert.match(source.compliance, /SidePanel/);
  assert.match(source.audit, /SidePanel/);
  assert.match(source.governance, /SidePanel/);
});

test('auditoria consulta o servidor ao confirmar a busca, não a cada tecla', () => {
  assert.match(source.audit, /appliedSearch/);
  assert.match(source.audit, /onSubmit=\{\(\) => setAppliedSearch/);
  assert.doesNotMatch(source.audit, /search: searchText/);
  assert.match(source.audit, /LOG_LIMIT/);
});

test('conteúdo pessoal continua sem expor valores: nenhuma tela lê chave PIX ou documento', () => {
  assert.doesNotMatch(source.compliance, /pix_key\b.*value|row\.pix/i);
  assert.match(source.compliance, /não expõe o conteúdo do PIX/);
});

test('ações de concluir e resolver têm tratamento de falha', () => {
  assert.match(source.governance, /Falha ao concluir pedido/);
  assert.match(source.governance, /Falha ao resolver incidente/);
});
