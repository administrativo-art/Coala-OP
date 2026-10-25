import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('decisão da troca declara as garantias exatas do contrato de participante', async () => {
  const source = await readFile(new URL(
    '../../src/app/api/collaborator/requests/shift-swaps/[requestId]/route.ts',
    import.meta.url,
  ), 'utf8');

  assert.match(source, /authorization: \{ kind: 'custom', strategy: 'shift-swap-participant-action' \}/);
  assert.match(source, /resourceScope: \{ kind: 'custom', strategy: 'shift-swap-participant' \}/);
  assert.match(source, /'authorization:shift-swap-participant-action'/);
  assert.match(source, /'scope:shift-swap-participant'/);
  assert.doesNotMatch(source, /'authorization:participant-action'/);
});
