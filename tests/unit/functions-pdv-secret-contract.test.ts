import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { PDVLEGAL_SECRET_NAMES } from '../../functions/src/pdv-secret-contract';

const repositoryRoot = process.cwd();
const functionsRoot = resolve(repositoryRoot, 'functions');
const functionsSource = readFileSync(resolve(functionsRoot, 'src/index.ts'), 'utf8');

function declarationFor(exportName: string, provider: string): string {
  const start = functionsSource.indexOf(`export const ${exportName} = ${provider}(`);
  assert.notEqual(start, -1, `Declaração de ${exportName} não encontrada.`);

  const handlerStart = functionsSource.indexOf('async ', start);
  assert.notEqual(handlerStart, -1, `Handler de ${exportName} não encontrado.`);
  return functionsSource.slice(start, handlerStart);
}

test('mantém o catálogo mínimo das credenciais do PDV Legal', () => {
  assert.deepEqual(PDVLEGAL_SECRET_NAMES, [
    'PDVLEGAL_COD_EMPRESA',
    'PDVLEGAL_TOKEN',
    'PDVLEGAL_USERNAME',
    'PDVLEGAL_PASSWORD',
  ]);
  assert.equal(new Set(PDVLEGAL_SECRET_NAMES).size, PDVLEGAL_SECRET_NAMES.length);
});

test('injeta secrets somente nas duas Functions que sincronizam o PDV', () => {
  for (const [exportName, provider] of [
    ['hourlyPdvSync', 'onSchedule'],
    ['syncGoalsForRange', 'onCall'],
  ] as const) {
    const declaration = declarationFor(exportName, provider);
    assert.match(declaration, /secrets:\s*\[\.\.\.PDVLEGAL_SECRET_NAMES\]/);
  }

  assert.equal(
    functionsSource.match(/secrets:\s*\[\.\.\.PDVLEGAL_SECRET_NAMES\]/g)?.length,
    2,
  );
});

test('o contrato de secrets não contém valores nem configuração por função alheia ao PDV', () => {
  const contractSource = readFileSync(resolve(functionsRoot, 'src/pdv-secret-contract.ts'), 'utf8');
  assert.equal(contractSource.includes('=' + '"'), false);
  assert.equal(contractSource.includes("='"), false);
  assert.equal(
    functionsSource.match(/secrets:\s*\[\.\.\.PDVLEGAL_SECRET_NAMES\]/g)?.length,
    2,
  );
});

test('arquivos dotenv locais não mantêm os quatro parâmetros do PDV', () => {
  const secretNames = new Set<string>(PDVLEGAL_SECRET_NAMES);
  const dotenvFiles = readdirSync(functionsRoot)
    .filter((name) => name === '.env' || name.startsWith('.env.'));

  for (const dotenvFile of dotenvFiles) {
    const configuredNames = readFileSync(resolve(functionsRoot, dotenvFile), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((name): name is string => Boolean(name));

    assert.deepEqual(
      configuredNames.filter((name) => secretNames.has(name)),
      [],
      `${dotenvFile} não pode distribuir credenciais do PDV como env comum.`,
    );
  }
});
