// Dry-run only. Reads a local export; never connects to Firestore or writes a patch.
import { readFileSync } from 'node:fs';

export function prepareReplenishmentMigration(input, lemonId) {
  const validId = value => typeof value === 'string' && value.trim() === value && value.length > 0 &&
    value.length <= 256 && !value.includes('/') && !value.includes('.');
  if (!validId(lemonId)) throw new Error('Explicit valid --lemon-id is required.');
  if (!input || !Array.isArray(input.baseProducts) ||
    !Array.isArray(input.commercialKioskIds) || !Array.isArray(input.supplyKioskIds) ||
    ![...input.commercialKioskIds, ...input.supplyKioskIds].every(validId)) {
    throw new Error('Local snapshot and unit identifiers are invalid.');
  }
  const commercialIds = new Set(input.commercialKioskIds ?? []);
  const supplyIds = new Set(input.supplyKioskIds ?? []);
  if (!commercialIds.size || !supplyIds.size) throw new Error('Commercial and supply kiosk lists are required.');
  if ([...commercialIds].some(id => supplyIds.has(id))) throw new Error('A unit cannot be commercial and supply in the same migration.');
  const matchingLemons = (input.baseProducts ?? []).filter(product => product.id === lemonId);
  if (matchingLemons.length !== 1) throw new Error('Lemon ID must identify exactly one base product.');
  if (matchingLemons[0].isArchived === true) throw new Error('Lemon must be an active base product.');
  if (!input.baseProducts.every(product => product && validId(product.id))) throw new Error('Base product IDs are invalid.');
  if (new Set(input.baseProducts.map(product => product.id)).size !== input.baseProducts.length) {
    throw new Error('Duplicate base product IDs in snapshot.');
  }
  const plan = [], blockers = [];
  for (const product of input.baseProducts) {
    if (product.isArchived === true) continue;
    const levels = product.stockLevels ?? {};
    const proposed = {};
    for (const kioskId of commercialIds) {
      const level = levels[kioskId] ?? {};
      if (product.id === lemonId) {
        if (!Number.isFinite(level.leadTime) || level.leadTime <= 0) {
          blockers.push({ baseProductId: product.id, kioskId, reason: 'Compra direta exige prazo local positivo.' });
        }
        proposed[kioskId] = { ...level, supplyMode: 'direct', override: false,
          calculationStatus: 'pending', min: 0 };
      } else {
        proposed[kioskId] = { ...level, supplyMode: 'cd', leadTime: 2,
          override: false, calculationStatus: 'pending', min: 0 };
      }
    }
    for (const kioskId of supplyIds) {
      const level = levels[kioskId] ?? {};
      proposed[kioskId] = { ...level, supplyMode: 'cd', override: false,
        leadTime: Number.isFinite(level.leadTime) && level.leadTime > 0 ? level.leadTime : 2,
        calculationStatus: 'pending', min: 0 };
    }
    if (Object.keys(proposed).length) plan.push({ baseProductId: product.id, stockLevels: proposed });
  }
  return { dryRun: true, lemonId, plan, blockers, note: 'Somente configuração; nenhum lote ou saldo físico é alterado.' };
}

if (process.argv[1]?.endsWith('prepare-replenishment-migration.mjs')) {
  const args = process.argv.slice(2);
  const inputPath = args[args.indexOf('--input') + 1];
  const lemonId = args[args.indexOf('--lemon-id') + 1];
  if (!args.includes('--input') || !args.includes('--lemon-id') || !inputPath || !lemonId) {
    throw new Error('Usage: node scripts/prepare-replenishment-migration.mjs --input snapshot.json --lemon-id BASE_ID');
  }
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  process.stdout.write(JSON.stringify(prepareReplenishmentMigration(input, lemonId), null, 2) + '\n');
}
