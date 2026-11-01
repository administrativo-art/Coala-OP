import assert from 'node:assert/strict';
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
