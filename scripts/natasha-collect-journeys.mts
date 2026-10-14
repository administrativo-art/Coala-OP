import { withCoalaSession } from './financial/coala-authenticated-payment.mts';
import { NatashaCollectError } from './natasha/coala-snapshot';
import { createNatashaJourneyApiReader } from './natasha/journey-api-reader';

const usage = 'Uso: npm run natasha:collect-journeys -- --email <conta> --period AAAA-MM --unit <id> [--unit <id>] --employee <id> [--employee <id>] --journey-scope\n';

function parseArgs(args: string[]) {
  if (args.includes('--help')) return null;
  let email = '';
  let period = '';
  let journeyScope = false;
  const unitIds: string[] = [];
  const employeeIds: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--journey-scope') journeyScope = true;
    else if (arg === '--email' || arg === '--period' || arg === '--unit' || arg === '--employee') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new NatashaCollectError(`Valor ausente para ${arg}.`);
      if (arg === '--email') {
        if (email) throw new NatashaCollectError('--email repetido.');
        email = value;
      } else if (arg === '--period') {
        if (period) throw new NatashaCollectError('--period repetido.');
        period = value;
      } else if (arg === '--unit') unitIds.push(value);
      else employeeIds.push(value);
      index += 1;
    } else throw new NatashaCollectError(`Argumento desconhecido: ${arg}.`);
  }
  if (!journeyScope) throw new NatashaCollectError('Confirme --journey-scope para resolver as jornadas da equipe confirmada.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NatashaCollectError('Informe --email válido.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new NatashaCollectError('Informe --period no formato AAAA-MM.');
  const validId = (id: string) => /^[^\s/?#]{1,180}$/.test(id) && !id.includes('::');
  if (unitIds.length < 1 || unitIds.length > 5 || new Set(unitIds).size !== unitIds.length || unitIds.some((id) => !validId(id))) {
    throw new NatashaCollectError('Informe de uma a cinco unidades distintas.');
  }
  if (employeeIds.length < 1 || employeeIds.length > 50 || new Set(employeeIds).size !== employeeIds.length
    || employeeIds.some((id) => !validId(id))) {
    throw new NatashaCollectError('Informe de um a cinquenta colaboradores distintos da equipe confirmada.');
  }
  return { email, period, unitIds, employeeIds };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (!input) {
    process.stdout.write(usage);
    return;
  }
  const report = await withCoalaSession(input.email, (token) =>
    createNatashaJourneyApiReader({ token }).collect(input.period, input.unitIds, input.employeeIds));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'ready_for_proposal') process.exitCode = 3;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof NatashaCollectError ? error.message : 'Resolução das jornadas não concluída; confira a sessão sem expor credenciais.'}\n${usage}`);
  process.exitCode = 1;
});
