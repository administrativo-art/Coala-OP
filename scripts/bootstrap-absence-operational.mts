const usage = 'Uso: DP_ABSENCE_OPERATIONAL_GUARD=on node --conditions=react-server --import tsx scripts/bootstrap-absence-operational.mts --workspace <id> --from AAAA-MM-DD --through AAAA-MM-DD --confirm-quiescence\n';
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
  const allowed = new Set(['--workspace', '--from', '--through', '--confirm-quiescence']);
  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
  if (!workspaceId || !coverageFrom || !coverageThrough || !args.includes('--confirm-quiescence')
    || args.length !== 7 || new Set(args).size !== args.length
    || args.filter((arg) => arg.startsWith('--')).some((arg) => !allowed.has(arg))
    || process.env.DP_ABSENCE_OPERATIONAL_GUARD !== 'on'
    || !loopback.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')
    || !loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '')
    || !/^demo-[a-z0-9-]+$/.test(process.env.FIREBASE_PROJECT_ID ?? '')
    || process.env.NODE_ENV === 'production') {
    process.stderr.write(`Bootstrap indisponível fora de emuladores demo e escopo explícito.\n${usage}`);
    process.exitCode = 1;
  } else {
    const { bootstrapAbsenceOperationalReadiness } = await import('../src/features/dp/absences/operational/bootstrap.server');
    const result = await bootstrapAbsenceOperationalReadiness({ workspaceId, coverageFrom, coverageThrough,
      quiescenceConfirmed: true }).catch(() => null);
    if (!result) {
      process.stderr.write('Bootstrap incompleto; readiness não foi promovida a ready. Revise fontes e repita sob quiescência.\n');
      process.exitCode = 2;
    } else process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}
