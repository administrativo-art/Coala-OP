// Auditoria única que promove a prontidão operacional de ausências a `ready`.
// Demo: projeto demo-* em emuladores loopback. Produção: `--production`, projeto smart-converter-752gf,
// sem emulador e com a barreira de quiescência confirmada pelo operador (ninguém editando escalas/férias).
// DP_ABSENCE_OPERATIONAL_GUARD=on vale só para este processo; ligar o guard no App Hosting é outro passo.
const PRODUCTION_PROJECT_ID = 'smart-converter-752gf';
const usage = 'Uso: DP_ABSENCE_OPERATIONAL_GUARD=on node --conditions=react-server --import tsx scripts/bootstrap-absence-operational.mts'
  + ' --workspace <id> --from AAAA-MM-DD --through AAAA-MM-DD (--confirm-quiescence | --dry-run) [--max-per-source N] [--production]\n'
  + '--dry-run: uma passada de leitura e validação, sem gravar o recibo e sem exigir quiescência.\n';
if (process.argv.includes('--help')) {
  process.stdout.write(usage);
} else {
  const args = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index < 0 ? null : args[index + 1] ?? null;
  };
  const workspaceId = value('--workspace');
  const coverageFrom = value('--from');
  const coverageThrough = value('--through');
  const maxPerSourceRaw = value('--max-per-source');
  const maxPerSource = maxPerSourceRaw === null ? undefined : Number(maxPerSourceRaw);
  const production = args.includes('--production');
  const dryRun = args.includes('--dry-run');
  const quiescence = args.includes('--confirm-quiescence');
  const valued = new Set(['--workspace', '--from', '--through', '--max-per-source']);
  const allowed = new Set([...valued, '--confirm-quiescence', '--production', '--dry-run']);
  const expectedLength = 6 + (quiescence ? 1 : 0) + (maxPerSourceRaw === null ? 0 : 2) + (production ? 1 : 0)
    + (dryRun ? 1 : 0);
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
  const emulatorOk = loopback.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')
    && loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')
    && /^demo-[a-z0-9-]+$/.test(process.env.FIREBASE_PROJECT_ID ?? '')
    && process.env.NODE_ENV !== 'production';
  const productionOk = !process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST
    && (process.env.FIREBASE_PROJECT_ID ?? PRODUCTION_PROJECT_ID) === PRODUCTION_PROJECT_ID;
  if (!workspaceId || !coverageFrom || !coverageThrough || (dryRun ? quiescence : !quiescence)
    || args.length !== expectedLength || new Set(args).size !== args.length
    || args.filter((arg) => arg.startsWith('--')).some((arg) => !allowed.has(arg))
    || (maxPerSource !== undefined && (!Number.isInteger(maxPerSource) || maxPerSource < 1))
    || process.env.DP_ABSENCE_OPERATIONAL_GUARD !== 'on'
    || (production ? !productionOk : !emulatorOk)) {
    process.stderr.write(`Bootstrap indisponível: escopo explícito e ambiente demo (emuladores) ou --production sem emulador.\n${usage}`);
    process.exitCode = 1;
  } else if (dryRun) {
    const { auditAbsenceOperationalSources } = await import('../src/features/dp/absences/operational/bootstrap.server');
    const result = await auditAbsenceOperationalSources({ workspaceId, coverageFrom, coverageThrough, maxPerSource })
      .catch((error: unknown) => ({ mode: 'dry_run', valid: false, reason: error instanceof Error ? error.message : 'falha' }));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.valid) process.exitCode = 2;
  } else {
    const { bootstrapAbsenceOperationalReadiness } = await import('../src/features/dp/absences/operational/bootstrap.server');
    const result = await bootstrapAbsenceOperationalReadiness({ workspaceId, coverageFrom, coverageThrough,
      quiescenceConfirmed: true, maxPerSource }).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Bootstrap falhou.'}\n`);
      return null;
    });
    if (!result) {
      process.stderr.write('Bootstrap incompleto; readiness não foi promovida a ready. Revise fontes e repita sob quiescência.\n');
      process.exitCode = 2;
    } else process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
