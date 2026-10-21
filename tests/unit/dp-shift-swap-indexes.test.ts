import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

type Index = { collectionGroup: string; fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }> };

test('troca de turno declara todos os índices das consultas limitadas do contrato central', async () => {
  const source = await readFile(new URL('../../src/features/dp/shift-swaps/contract.server.ts', import.meta.url), 'utf8');
  const closure = await readFile(new URL('../../src/features/dp/time-adjustments/closure.server.ts', import.meta.url), 'utf8');
  const config = JSON.parse(await readFile(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as { indexes: Index[] };
  const matches = (fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>) => config.indexes.some((index) => (
    index.collectionGroup === 'dp_shiftSwapRequests'
    && JSON.stringify(index.fields) === JSON.stringify(fields)
  ));

  assert.ok(matches([{ fieldPath: 'workspaceId', order: 'ASCENDING' }, { fieldPath: 'participantUids', arrayConfig: 'CONTAINS' }]));
  assert.ok(matches([{ fieldPath: 'workspaceId', order: 'ASCENDING' }, { fieldPath: 'shiftKeys', arrayConfig: 'CONTAINS' }]));
  assert.ok(matches([{ fieldPath: 'workspaceId', order: 'ASCENDING' }, { fieldPath: 'workDate', order: 'ASCENDING' }]));
  assert.match(source, /where\('workspaceId', '==', context\.workspace_id\)[\s\S]{0,160}where\('participantUids', 'array-contains'/);
  assert.match(source, /where\('workspaceId', '==', context\.workspace_id\)[\s\S]{0,180}where\('shiftKeys', 'array-contains'/);
  assert.match(source, /\.limit\(100\)/);
  assert.match(source, /\.limit\(20\)/);
  assert.match(closure, /where\('workspaceId', '==', workspaceId\)[\s\S]{0,180}where\('workDate', '>='/);
  assert.match(closure, /\.limit\(ITEM_LIMIT \+ 1\)/);
});
