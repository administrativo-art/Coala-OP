import { firebaseClientConfig } from '../src/lib/firebase-client-config';
import { withCoalaSession } from './financial/coala-authenticated-payment.mts';
import { buildNatashaSnapshotFromCoala, NatashaCollectError } from './natasha/coala-snapshot';
import { createNatashaFirestoreReader, validateNatashaReadPlan } from './natasha/firestore-reader';

const usage = 'Uso: npm run natasha:collect -- --email <conta> --period AAAA-MM --unit <id> [--unit <id>] --review-target [--history-confirmed] [--all-units-confirmed]\n';

function parseArgs(args: string[]) {
  if (args.includes('--help')) return null;
  let email = '';
  let period = '';
  const unitIds: string[] = [];
  let reviewTarget = false;
  let historyConfirmed = false;
  let allUnitsConfirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--review-target') reviewTarget = true;
    else if (arg === '--history-confirmed') historyConfirmed = true;
    else if (arg === '--all-units-confirmed') allUnitsConfirmed = true;
    else if (['--email', '--period', '--unit'].includes(arg)) {
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
  if (!reviewTarget) throw new NatashaCollectError('Confirme --review-target para consultar a escala do mês solicitado.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NatashaCollectError('Informe --email válido.');
  return { email, plan: validateNatashaReadPlan({ period, unitIds, historyConfirmed, allUnitsConfirmed }) };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (!input) {
    process.stdout.write(usage);
    return;
  }
  const result = await withCoalaSession(input.email, async (token) => {
    const source = await createNatashaFirestoreReader({
      token,
      projectId: firebaseClientConfig.projectId,
    }).collect(input.plan);
    return buildNatashaSnapshotFromCoala(source);
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.snapshot.history?.complete || result.evidence.missingTargetUnitIds.length > 0) process.exitCode = 3;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof NatashaCollectError ? error.message : 'Coleta não concluída; confira a sessão e os parâmetros sem expor credenciais.'}\n${usage}`);
  process.exitCode = 1;
});
