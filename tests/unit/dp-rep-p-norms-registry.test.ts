import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { REP_P_NORMS_REGISTRY } from '../../src/features/dp/rep-p/norms-registry';

describe('Registro de normas do REP-P', () => {
  it('keeps the code review date in sync with docs/rep-p/referencias/README.md', () => {
    const readme = readFileSync('docs/rep-p/referencias/README.md', 'utf8');
    const date = /\*\*Última conferência:\*\* (\d{4}-\d{2}-\d{2})/.exec(readme)?.[1] ?? null;
    assert.equal(REP_P_NORMS_REGISTRY.lastReviewedAt, date);
  });
});
