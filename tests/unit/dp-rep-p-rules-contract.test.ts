import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('REP-P ARP isolation', () => {
  it('lives in a dedicated database denied to every direct client', () => {
    const config = JSON.parse(readFileSync('firebase.json', 'utf8'));
    assert.ok(config.firestore.some((item: { database: string; rules: string; indexes: string }) => item.database === 'coala-rep-p'
      && item.rules === 'firestore.rep.rules' && item.indexes === 'firestore.rep.indexes.json'));
    assert.match(readFileSync('src/features/dp/rep-p/service.server.ts', 'utf8'), /repDb: repPDbAdmin/);
    assert.match(readFileSync('firestore.rep.rules', 'utf8'), /match \/\{document=\*\*\} \{[\s\S]*allow read, write: if false;/);
    const indexes = JSON.parse(readFileSync('firestore.rep.indexes.json', 'utf8')).indexes as { collectionGroup: string }[];
    assert.ok(indexes.some((index) => index.collectionGroup === 'repP_events'));
    assert.ok(indexes.some((index) => index.collectionGroup === 'repP_receipts'));
    const overrides = JSON.parse(readFileSync('firestore.rep.indexes.json', 'utf8')).fieldOverrides as Array<Record<string, unknown>>;
    assert.ok(overrides.some((entry) => entry.collectionGroup === 'repP_locationEvidence'
      && entry.fieldPath === 'expiresAt' && entry.ttl === true));
    const hrOverrides = JSON.parse(readFileSync('firestore.rh.indexes.json', 'utf8')).fieldOverrides as Array<Record<string, unknown>>;
    assert.ok(hrOverrides.some((entry) => entry.collectionGroup === 'dp_timeRecordingAccessAudit'
      && entry.fieldPath === 'expiresAt' && entry.ttl === true));
    const appHosting = readFileSync('apphosting.yaml', 'utf8');
    assert.match(appHosting, /variable: REP_P_FIRESTORE_DATABASE_ID\s+value: "coala-rep-p"/);
    assert.match(appHosting, /variable: REP_P_MARKING_ENABLED\s+value: "true"/);
    assert.match(appHosting, /variable: DP_JOURNEY_LOCATION_ENABLED\s+value: "false"/);
    assert.match(appHosting, /Acompanhamento contínuo aguarda o aditivo do RH/);
  });

  it('rollout nominal só corrige fusos no estado bruto inspecionado e relê todo o catálogo crítico na transação', () => {
    const rollout = readFileSync('scripts/rep-p-pilot-rollout.ts', 'utf8');
    for (const unitId of ['WRyOCQrPPQIn4wJJTXaQ', 'pvLHa7BtW826JmhMkTJA', 'bBIkV8wIXfEz4CuO1F2e', 'kPRLQ14F7XpzSLUFXGyO']) {
      assert.match(rollout, new RegExp(`${unitId}: \\{ from: MISSING_TIME_ZONE, to: PILOT_TIME_ZONE \\}`));
    }
    assert.match(rollout, /current !== plan\.from && current !== plan\.to/);
    assert.match(rollout, /hasOwnProperty\.call\(data, 'timeZone'\)\) return MISSING_TIME_ZONE/);
    assert.doesNotMatch(rollout, /value\.trim\(\) : null/);
    assert.match(rollout, /const currentProfile = await transaction\.get\(state\.profile\.ref\)/);
    assert.match(rollout, /const currentUsers = await transaction\.getAll\(\.\.\.state\.users\.map\(\(user\) => user\.ref\)\)/);
    assert.match(rollout, /const currentUnits = await transaction\.getAll\(\.\.\.state\.units\.map\(\(unit\) => unit\.ref\)\)/);
    assert.match(rollout, /const currentShiftDefinition = await transaction\.get\(state\.shiftDefinition\.ref\)/);
    assert.match(rollout, /const currentSchedule = await transaction\.get\(state\.schedule\.ref\)/);
    assert.match(rollout, /const currentProfileMembers = await transaction\.get\(dbAdmin\.collection\('users'\)\.where\('profileId', '==', PROFILE_ID\)\)/);
    assert.match(rollout, /assertSameDocumentVersion\('Perfil nominal'/);
    assert.match(rollout, /state\.units\.forEach\(\(unit, index\) => assertSameDocumentVersion\(`Unidade \$\{unit\.id\}`/);
    assert.match(rollout, /assertSameQueryVersions\('Membros do perfil nominal'/);
    assert.match(rollout, /if \(current === plan\.from\) \{[\s\S]*?transaction\.update\(unit\.ref, \{ timeZone: plan\.to/);
    assert.match(rollout, /unit_time_zone_changes: timeZoneChanges/);
    assert.doesNotMatch(rollout, /for \(const unit of state\.units\) transaction\.update\(unit\.ref, \{ timeZone:/);
  });
});
