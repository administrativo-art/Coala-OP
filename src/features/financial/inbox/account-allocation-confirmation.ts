export type ConfirmedAccountAllocation = { accountPlanId: string; amountCents: number };

export function parseConfirmedAccountAllocations(value: unknown, amountCents: number): ConfirmedAccountAllocation[] {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Array.isArray(value)
    || value.length < 2 || value.length > 20) throw new Error("Apropriações contábeis inválidas.");
  const rows = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).sort().join(",") !== "accountPlanId,amountCents") {
      throw new Error("Apropriações contábeis inválidas.");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.accountPlanId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(row.accountPlanId)
      || !Number.isSafeInteger(row.amountCents) || Number(row.amountCents) <= 0) {
      throw new Error("Conta ou valor de apropriação inválido.");
    }
    return { accountPlanId: row.accountPlanId, amountCents: Number(row.amountCents) };
  });
  if (new Set(rows.map((row) => row.accountPlanId)).size !== rows.length
    || rows.reduce((sum, row) => sum + row.amountCents, 0) !== amountCents) {
    throw new Error("As apropriações devem ter contas distintas e somar o valor confirmado da guia.");
  }
  return rows;
}

export function forecastAllocationsMatchConfirmedAmount(
  forecast: Record<string, unknown>, amountCents: number,
): boolean {
  if (forecast.hasAccountAllocations !== true) return true;
  const rows = forecast.accountAllocations;
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 20) return false;
  const ids = new Set<string>();
  let total = 0;
  for (const entry of rows) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const row = entry as Record<string, unknown>;
    const id = row.accountPlanId;
    const amount = Number(row.amount);
    if (typeof id !== "string" || !id || ids.has(id) || !Number.isFinite(amount) || amount <= 0
      || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) return false;
    ids.add(id);
    total += Math.round(amount * 100);
  }
  return total === amountCents;
}
