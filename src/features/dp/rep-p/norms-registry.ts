/**
 * Registro das normas que regem o REP-P/PTRP. Espelha `docs/rep-p/referencias/README.md`;
 * o teste exige que os dois concordem. `lastReviewedAt` nulo significa conferência nunca feita.
 */
export const REP_P_NORMS_REVIEW_INTERVAL_DAYS = 30;

export const REP_P_NORMS_REGISTRY: Readonly<{ lastReviewedAt: string | null }> = Object.freeze({
  lastReviewedAt: '2026-10-18',
});
