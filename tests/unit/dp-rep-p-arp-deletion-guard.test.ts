import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * A ARP oficial do REP-P mora no banco dedicado coala-rep-p. Piloto e PTRP continuam no coala-rh.
 * Este teste delimita referências estáticas e chamadas diretas de mutação/exclusão
 * nos arquivos relacionados à ARP e ao PTRP; a proteção de retenção de 20 anos
 * dos serviços PTRP permanece verificada abaixo.
 */
const ARP_WRITERS = [
  'src/features/dp/rep-p/availability.server.ts',
  'src/features/dp/rep-p/competence-fence.server.ts',
  'src/features/dp/rep-p/location-access.server.ts',
  'src/features/dp/rep-p/location-policy.server.ts',
  'src/features/dp/rep-p/monitor.server.ts',
  'src/features/dp/rep-p/offline-cycle.server.ts',
  'src/features/dp/rep-p/service.server.ts',
  'src/features/dp/time-adjustments/automatic-absence.server.ts',
  'src/features/dp/time-adjustments/service.server.ts',
];

const ARP_READERS = ['src/features/privacy/person-inventory.server.ts'];
const SOURCE_CATALOGS = ['src/features/privacy/person-inventory.ts'];

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' || entry === 'lib' ? [] : sources(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [path] : [];
  });
}
const files = [...sources('src'), ...sources('functions/src')].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

function withoutApprovedScheduleMutations(path: string): string {
  const text = readFileSync(path, 'utf8');
  if (path !== 'src/features/dp/time-adjustments/automatic-absence.server.ts') return text;
  assert.match(text, /const scheduleRef = deps\.mainDb\.collection\('dp_schedules'\)\.doc\(item\.scheduleId\)/, path);
  assert.match(text, /const shiftRef = scheduleRef\.collection\('shifts'\)\.doc\(item\.shiftId\)/, path);
  assert.equal(text.match(/tx\.delete\(shiftRef\)/g)?.length, 1, path);
  assert.equal(text.match(/scheduleSyncError: FieldValue\.delete\(\)/g)?.length, 1, path);
  return text.replace('tx.delete(shiftRef)', '').replace('scheduleSyncError: FieldValue.delete()', '');
}

describe('ARP do REP-P protegida contra exclusão no banco dedicado', () => {
  it('only bounded REP-P services, approved reader and source catalog reference repP_ collections', () => {
    assert.deepEqual(files.filter((file) => file.text.includes('repP_')).map((file) => file.path).sort(), [...ARP_WRITERS, ...ARP_READERS, ...SOURCE_CATALOGS].sort());
  });

  it('approved reader and source catalog contain no direct mutation calls', () => {
    for (const path of [...ARP_READERS, ...SOURCE_CATALOGS]) {
      assert.doesNotMatch(readFileSync(path, 'utf8'), /\.\s*(?:set|update|create|add|delete|batch|bulkWriter|recursiveDelete|runTransaction)\s*\(|\b(?:recursiveDelete|bulkWriter)\b|\bFieldValue\s*\.\s*delete\b/, path);
    }
  });

  it('the ARP writers never delete or bulk-write', () => {
    for (const path of ARP_WRITERS) {
      const text = withoutApprovedScheduleMutations(path);
      assert.doesNotMatch(text, /\.delete\(|recursiveDelete|bulkWriter|FieldValue\.delete/, path);
    }
  });

  it('only bounded services and source catalog reference ptrp_ collections; services never delete (retenção de 20 anos)', () => {
    // The REP-P and closure services read the competence/classification heads atomically. The remaining
    // closure, mirror, AEJ and time-bank services reach these collections through constants from the adjustment service.
    const PTRP_WRITERS = ['src/features/dp/absences/coverage/service.server.ts', 'src/features/dp/absences/requests/workflow.server.ts', 'src/features/dp/rep-p/own-month.server.ts', 'src/features/dp/rep-p/service.server.ts', 'src/features/dp/time-adjustments/aej.server.ts', 'src/features/dp/time-adjustments/automatic-absence.server.ts', 'src/features/dp/time-adjustments/closing-package.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/mirror.server.ts', 'src/features/dp/time-adjustments/service.server.ts', 'src/features/dp/time-bank/service.server.ts'];
    assert.deepEqual(files.filter((file) => file.text.includes('ptrp_')).map((file) => file.path).sort(),
      ['src/features/dp/rep-p/own-month.server.ts', 'src/features/dp/rep-p/service.server.ts', 'src/features/dp/time-adjustments/automatic-absence.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/service.server.ts', ...SOURCE_CATALOGS].sort());
    assert.deepEqual(files.filter((file) => /\b(ADJUSTMENTS|TREATMENTS|CLOSURES|AEJ_EXPORTS)\b[^;]*from '(\.\/|@\/features\/dp\/time-adjustments\/)service\.server'/.test(file.text)).map((file) => file.path).sort(), ['src/features/dp/absences/coverage/service.server.ts', 'src/features/dp/absences/requests/workflow.server.ts', 'src/features/dp/time-adjustments/aej.server.ts', 'src/features/dp/time-adjustments/automatic-absence.server.ts', 'src/features/dp/time-adjustments/closing-package.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/mirror.server.ts', 'src/features/dp/time-bank/service.server.ts']);
    for (const path of PTRP_WRITERS) {
      assert.doesNotMatch(withoutApprovedScheduleMutations(path), /\.delete\(|recursiveDelete|bulkWriter|FieldValue\.delete/, path);
    }
  });

  it('nobody enumerates collections, and recursive deletes on coala-rh only target a queried document', () => {
    for (const file of files) {
      assert.doesNotMatch(file.text, /listCollections\(/, file.path);
      for (const match of file.text.matchAll(/\b(hrDb|hrDbAdmin)\.recursiveDelete\(([^)]*)\)/g)) {
        assert.match(match[2], /^\w+\.ref$/, `${file.path}: recursiveDelete(${match[2]})`);
      }
    }
  });
});
