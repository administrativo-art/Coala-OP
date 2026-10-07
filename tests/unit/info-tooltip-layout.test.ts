import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('explanations escape scrolling containers and stay within viewport bounds', () => {
  const tooltip = readFileSync('src/components/ui/info-tooltip.tsx', 'utf8');
  assert.match(tooltip, /<TooltipPortal>[\s\S]*<TooltipContent[\s\S]*<\/TooltipContent>[\s\S]*<\/TooltipPortal>/);
  assert.match(tooltip, /collisionPadding=\{16\}/);
  for (const token of ['max-w-[calc(100vw-32px)]', 'max-h-[var(--radix-tooltip-content-available-height)]', 'overflow-y-auto', 'whitespace-normal', 'break-words']) {
    assert.ok(tooltip.includes(token), `Missing tooltip layout guard: ${token}`);
  }
});
