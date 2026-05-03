import type { DPUnit } from '@/types';

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/quiosque\s*/gi, '')
    .replace(/quisque\s*/gi, '')
    .replace(/centro de distribuicao\s*/gi, '')
    .replace(/[-–_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function matchDPUnitForKiosk(kioskName: string, units: DPUnit[]): DPUnit | undefined {
  const kn = normalizeName(kioskName);
  const exact = units.find(u => {
    const un = normalizeName(u.name);
    return kn === un || kn.includes(un) || un.includes(kn);
  });
  if (exact) return exact;
  let best: DPUnit | undefined;
  let bestDist = Infinity;
  for (const u of units) {
    const un = normalizeName(u.name);
    const d = editDistance(kn, un);
    const threshold = Math.max(3, Math.floor(Math.max(kn.length, un.length) * 0.25));
    if (d < bestDist && d <= threshold) { best = u; bestDist = d; }
  }
  return best;
}
