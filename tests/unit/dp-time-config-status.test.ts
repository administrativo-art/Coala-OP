import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTimeConfigsByListStatus, isArchivedTimeConfig, timeConfigListCounts } from '../../src/lib/dp-time-config-status';

const items = [
  { id: 'draft', status: 'draft' },
  { id: 'published', status: 'published' },
  { id: 'legacy-active' },
  { id: 'archived-config', status: 'archived' },
  { id: 'archived-shift', isArchived: true },
];

test('catálogos de tempo tratam rascunhos, publicados e legados como ativos', () => {
  assert.deepEqual(filterTimeConfigsByListStatus(items, 'active').map((item) => item.id), [
    'draft', 'published', 'legacy-active',
  ]);
});

test('catálogos de tempo separam status versionado e flag de turno arquivado', () => {
  assert.equal(isArchivedTimeConfig(items[3]), true);
  assert.equal(isArchivedTimeConfig(items[4]), true);
  assert.deepEqual(timeConfigListCounts(items), { active: 3, archived: 2 });
});
