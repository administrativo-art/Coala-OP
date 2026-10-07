import assert from 'node:assert/strict';
import { test } from 'node:test';
const script = '../../scripts/prepare-replenishment-migration.mjs';
const { prepareReplenishmentMigration } = await import(script);

type Fixture = { commercialKioskIds: string[]; supplyKioskIds: string[]; baseProducts: Array<{
  id: string; isArchived?: boolean; stockLevels: Record<string, { leadTime?: number; min?: number; override?: boolean; supplyMode?: string }>;
}> };
const fixture = (): Fixture => ({ commercialKioskIds: ['a', 'b'], supplyKioskIds: ['cd'], baseProducts: [
  { id: 'lemon', stockLevels: { a: { leadTime: 2 }, b: { leadTime: 3 }, cd: { leadTime: 0, min: 90 } } },
  { id: 'cups', stockLevels: { cd: { leadTime: 50 }, a: { override: true, min: 80 }, b: { supplyMode: 'direct', leadTime: 4 } } },
  { id: 'archived', isArchived: true, stockLevels: { cd: { leadTime: 0 } } },
] });

test('dry-run routes exact lemon ID for every commercial unit, preserves CD positive lead and physical data', () => {
  const input = fixture(), before = structuredClone(input);
  const result = prepareReplenishmentMigration(input, 'lemon');
  assert.equal(result.dryRun, true);
  assert.deepEqual(input, before);
  assert.deepEqual(result.blockers, []);
  const lemon = result.plan.find((row: { baseProductId: string }) => row.baseProductId === 'lemon');
  assert.equal(lemon.stockLevels.a.supplyMode, 'direct');
  assert.equal(lemon.stockLevels.b.supplyMode, 'direct');
  assert.equal(lemon.stockLevels.cd.leadTime, 2);
  assert.equal(result.plan.find((row: { baseProductId: string }) => row.baseProductId === 'cups').stockLevels.cd.leadTime, 50);
  assert.equal(result.plan.find((row: { baseProductId: string }) => row.baseProductId === 'cups').stockLevels.b.supplyMode, 'cd');
  assert.equal(result.plan.find((row: { baseProductId: string }) => row.baseProductId === 'cups').stockLevels.b.leadTime, 2);
  assert.equal(result.plan.some((row: { baseProductId: string }) => row.baseProductId === 'archived'), false);
});

test('migration blocks missing direct lead and rejects unknown/archived lemon or overlapping units', () => {
  const input = fixture(); input.baseProducts[0].stockLevels.a!.leadTime = 0;
  assert.equal(prepareReplenishmentMigration(input, 'lemon').blockers.length, 1);
  assert.throws(() => prepareReplenishmentMigration(fixture(), 'unknown'));
  assert.throws(() => prepareReplenishmentMigration(fixture(), 'archived'));
  assert.throws(() => prepareReplenishmentMigration({ ...fixture(), supplyKioskIds: ['a'] }, 'lemon'));
});
