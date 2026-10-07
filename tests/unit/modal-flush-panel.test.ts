import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const componentsDir = join(process.cwd(), 'src/components');

test('DialogContent oferece a prop flush que zera também o sm:p-6 padrão', () => {
  const source = readFileSync(join(componentsDir, 'ui/dialog.tsx'), 'utf8');
  assert.match(source, /flush && "p-0 sm:p-0"/);
});

test('modais com painel escuro de borda a borda usam flush, não p-0 solto', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(componentsDir).filter((name) => name.endsWith('.tsx'))) {
    const lines = readFileSync(join(componentsDir, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.includes('<DialogContent') && line.includes('bg-[#faf9f6]') && !line.includes('flush')) {
        offenders.push(`${file}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'use <DialogContent flush> nos modais do novo sistema visual');
});
