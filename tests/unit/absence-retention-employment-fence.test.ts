import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { assertAbsenceRetentionEmploymentWriteAllowed } from '../../scripts/absence-operational-admin-gate.mjs';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const retentionGateDb = (empty: boolean) => ({
  collection: () => ({
    where: () => ({ limit: () => ({ get: async () => ({ empty }) }) }),
  }),
});

test('escrita administrativa para quando existe uma exclusão documental com fence', async () => {
  await assertAbsenceRetentionEmploymentWriteAllowed(retentionGateDb(true) as never);
  await assert.rejects(assertAbsenceRetentionEmploymentWriteAllowed(retentionGateDb(false) as never),
    /suspensa durante exclusão documental/);
});

test('writers conhecidos de ciclo usam guard transacional ou gate administrativo', () => {
  const applicationWriters = [
    'src/lib/identity-lifecycle.server.ts',
    'src/app/api/users/[userId]/route.ts',
    'src/app/api/hr/onboarding/[id]/route.ts',
    'src/lib/integrations/bizneo-admin.ts',
  ];
  for (const path of applicationWriters) {
    assert.match(source(path), /setEmploymentCyclePatch/, `${path} precisa participar do fence de vínculo`);
  }
  assert.ok((source('functions/src/index.ts').match(/setEmploymentCyclePatch/g) ?? []).length >= 4,
    'Functions de sincronização, desligamento e readmissão precisam usar o guard');
  for (const path of ['scripts/migrate-dp.mjs', 'scripts/migrate-standard-person-links.mjs']) {
    assert.match(source(path), /assertAbsenceRetentionEmploymentWriteAllowed/,
      `${path} precisa parar diante de um fence ativo`);
  }
});
