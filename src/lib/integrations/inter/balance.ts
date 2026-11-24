type InterBalancePayload = { disponivel?: unknown };

/** Saldo disponível informado pelo Inter (`disponivel`, em reais) convertido para centavos. */
export function parseInterBalanceCents(payload: InterBalancePayload | null | undefined) {
  const value = payload?.disponivel;
  const amount = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(amount)) throw new Error("O Banco Inter não informou o saldo disponível.");
  return Math.round(amount * 100);
}
