import { z } from "zod";
import type { CompositionCmvResult } from "@/lib/product-composition-cmv";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";
import { financialMonthKey } from "../lib/financial-dates";

const identifier = z.string().trim().min(1).max(160).regex(/^[^/]+$/);
const common = { kioskId: identifier, period: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/), expectedRevision: z.number().int().min(0).max(1_000_000) };
export const cmvClosureInputSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("close"), expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), salesReviewed: z.literal(true) }).strict(),
  z.object({ ...common, action: z.literal("reopen"), reason: z.string().trim().min(5).max(1000) }).strict(),
]);
export type CmvClosureInput = z.infer<typeof cmvClosureInputSchema>;
export function canCloseCmvPeriod(period: string, now = new Date()) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(period)
    && period >= FINANCIAL_DRE_START_MONTH_KEY && period < (financialMonthKey(now) ?? "");
}
export type CmvProductSnapshot = { simulationId: string; quantity: number; unitCmv: number; totalCmv: number; composition: CompositionCmvResult };
export type DreCmvPeriod = {
  kioskId: string; period: string; status: "open" | "closed"; revision: number;
  totalCmv: number | null; complete: boolean; diagnostics: string[];
  sourceFingerprint: string; salesFingerprint: string; sourceChanged: boolean;
  closedAt: string | null; closedBy: string | null; calculatedAt: string;
};
export type CmvClosureRecord = {
  workspaceId: string; kioskId: string; period: string; criterion: "composition";
  status: "open" | "closed"; revision: number;
  sourceFingerprint: string; salesFingerprint: string;
  totalCmv: number; products: CmvProductSnapshot[];
  sales: { id: string; kioskId: string; year: number; month: number; day: number | null; items: { sku: string | null; simulationId: string | null; quantity: number | null }[] }[];
  formulaVersion: string; referenceAt: string; closedAt: string; closedBy: string;
  reopenedAt?: string; reopenedBy?: string; reopenReason?: string;
  lastOperation: { action: "close" | "reopen"; expectedRevision: number; actorId: string; requestFingerprint: string };
};
