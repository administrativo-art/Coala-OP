import type { CashClosureChannel } from "./channel-normalization";

export type { CashClosureChannel };

export type CashClosureStatus =
  | "not_synced"
  | "draft"
  | "pending_review"
  | "approved"
  | "reopened"
  | "sync_error";

export type CashClosureLineStatus = "pending" | "matched" | "divergent" | "ignored";

export type CashClosureSource = {
  provider: "pdvlegal";
  endpoint: "cupom/get";
  couponCount: number;
  validCouponCount: number;
  ignoredCancelledCouponCount: number;
  estornadoCouponCount: number;
  itemCount: number;
  paymentRowCount: number;
  rawPaymentNames: string[];
  unknownPaymentNames: string[];
  integrityWarnings: string[];
};

export type CashClosureLineMetadata = {
  grossCashCents?: number;
  changeCents?: number;
  paymentRowCount?: number;
};

export type BuiltCashClosureLine = {
  operatorId: string;
  operatorName: string;
  channel: CashClosureChannel;
  channelLabel: string;
  expectedAmountCents: number;
  countedAmountCents: number | null;
  differenceAmountCents: number | null;
  status: CashClosureLineStatus;
  rawPaymentNames: string[];
  metadata: CashClosureLineMetadata;
  note: string | null;
};

/**
 * Saída do motor de fechamento (Fase 1, sem persistência). Cobre apenas o
 * lado "esperado" (PDV) — `countedAmountCents`/status de aprovação nascem
 * `null`/`draft` e são preenchidos nas fases de UI e aprovação (3 e 4).
 */
export type BuiltCashClosure = {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  date: string;
  year: number;
  month: number;
  day: number;
  status: "draft";
  expectedTotalCents: number;
  expectedByChannelCents: Partial<Record<CashClosureChannel, number>>;
  operatorCount: number;
  lines: BuiltCashClosureLine[];
  source: CashClosureSource;
};

export type CashClosureBuildContext = {
  workspaceId: string;
  kioskId: string;
  kioskName: string;
  pdvFilialId: string;
  /** Dia de fechamento alvo, formato yyyy-MM-dd, em America/Belem. */
  date: string;
  /** `usuariorecebimento_id` do PDV → nome legível, de `fetchPdvLegalUsers()`. */
  operatorNameById?: Record<string, string>;
};
