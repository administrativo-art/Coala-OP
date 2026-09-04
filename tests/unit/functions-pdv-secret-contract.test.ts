import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import {
  PDVLEGAL_SECRET_CONSUMERS,
  PDVLEGAL_SECRET_NAMES,
} from '../../functions/src/pdv-secret-contract';

const repositoryRoot = process.cwd();
const functionsRoot = resolve(repositoryRoot, 'functions');
const functionsSourceRoot = resolve(functionsRoot, 'src');
const applicationSourceRoot = resolve(repositoryRoot, 'src');
const secretNames = new Set<string>(PDVLEGAL_SECRET_NAMES);

type FunctionBinding = {
  file: string;
  functionName: string;
  secretNames: string[];
  usesCentralCatalog: boolean;
};

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.js', '.mjs', '.cjs'].includes(extname(entry.name)) ? [path] : [];
  });
}

function propertyName(node: ts.PropertyName): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function exportedFunctionBindings(): {
  bindings: FunctionBinding[];
  commonEnvironmentKeys: { file: string; functionName: string; key: string }[];
} {
  const bindings: FunctionBinding[] = [];
  const commonEnvironmentKeys: { file: string; functionName: string; key: string }[] = [];

  for (const file of sourceFiles(functionsSourceRoot).filter((path) => extname(path) === '.ts')) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
        const functionName = declaration.name.text;
        const options = declaration.initializer.arguments.find(ts.isObjectLiteralExpression);
        if (!options) continue;

        const secretsProperty = options.properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && propertyName(property.name) === 'secrets'
        );
        if (secretsProperty && ts.isArrayLiteralExpression(secretsProperty.initializer)) {
          let usesCentralCatalog = false;
          const configuredSecrets = new Set<string>();
          for (const element of secretsProperty.initializer.elements) {
            if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression) && element.expression.text === 'PDVLEGAL_SECRET_NAMES') {
              usesCentralCatalog = true;
              for (const secretName of PDVLEGAL_SECRET_NAMES) configuredSecrets.add(secretName);
            } else if (ts.isStringLiteral(element) && secretNames.has(element.text)) {
              configuredSecrets.add(element.text);
            }
          }
          if (usesCentralCatalog || configuredSecrets.size > 0) {
            bindings.push({
              file: relative(repositoryRoot, file),
              functionName,
              secretNames: [...configuredSecrets].sort(),
              usesCentralCatalog,
            });
          }
        }

        const commonEnvironmentProperty = options.properties.find((property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && propertyName(property.name) === 'environmentVariables'
        );
        if (commonEnvironmentProperty && ts.isObjectLiteralExpression(commonEnvironmentProperty.initializer)) {
          for (const property of commonEnvironmentProperty.initializer.properties) {
            if (ts.isSpreadAssignment(property)) continue;
            const key = propertyName(property.name);
            if (key && secretNames.has(key)) {
              commonEnvironmentKeys.push({ file: relative(repositoryRoot, file), functionName, key });
            }
          }
        }
      }
    }
  }

  return { bindings, commonEnvironmentKeys };
}

test('mantém o catálogo e a allowlist mínimos das credenciais do PDV Legal', () => {
  assert.deepEqual(PDVLEGAL_SECRET_NAMES, [
    'PDVLEGAL_COD_EMPRESA',
    'PDVLEGAL_TOKEN',
    'PDVLEGAL_USERNAME',
    'PDVLEGAL_PASSWORD',
  ]);
  assert.deepEqual(PDVLEGAL_SECRET_CONSUMERS, [
    'hourlyPdvSync',
    'reconcilePdvSalesHistory',
    'syncGoalsForRange',
  ]);
  assert.equal(new Set(PDVLEGAL_SECRET_NAMES).size, PDVLEGAL_SECRET_NAMES.length);
  assert.equal(new Set(PDVLEGAL_SECRET_CONSUMERS).size, PDVLEGAL_SECRET_CONSUMERS.length);
});

test('vincula o catálogo completo somente às Functions autorizadas', () => {
  const { bindings, commonEnvironmentKeys } = exportedFunctionBindings();
  const expectedConsumers = [...PDVLEGAL_SECRET_CONSUMERS].sort();

  assert.deepEqual(bindings.map((binding) => binding.functionName).sort(), expectedConsumers);
  assert.deepEqual(commonEnvironmentKeys, []);

  for (const binding of bindings) {
    assert.equal(binding.file, 'functions/src/index.ts');
    assert.equal(binding.usesCentralCatalog, true, `${binding.functionName} deve usar o catálogo central.`);
    assert.deepEqual(binding.secretNames, [...PDVLEGAL_SECRET_NAMES].sort());
  }
});

test('não distribui credenciais do PDV como env comum ou valor hardcoded', () => {
  const dotenvFiles = readdirSync(functionsRoot)
    .filter((name) => name === '.env' || name.startsWith('.env.'));

  for (const dotenvFile of dotenvFiles) {
    const configuredNames = readFileSync(resolve(functionsRoot, dotenvFile), 'utf8')
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
      .filter((name): name is string => Boolean(name));
    assert.deepEqual(configuredNames.filter((name) => secretNames.has(name)), [], dotenvFile);
  }

  for (const file of sourceFiles(functionsSourceRoot)) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /(?:const|let|var)\s+PDVLEGAL_(?:COD_EMPRESA|TOKEN|USERNAME|PASSWORD)\s*=\s*['"][^'"]+['"]/
    );
    assert.doesNotMatch(
      text,
      /console\.(?:log|warn|error)\([^\n]*(?:process\.env\.)?PDVLEGAL_(?:COD_EMPRESA|TOKEN|USERNAME|PASSWORD)/
    );
  }
});

test('mantém os parâmetros do App Hosting como referências de secret', () => {
  const appHosting = readFileSync(resolve(repositoryRoot, 'apphosting.yaml'), 'utf8');
  for (const secretName of PDVLEGAL_SECRET_NAMES) {
    assert.match(
      appHosting,
      new RegExp(`- variable: ${secretName}\\n    secret: ${secretName}(?:\\n|$)`),
    );
    assert.doesNotMatch(
      appHosting,
      new RegExp(`- variable: ${secretName}\\n    value:`),
    );
  }
});

test('impede exposição client-side das credenciais do PDV Legal', () => {
  const pdvAdminPath = resolve(applicationSourceRoot, 'lib/integrations/pdv-legal-admin.ts');
  assert.match(readFileSync(pdvAdminPath, 'utf8'), /^import ["']server-only["'];/);

  for (const file of sourceFiles(applicationSourceRoot)) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /NEXT_PUBLIC_[A-Z0-9_]*PDV(?:LEGAL)?[A-Z0-9_]*/i, relative(repositoryRoot, file));
    assert.doesNotMatch(
      text,
      /NEXT_PUBLIC_[A-Z0-9_]*\s*[:=]\s*(?:process\.env\.)?PDVLEGAL_(?:COD_EMPRESA|TOKEN|USERNAME|PASSWORD)/,
      relative(repositoryRoot, file),
    );
    if (/^[\s;]*["']use client["'];?/m.test(text)) {
      for (const secretName of PDVLEGAL_SECRET_NAMES) {
        assert.equal(text.includes(secretName), false, `${relative(repositoryRoot, file)} referencia ${secretName}.`);
      }
    }
  }
});
