import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBatchStatusUpdate,
  resolveBatchArchivedStatus,
} from '../../src/lib/product-simulation-batch';

test('converte a ação em lote de inativação no campo de arquivamento', () => {
  const update = createBatchStatusUpdate(true, 'archived');

  assert.deepEqual(update, { action: 'set', value: 'archived' });
  assert.equal(resolveBatchArchivedStatus(update), true);
});

test('mantém ou reativa o status corretamente', () => {
  assert.equal(resolveBatchArchivedStatus(createBatchStatusUpdate(false, 'archived')), undefined);
  assert.equal(resolveBatchArchivedStatus(createBatchStatusUpdate(true, 'active')), false);
});
