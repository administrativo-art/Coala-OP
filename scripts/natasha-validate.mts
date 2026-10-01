import { readFileSync } from 'node:fs';

import { natashaRosterSnapshotSchema, validateNatashaRoster } from '../src/lib/natasha-roster-validator';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--input') {
  process.stderr.write('Uso: npm run natasha:validate -- --input <snapshot.json>\n');
  process.exitCode = 1;
} else {
  try {
    const raw: unknown = JSON.parse(readFileSync(args[1], 'utf8'));
    const parsed = natashaRosterSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      process.stderr.write(`${JSON.stringify({
        status: 'invalid_input',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }, null, 2)}\n`);
      process.exitCode = 1;
    } else {
      const report = validateNatashaRoster(parsed.data);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === 'checked' ? 0 : report.status === 'incomplete' ? 3 : 2;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'invalid_input',
      message: error instanceof SyntaxError ? 'JSON inválido.' : 'Não foi possível ler o arquivo informado.',
    })}\n`);
    process.exitCode = 1;
  }
}
