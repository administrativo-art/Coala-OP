import { readFileSync } from 'node:fs';

import { natashaCoverageSourceSchema, prepareNatashaCoverageFromCoala } from '../src/lib/natasha-coverage-source';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--input') {
  process.stderr.write('Uso: npm run natasha:prepare-coverage -- --input <fontes-e-confirmacoes.json>\n');
  process.exitCode = 1;
} else {
  try {
    const source = natashaCoverageSourceSchema.parse(JSON.parse(readFileSync(args[1], 'utf8')) as unknown);
    const report = prepareNatashaCoverageFromCoala(source);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'ready_for_preflight' ? 0 : 3;
  } catch {
    process.stderr.write('Fontes inválidas: confira competência, unidades, horários, demanda e confirmações.\n');
    process.exitCode = 1;
  }
}
