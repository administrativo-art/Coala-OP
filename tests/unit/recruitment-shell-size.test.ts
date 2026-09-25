import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('mantém os módulos de recrutamento abaixo do limite de 500 KB do Babel', async () => {
  const files = [
    'recruitment-shell.tsx',
    'recruitment-onboarding-view.tsx',
  ];

  for (const file of files) {
    const source = await readFile(
      new URL(`../../src/components/hr/recruitment/${file}`, import.meta.url),
      'utf8',
    );
    assert.ok(source.length <= 500_000, `${file} ultrapassou o limite de 500 KB do Babel`);
  }
});
