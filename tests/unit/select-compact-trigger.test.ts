import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { isCompactSelectTrigger } from '../../src/components/ui/select';

test('select com altura compacta usa a seta colada à borda', () => {
  for (const className of ['h-8 w-full', 'h-7', 'text-xs h-9', 'h-[34px] w-[250px]', 'h-[28px]']) {
    assert.equal(isCompactSelectTrigger(className), true, className);
  }
  for (const className of [undefined, '', 'h-10', 'h-11 w-full', 'sm:h-8', 'h-[40px]', 'min-h-8', 'h-80']) {
    assert.equal(isCompactSelectTrigger(className), false, String(className));
  }
});

function tsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

test('alternância de visualização não usa ToggleGroupItem de largura fixa (o padding padrão esmaga o ícone)', () => {
  const offenders = tsxFiles('src').filter((file) => /<ToggleGroupItem\b[^>]*className="[^"]*\bw-(?:6|7|8|9)\b/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, [], 'Use o Segmented (docs/design/selecao-e-filtros.md).');
});

test('select compacto mantém o espaço da seta mesmo com px-* da tela', () => {
  const source = readFileSync('src/components/ui/select.tsx', 'utf8');
  const classNameAt = source.indexOf('      className,\n');
  const flushPaddingAt = source.indexOf('flushIcon && "overflow-hidden pr-11"');
  assert.ok(classNameAt > 0 && flushPaddingAt > classNameAt, 'pr-11 da seta colada precisa vir depois do className no cn().');
});
