import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * A ARP oficial do REP-P mora no banco dedicado coala-rep-p. Piloto e PTRP continuam no coala-rh.
 * A norma exige que os originais não sejam apagados nem alterados, direta ou indiretamente
 * (Anexo IX, item 7). Este teste impede os caminhos estáticos de exclusão que o banco
 * compartilhado abriria.
 */
const ARP_WRITERS = [
  'src/features/dp/rep-p/availability.server.ts',
  'src/features/dp/rep-p/competence-fence.server.ts',
  'src/features/dp/rep-p/location-access.server.ts',
  'src/features/dp/rep-p/location-policy.server.ts',
  'src/features/dp/rep-p/monitor.server.ts',
  'src/features/dp/rep-p/offline-cycle.server.ts',
  'src/features/dp/rep-p/service.server.ts',
  'src/features/dp/time-adjustments/service.server.ts',
];

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' || entry === 'lib' ? [] : sources(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(entry) ? [path] : [];
  });
}
const files = [...sources('src'), ...sources('functions/src')].map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('ARP do REP-P protegida contra exclusão no banco dedicado', () => {
  it('only the bounded REP-P services reference repP_ collections', () => {
    assert.deepEqual(files.filter((file) => file.text.includes('repP_')).map((file) => file.path).sort(), [...ARP_WRITERS].sort());
  });

  it('the ARP writers never delete or bulk-write', () => {
    for (const path of ARP_WRITERS) {
      const text = readFileSync(path, 'utf8');
      assert.doesNotMatch(text, /\.delete\(|recursiveDelete|bulkWriter|FieldValue\.delete/, path);
    }
  });

  it('only the adjustment and closure services reference ptrp_ collections, and it never deletes (retenção de 20 anos)', () => {
    // The REP-P and closure services read the competence/classification heads atomically. The remaining
    // closure, mirror, AEJ and time-bank services reach these collections through constants from the adjustment service.
    const PTRP_WRITERS = ['src/features/dp/absences/requests/workflow.server.ts', 'src/features/dp/rep-p/service.server.ts', 'src/features/dp/time-adjustments/aej.server.ts', 'src/features/dp/time-adjustments/closing-package.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/mirror.server.ts', 'src/features/dp/time-adjustments/service.server.ts', 'src/features/dp/time-bank/service.server.ts'];
    assert.deepEqual(files.filter((file) => file.text.includes('ptrp_')).map((file) => file.path).sort(),
      ['src/features/dp/rep-p/service.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/service.server.ts']);
    assert.deepEqual(files.filter((file) => /\b(ADJUSTMENTS|TREATMENTS|CLOSURES|AEJ_EXPORTS)\b[^;]*from '(\.\/|@\/features\/dp\/time-adjustments\/)service\.server'/.test(file.text)).map((file) => file.path).sort(), ['src/features/dp/absences/requests/workflow.server.ts', 'src/features/dp/time-adjustments/aej.server.ts', 'src/features/dp/time-adjustments/closing-package.server.ts', 'src/features/dp/time-adjustments/closure.server.ts', 'src/features/dp/time-adjustments/mirror.server.ts', 'src/features/dp/time-bank/service.server.ts']);
    for (const path of PTRP_WRITERS) {
      assert.doesNotMatch(readFileSync(path, 'utf8'), /\.delete\(|recursiveDelete|bulkWriter|FieldValue\.delete/, path);
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
