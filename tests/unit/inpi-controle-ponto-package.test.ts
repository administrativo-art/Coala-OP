import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRepPSourceFiles, type RepPSourceScope } from '../../scripts/lib/inpi-controle-ponto-scope';

const scope: RepPSourceScope = {
  schemaVersion: 1,
  programName: 'Coala One — Controle de Ponto',
  archiveSlug: 'Coala-One-Controle-de-Ponto',
  description: 'teste',
  includeFiles: ['config/scope.json'],
  includePrefixes: ['src/ponto'],
  excludePrefixes: ['src/ponto/segredo'],
};

test('seleciona somente o recorte declarado e o ordena', () => {
  assert.deepEqual(selectRepPSourceFiles([
    'src/financeiro/index.ts',
    'src/ponto/z.ts',
    'config/scope.json',
    'src/ponto/segredo/exemplo.ts',
    'src/ponto/a.ts',
  ], scope), [
    'config/scope.json',
    'src/ponto/a.ts',
    'src/ponto/z.ts',
  ]);
});

test('recusa pacote sem arquivo obrigatório', () => {
  assert.throws(
    () => selectRepPSourceFiles(['src/ponto/a.ts'], scope),
    /Arquivos obrigatórios ausentes/,
  );
});

test('recusa segredo mesmo que o escopo tente incluí-lo', () => {
  assert.throws(
    () => selectRepPSourceFiles(['config/scope.json', 'src/ponto/.env.production'], scope),
    /arquivo proibido/,
  );
});
