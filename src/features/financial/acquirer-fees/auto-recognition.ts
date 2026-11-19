import { z } from "zod";
import type { FeeRecognitionBatch, FeeRecognitionPreview, FeeRecognitionRecord } from "./recognition-contracts";

export const AUTO_ACTOR_ID = "system:acquirer-fee-auto";
export const AUTO_MODES = ["off", "simulation", "active"] as const;
export type AutoMode = (typeof AUTO_MODES)[number];
export const autoModeSchema = z.enum(AUTO_MODES);
export const settableAutoModeSchema = autoModeSchema;
export const AUTO_WINDOW_DAYS = 3;
export const AUTO_MAX_PENDING = 40;

export type AutoPending = { date: string; source: "pix" | "cards"; reason: string };
export type AutoPendingReview = Pick<AutoPending, "date" | "source"> & {
  checkedAt: string;
  reasons: string[];
  truncated: boolean;
};

export function pendingReview(items: AutoPending[], date: string, source: AutoPending["source"], checkedAt: string): AutoPendingReview {
  const reasons = [...new Set(items.map(item => item.reason))];
  return { date, source, checkedAt, reasons: reasons.slice(0, 8).map(reason => reason.slice(0, 200)), truncated: reasons.length > 8 || reasons.some(reason => reason.length > 200) };
}

export type AutoRunSummary = { at: string; mode: Exclude<AutoMode, "off">; dates: string[]; recognized: number; wouldRecognize: number; amountCents: number; alreadyDone: number; pending: AutoPending[]; pendingTruncated: boolean };

export type AutoDecision = { eligible: FeeRecognitionBatch[]; alreadyDone: number; pending: string[] };

/** Decide, sem escrever, quais grupos de taxa passam no portão do reconhecimento automático. */
export function decideAutoBatches(preview: FeeRecognitionPreview): AutoDecision {
  const pending: string[] = [];
  let alreadyDone = 0;
  const eligible: FeeRecognitionBatch[] = [];
  if (!preview.policy?.enabled) return { eligible, alreadyDone, pending: ["Apuração não habilitada para a unidade."] };
  if (preview.autoBlockedReason) return { eligible, alreadyDone, pending: [preview.autoBlockedReason] };
  if (preview.centers.length !== 1) return { eligible, alreadyDone, pending: [preview.centers.length ? "Mais de um centro de resultado exclusivo na unidade." : "Nenhum centro de resultado exclusivo na unidade."] };
  const byId = new Map<string, FeeRecognitionRecord>(preview.records.map(record => [record.id, record]));
  for (const batch of preview.batches) {
    const label = `${batch.kind === "pix" ? "PIX" : batch.kind === "mdr" ? "Cartão" : "Antecipação"} ${batch.soldOn}`;
    const record = byId.get(batch.id);
    if (record?.active && record.batch.fingerprint === batch.fingerprint && record.policyVersion === preview.policy.version) { alreadyDone += 1; continue; }
    if (record) { pending.push(`${label}: já havia apuração e a origem mudou ou foi estornada; revisar manualmente.`); continue; }
    if (batch.kind === "anticipation") { pending.push(`${label}: antecipação exige revisão manual.`); continue; }
    if (batch.amountCents <= 0) continue;
    if (batch.measurement !== "assessed") { pending.push(`${label}: taxa estimada (não apurada pela adquirente); o automático só aceita taxa apurada.`); continue; }
    eligible.push(batch);
  }
  for (const record of preview.records) {
    if (record.active && !preview.batches.some(batch => batch.id === record.id)) {
      pending.push(`${record.batch.soldOn}: a origem de uma taxa lançada não aparece mais na prévia; revisar manualmente.`);
    }
  }
  for (const text of preview.pending) pending.push(text);
  return { eligible, alreadyDone, pending };
}

/** Datas D-1 … D-N em ordem cronológica; nunca inclui o dia atual. */
export function autoWindow(today: string, days = AUTO_WINDOW_DAYS): string[] {
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: days }, (_, index) => { const day = new Date(base); day.setUTCDate(day.getUTCDate() - (days - index)); return day.toISOString().slice(0, 10); });
}
