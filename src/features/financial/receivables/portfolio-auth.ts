import { createHash, timingSafeEqual } from "node:crypto";

/** Secret Manager may preserve a final newline from secret creation. Treat the
 * shared credential as a single token on both sides of the HTTP boundary. */
export function verifyStonePortfolioSyncSecret(header: string | null, configuredSecret: string | undefined) {
  const expected = configuredSecret?.trim();
  const received = header?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
  if (!expected || !/^[A-Za-z0-9_-]{32,256}$/.test(expected) || !received) return false;
  return timingSafeEqual(createHash("sha256").update(expected).digest(),
    createHash("sha256").update(received).digest());
}
