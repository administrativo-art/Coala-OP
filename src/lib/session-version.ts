function normalizedSessionVersion(value: unknown): number | null {
  // Contas e tokens anteriores ao versionamento equivalem à versão zero somente se o campo está ausente.
  if (value === undefined) return 0;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Uma sessão anterior nunca recupera acesso após reativação; versões inválidas falham fechadas. */
export function sessionVersionsMatch(tokenVersion: unknown, storedVersion: unknown): boolean {
  const token = normalizedSessionVersion(tokenVersion);
  const stored = normalizedSessionVersion(storedVersion);
  return token !== null && stored !== null && token === stored;
}
