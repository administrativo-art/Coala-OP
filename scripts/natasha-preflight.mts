import { readFileSync } from 'node:fs';

import { natashaCoveragePlanSchema } from '../src/lib/natasha-roster-coverage';
import { natashaProposalInputsSchema, assessNatashaProposalInputs } from '../src/lib/natasha-proposal-preflight';
import { natashaRosterSnapshotSchema } from '../src/lib/natasha-roster-validator';

const args = process.argv.slice(2);
if (args.length !== 6 || args[0] !== '--snapshot' || args[2] !== '--plan' || args[4] !== '--inputs') {
  process.stderr.write('Uso: npm run natasha:preflight -- --snapshot <historico.json> --plan <demanda.json> --inputs <entradas.json>\n');
  process.exitCode = 1;
} else {
  try {
    const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync(args[1], 'utf8')) as unknown);
    const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync(args[3], 'utf8')) as unknown);
    const inputs = natashaProposalInputsSchema.parse(JSON.parse(readFileSync(args[5], 'utf8')) as unknown);
    const report = assessNatashaProposalInputs(snapshot, plan, inputs);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'ready_for_solver' ? 0 : report.status === 'questions_pending' ? 3 : 2;
  } catch {
    process.stderr.write('Entradas inválidas: confira os arquivos e o contrato mensal de pré-voo.\n');
    process.exitCode = 1;
  }
}
