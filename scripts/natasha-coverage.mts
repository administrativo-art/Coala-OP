import { readFileSync } from 'node:fs';

import { natashaCoveragePlanSchema, validateNatashaCoverage } from '../src/lib/natasha-roster-coverage';
import { natashaRosterSnapshotSchema } from '../src/lib/natasha-roster-validator';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--plan') {
  process.stderr.write('Uso: npm run natasha:coverage -- --snapshot <snapshot.json> --plan <demanda.json>\n');
  process.exitCode = 1;
} else {
  try {
    const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync(args[1], 'utf8')) as unknown);
    const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync(args[3], 'utf8')) as unknown);
    const report = validateNatashaCoverage(snapshot, plan);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'checked' ? 0 : report.status === 'incomplete' ? 3 : 2;
  } catch {
    process.stderr.write('Entrada inválida: confira os arquivos, datas, unidades e janelas de demanda.\n');
    process.exitCode = 1;
  }
}
