function belemDateOf(instant: string) {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(timestamp));
}

export function interOverdueQuoteEvidenceMatches(amountCents: unknown, observedAt: unknown, settlementDate: string) {
  return Number.isSafeInteger(amountCents)
    && Number(amountCents) > 0
    && Number(amountCents) <= 100_000_000
    && typeof observedAt === "string"
    && belemDateOf(observedAt) === settlementDate;
}

type InterRejection = { code?: string | null; details?: string | null; occurredAt?: string | null } | null | undefined;

export function interOverdueMinimumCents(error: InterRejection) {
  if (error?.code !== "INTER_HTTP_400" || typeof error.details !== "string" || error.details.length > 2_000) return null;
  const matches = [...error.details.matchAll(/Pagamento mínimo aceito:\s*R\$\s*(\d{1,8})[.,](\d{2})(?!\d)/gi)];
  if (matches.length !== 1) return null;
  const amountCents = Number(matches[0][1]) * 100 + Number(matches[0][2]);
  return Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 100_000_000 ? amountCents : null;
}

/** A bounded, exact amount extracted from the Inter's definitive rejection. */
export function interOverdueQuoteFromRejection(error: InterRejection, settlementDate: string) {
  const amountCents = interOverdueMinimumCents(error);
  if (amountCents === null) return null;
  const observedAt = String(error?.occurredAt ?? "");
  const observedFor = belemDateOf(observedAt);
  if (observedFor !== settlementDate) return null;
  return { amountCents, observedAt, observedFor };
}
