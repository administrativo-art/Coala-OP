import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const buildEnvVariables = [
  'COALA_NEXT_BUILD_CPUS',
  'COALA_NEXT_SKIP_TYPECHECK',
  'COALA_NEXT_WEBPACK_BUILD_WORKER',
] as const;

type BuildConfigSnapshot = {
  cpus: number;
  ignoreBuildErrors: boolean;
  webpackBuildWorker: boolean;
};

function loadBuildConfig(
  overrides: Partial<Record<(typeof buildEnvVariables)[number], string>> = {},
): BuildConfigSnapshot {
  const env = { ...process.env };
  for (const variable of buildEnvVariables) {
    delete env[variable];
  }
  Object.assign(env, overrides);

  const script = `
    const { default: config } = await import('./next.config.mjs');
    process.stdout.write(JSON.stringify({
      cpus: config.experimental.cpus,
      ignoreBuildErrors: config.typescript.ignoreBuildErrors,
      webpackBuildWorker: config.experimental.webpackBuildWorker,
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as BuildConfigSnapshot;
}

function appHostingEnvBlock(source: string, variable: string): string {
  const start = source.indexOf(`  - variable: ${variable}\n`);
  assert.notEqual(start, -1, `${variable} precisa existir no apphosting.yaml`);
  const next = source.indexOf('\n  - variable:', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test('build local preserva um worker e a validação de tipos', () => {
  assert.deepEqual(loadBuildConfig(), {
    cpus: 1,
    ignoreBuildErrors: false,
    webpackBuildWorker: false,
  });
});

test('build do App Hosting usa dois workers e não repete o typecheck do CI', () => {
  assert.deepEqual(loadBuildConfig({
    COALA_NEXT_BUILD_CPUS: '2',
    COALA_NEXT_SKIP_TYPECHECK: 'true',
    COALA_NEXT_WEBPACK_BUILD_WORKER: 'true',
  }), {
    cpus: 2,
    ignoreBuildErrors: true,
    webpackBuildWorker: true,
  });
});

test('quantidade inválida de workers retorna ao padrão conservador', () => {
  assert.equal(loadBuildConfig({ COALA_NEXT_BUILD_CPUS: 'invalid' }).cpus, 1);
  assert.equal(loadBuildConfig({ COALA_NEXT_BUILD_CPUS: '0' }).cpus, 1);
});

test('variáveis de otimização ficam restritas à fase BUILD do App Hosting', () => {
  const source = readFileSync(resolve(repositoryRoot, 'apphosting.yaml'), 'utf8');
  const expectedValues = new Map([
    ['COALA_NEXT_BUILD_CPUS', '2'],
    ['COALA_NEXT_SKIP_TYPECHECK', 'true'],
    ['COALA_NEXT_WEBPACK_BUILD_WORKER', 'true'],
  ]);

  for (const [variable, value] of expectedValues) {
    const block = appHostingEnvBlock(source, variable);
    assert.match(block, new RegExp(`value: "${value}"`));
    assert.match(block, /availability:\n\s+- BUILD/);
    assert.doesNotMatch(block, /- RUNTIME/);
  }
});
