import { withCoalaSession } from './financial/coala-authenticated-payment.mts';
import { NatashaCollectError } from './natasha/coala-snapshot';
import { createNatashaTeamApiReader } from './natasha/team-api-reader';

const usage = 'Uso: npm run natasha:collect-team -- --email <conta> --unit <id> [--unit <id>] --team-scope\n';

function parseArgs(args: string[]) {
  if (args.includes('--help')) return null;
  let email = '';
  const unitIds: string[] = [];
  let teamScope = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--team-scope') teamScope = true;
    else if (arg === '--email' || arg === '--unit') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new NatashaCollectError(`Valor ausente para ${arg}.`);
      if (arg === '--email') {
        if (email) throw new NatashaCollectError('--email repetido.');
        email = value;
      } else unitIds.push(value);
      index += 1;
    } else throw new NatashaCollectError(`Argumento desconhecido: ${arg}.`);
  }
  if (!teamScope) throw new NatashaCollectError('Confirme --team-scope para consultar a equipe candidata.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NatashaCollectError('Informe --email válido.');
  if (unitIds.length < 1 || unitIds.length > 5 || new Set(unitIds).size !== unitIds.length
    || unitIds.some((id) => !/^[^\s/?#]{1,180}$/.test(id) || id.includes('::'))) {
    throw new NatashaCollectError('Informe de uma a cinco unidades distintas.');
  }
  return { email, unitIds };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (!input) {
    process.stdout.write(usage);
    return;
  }
  const report = await withCoalaSession(input.email, (token) =>
    createNatashaTeamApiReader({ token }).collect(input.unitIds));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'ready_for_confirmation') process.exitCode = 3;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof NatashaCollectError ? error.message : 'Coleta da equipe não concluída; confira a sessão sem expor credenciais.'}\n${usage}`);
  process.exitCode = 1;
});
