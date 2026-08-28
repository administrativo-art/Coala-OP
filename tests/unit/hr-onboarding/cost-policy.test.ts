import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('mantém a linha de produção limitada, paginada e sem polling da lista completa', async () => {
  const routeSource = await readFile(
    new URL('../../../src/app/api/hr/onboarding/route.ts', import.meta.url),
    'utf8',
  );
  const shellSource = await readFile(
    new URL('../../../src/components/hr/recruitment/recruitment-shell.tsx', import.meta.url),
    'utf8',
  );
  const getHandler = routeSource.slice(
    routeSource.indexOf('export async function GET'),
    routeSource.indexOf('export async function POST'),
  );

  assert.match(getHandler, /ONBOARDING_OVERVIEW_LIMITS/);
  assert.match(getHandler, /ONBOARDING_PAGE_LIMIT \+ 1/);
  assert.match(getHandler, /startAfter\(cursorDocument\)/);
  assert.doesNotMatch(shellSource, /setInterval\(onRefresh/);
  assert.match(shellSource, /api\/hr\/onboarding\/\$\{selectedProcess\.id\}/);
});

test('declara os índices da linha de produção no banco coala-rh', async () => {
  const hrIndexes = JSON.parse(await readFile(
    new URL('../../../firestore.rh.indexes.json', import.meta.url),
    'utf8',
  )) as {
    indexes: Array<{
      collectionGroup: string;
      fields: Array<{ fieldPath: string; order: string }>;
    }>;
  };

  const onboardingIndexes = hrIndexes.indexes.filter(
    index => index.collectionGroup === 'onboardingProcesses',
  );
  const fieldPaths = onboardingIndexes.map(index => index.fields.map(field => field.fieldPath));

  assert.ok(fieldPaths.some(paths => (
    paths.includes('status')
    && paths.includes('createdAt')
    && paths.includes('__name__')
  )));
  assert.ok(fieldPaths.some(paths => (
    paths.includes('providerCnpj')
    && paths.includes('status')
  )));
});
