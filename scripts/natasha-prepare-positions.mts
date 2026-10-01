import { readFileSync } from 'node:fs';

import { natashaPositionDecisionsSchema, prepareNatashaPositions } from '../src/lib/natasha-position-source';
import { natashaCoveragePlanSchema } from '../src/lib/natasha-roster-coverage';
import { natashaShiftDirectoryReportSchema } from '../src/lib/natasha-shift-directory';

const args = process.argv.slice(2);
const usage = 'Uso: npm run natasha:prepare-positions -- --plan <demanda.json> --shifts <definicoes.json> --decisions <decisoes.json>\n';

function value(flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (args.includes('--help')) {
  process.stdout.write(usage);
} else {
  const planPath = value('--plan');
  const shiftsPath = value('--shifts');
  const decisionsPath = value('--decisions');
  const known = new Set(['--plan', '--shifts', '--decisions']);
  const flags = args.filter((argument) => argument.startsWith('--'));
  if (!planPath || !shiftsPath || !decisionsPath || flags.some((flag) => !known.has(flag)) || args.length !== 6) {
    process.stderr.write(usage);
    process.exitCode = 1;
  } else {
    try {
      const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync(planPath, 'utf8')) as unknown);
      const shifts = natashaShiftDirectoryReportSchema.parse(JSON.parse(readFileSync(shiftsPath, 'utf8')) as unknown);
      const decisions = natashaPositionDecisionsSchema.parse(JSON.parse(readFileSync(decisionsPath, 'utf8')) as unknown);
      const report = prepareNatashaPositions(plan, shifts, decisions);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === 'ready_for_preflight' ? 0 : report.status === 'coverage_gaps' ? 2 : 3;
    } catch {
      process.stderr.write(`Fontes de posição inválidas: confira demanda, definições, horários e decisões.\n${usage}`);
      process.exitCode = 1;
    }
  }
}
