import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const firebaseRequire = createRequire(require.resolve('firebase-tools/lib/fsAsync.js'));

test('Firebase CLI keeps the callable minimatch and brace-expansion APIs used by fsAsync', async () => {
  const minimatch = firebaseRequire('minimatch') as (path: string, pattern: string) => boolean;
  const minimatchRequire = createRequire(firebaseRequire.resolve('minimatch'));
  const braceExpansion = minimatchRequire('brace-expansion') as (pattern: string) => string[];

  assert.equal(firebaseRequire('minimatch/package.json').version, '3.1.5');
  assert.equal(minimatchRequire('brace-expansion/package.json').version, '1.1.21');
  assert.equal(typeof minimatch, 'function');
  assert.equal(typeof braceExpansion, 'function');
  assert.equal(minimatch('foo', '{foo,bar}'), true);

  const { readdirRecursive } = firebaseRequire('firebase-tools/lib/fsAsync.js') as {
    readdirRecursive: (options: { path: string; ignore: string[]; maxDepth: number }) => Promise<Array<{ name: string }>>;
  };
  const files = await readdirRecursive({ path: 'scripts', ignore: ['*.mjs'], maxDepth: 1 });
  assert.ok(files.length > 0);
  assert.ok(files.every((file) => !file.name.endsWith('.mjs')));
});

test('glob 10 inside Firebase CLI retains its modern minimatch API', () => {
  const globRequire = createRequire(firebaseRequire.resolve('glob'));
  const minimatch = globRequire('minimatch') as { Minimatch: new (pattern: string) => { match: (path: string) => boolean } };
  const { globSync } = firebaseRequire('glob') as { globSync: (pattern: string, options: { cwd: string }) => string[] };

  assert.equal(globRequire('minimatch/package.json').version, '10.2.4');
  assert.equal(new minimatch.Minimatch('*.mjs').match('uber-direct-vpc.mjs'), true);
  assert.ok(globSync('uber-direct-vpc.mjs', { cwd: 'scripts' }).includes('uber-direct-vpc.mjs'));
});
