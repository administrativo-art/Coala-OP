import { readFileSync } from 'node:fs';

import { natashaCoveragePlanSchema } from '../src/lib/natasha-roster-coverage';
import { natashaProposalInputsSchema } from '../src/lib/natasha-proposal-preflight';
import { generateNatashaAlternatives, natashaSolverOptionsSchema } from '../src/lib/natasha-roster-solver';
import { natashaRosterSnapshotSchema } from '../src/lib/natasha-roster-validator';

const args = process.argv.slice(2);
const validShape = (args.length === 6 || args.length === 8)
  && args[0] === '--snapshot' && args[2] === '--plan' && args[4] === '--inputs'
  && (args.length === 6 || args[6] === '--options');
if (!validShape) {
  process.stderr.write('Uso: npm run natasha:generate -- --snapshot <historico.json> --plan <demanda.json> --inputs <entradas.json> [--options <opcoes.json>]\n');
  process.exitCode = 1;
} else {
  try {
    const snapshot = natashaRosterSnapshotSchema.parse(JSON.parse(readFileSync(args[1], 'utf8')) as unknown);
    const plan = natashaCoveragePlanSchema.parse(JSON.parse(readFileSync(args[3], 'utf8')) as unknown);
    const inputs = natashaProposalInputsSchema.parse(JSON.parse(readFileSync(args[5], 'utf8')) as unknown);
    const options = args.length === 8
      ? natashaSolverOptionsSchema.parse(JSON.parse(readFileSync(args[7], 'utf8')) as unknown)
      : undefined;
    const report = generateNatashaAlternatives(snapshot, plan, inputs, options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'alternatives' ? 0
      : report.status === 'not_ready' ? 3
        : report.status === 'search_limit' ? 4 : 2;
  } catch {
    process.stderr.write('Entradas inválidas: confira os arquivos e o contrato mensal de geração.\n');
    process.exitCode = 1;
  }
}
