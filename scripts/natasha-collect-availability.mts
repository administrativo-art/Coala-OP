import { withCoalaSession } from './financial/coala-authenticated-payment.mts';
import { createNatashaAvailabilityApiReader } from './natasha/availability-api-reader';
import { NatashaCollectError } from './natasha/coala-snapshot';

const usage = 'Uso: npm run natasha:collect-availability -- --email <conta> --period AAAA-MM --unit <id> [--unit <id>] --availability-scope\n';

function parseArgs(args: string[]) {
  if (args.includes('--help')) return null;
  let email = '';
  let period = '';
  const unitIds: string[] = [];
  let availabilityScope = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--availability-scope') availabilityScope = true;
    else if (arg === '--email' || arg === '--period' || arg === '--unit') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new NatashaCollectError(`Valor ausente para ${arg}.`);
      if (arg === '--email') {
        if (email) throw new NatashaCollectError('--email repetido.');
        email = value;
      } else if (arg === '--period') {
        if (period) throw new NatashaCollectError('--period repetido.');
        period = value;
      } else unitIds.push(value);
      index += 1;
    } else throw new NatashaCollectError(`Argumento desconhecido: ${arg}.`);
  }
  if (!availabilityScope) throw new NatashaCollectError('Confirme --availability-scope para consultar férias da equipe candidata.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NatashaCollectError('Informe --email válido.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new NatashaCollectError('Informe --period no formato AAAA-MM.');
  if (unitIds.length < 1 || unitIds.length > 5 || new Set(unitIds).size !== unitIds.length
    || unitIds.some((id) => !/^[^\s/?#]{1,180}$/.test(id) || id.includes('::'))) {
    throw new NatashaCollectError('Informe de uma a cinco unidades distintas.');
  }
  return { email, period, unitIds };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (!input) {
    process.stdout.write(usage);
    return;
  }
  const report = await withCoalaSession(input.email, (token) =>
    createNatashaAvailabilityApiReader({ token }).collect(input.period, input.unitIds));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'ready_for_confirmation') process.exitCode = 3;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof NatashaCollectError ? error.message : 'Coleta da disponibilidade não concluída; confira a sessão sem expor credenciais.'}\n${usage}`);
  process.exitCode = 1;
});
