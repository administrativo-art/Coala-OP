import { createHash } from "node:crypto";
import type { DailySalesResult } from "./query";

export type DailySalesReviewStatus = "closed" | "attention_required" | "awaiting_source";

export type DailySalesReviewSummary = {
  pdvAmountCents: number;
  stoneAmountCents: number;
  autoCheckedCount: number;
  attentionCount: number;
  sourceIssueCount: number;
  uncomparedPdvCount: number;
};

export type DailySalesReviewRecord = {
  schemaVersion: 1;
  workspaceId: string;
  kioskId: string;
  mappingId: string;
  accountId: string;
  stoneCode: string;
  referenceDate: string;
  pdvFilialId: string;
  status: DailySalesReviewStatus;
  revision: number;
  sourceFingerprint: string;
  summary: DailySalesReviewSummary;
  collectedAt: string;
  reviewedAt: string;
  reviewedBy: string;
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedReason: "source_changed" | null;
  snapshotVersion?: 1;
};

export type DailySalesReviewView = {
  id: string;
  status: DailySalesReviewStatus;
  revision: number;
  summary: DailySalesReviewSummary;
  reviewedAt: string;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenedReason: "source_changed" | null;
  sourceChanged: boolean;
  checkedAt: string;
  snapshotAvailable: boolean;
};

export type DailySalesApiResult = DailySalesResult & { review: DailySalesReviewView };

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sorted = <T>(rows: T[]) => [...rows].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
const view = (record: DailySalesReviewRecord, id: string, sourceChanged: boolean, checkedAt: string): DailySalesReviewView => ({
  id, status: record.status, revision: record.revision, summary: record.summary,
  reviewedAt: record.reviewedAt, closedAt: record.closedAt, reopenedAt: record.reopenedAt,
  reopenedReason: record.reopenedReason, sourceChanged, checkedAt,
  snapshotAvailable: record.snapshotVersion === 1,
});

export type DailySalesReviewIdentity = {
  workspaceId: string;
  kioskId: string;
  mappingId: string;
  stoneCode: string;
  referenceDate: string;
};

export function dailySalesReviewIdentityId(identity: DailySalesReviewIdentity) {
  return digest([identity.workspaceId, identity.kioskId, identity.mappingId,
    identity.stoneCode, identity.referenceDate]);
}

export function dailySalesReviewId(result: DailySalesResult) {
  return dailySalesReviewIdentityId({
    workspaceId: result.scope.workspaceId,
    kioskId: result.scope.kioskId,
    mappingId: result.mappingId,
    stoneCode: result.scope.stoneCode,
    referenceDate: result.scope.referenceDate,
  });
}

export function dailySalesSourceFingerprint(result: DailySalesResult) {
  return digest({
    scope: result.scope,
    mappingId: result.mappingId,
    accountId: result.accountId,
    pdvFilialId: result.pdvFilialId,
    stoneFileId: result.stoneFileId,
    pix: result.pix,
    coverage: result.coverage,
    pdvFacts: sorted(result.pdvFacts),
    stoneSales: sorted(result.stoneSales),
    uncomparedPdvFacts: sorted(result.uncomparedPdvFacts),
    issues: sorted(result.issues),
    stoneEvents: sorted(result.stoneEvents),
    cases: sorted(result.cases),
  });
}

export function dailySalesReviewSummary(result: DailySalesResult): DailySalesReviewSummary {
  return {
    pdvAmountCents: result.cases.reduce((sum, row) => sum + row.pdvGrossAmountCents, 0),
    stoneAmountCents: result.cases.reduce((sum, row) => sum + row.stoneGrossAmountCents, 0),
    autoCheckedCount: result.cases.filter(row => row.reviewStatus === "auto_checked").length,
    attentionCount: result.cases.filter(row => row.reviewStatus === "attention_required").length,
    sourceIssueCount: result.issues.length,
    uncomparedPdvCount: result.uncomparedPdvFacts.length,
  };
}

export function dailySalesReviewStatus(result: DailySalesResult): DailySalesReviewStatus {
  const pendingPixSource = result.uncomparedPdvFacts.length > 0
    && ["requested", "pending", "unavailable"].includes(result.pix.status);
  if (pendingPixSource) return "awaiting_source";
  if (result.cases.some(row => row.reviewStatus === "attention_required")
    || result.issues.length > 0 || result.uncomparedPdvFacts.length > 0) return "attention_required";
  return "closed";
}

export function buildDailySalesReviewTransition(input: {
  result: DailySalesResult;
  actorId: string;
  now: string;
  previous?: DailySalesReviewRecord;
}) {
  const id = dailySalesReviewId(input.result);
  const sourceFingerprint = dailySalesSourceFingerprint(input.result);
  const previous = input.previous;
  if (previous?.sourceFingerprint === sourceFingerprint) {
    return {
      write: false as const,
      view: view(previous, id, false, input.now),
    };
  }
  const status = dailySalesReviewStatus(input.result);
  const sourceChanged = previous !== undefined;
  const reopened = previous?.status === "closed" && status !== "closed";
  const next: DailySalesReviewRecord = {
    schemaVersion: 1,
    workspaceId: input.result.scope.workspaceId,
    kioskId: input.result.scope.kioskId,
    mappingId: input.result.mappingId,
    accountId: input.result.accountId,
    stoneCode: input.result.scope.stoneCode,
    referenceDate: input.result.scope.referenceDate,
    pdvFilialId: input.result.pdvFilialId,
    status,
    revision: (previous?.revision ?? 0) + 1,
    sourceFingerprint,
    summary: dailySalesReviewSummary(input.result),
    collectedAt: input.result.collectedAt,
    reviewedAt: input.now,
    reviewedBy: input.actorId,
    closedAt: status === "closed" ? input.now : null,
    closedBy: status === "closed" ? input.actorId : null,
    reopenedAt: reopened ? input.now : status === "closed" ? null : previous?.reopenedAt ?? null,
    reopenedReason: reopened ? "source_changed" : status === "closed" ? null : previous?.reopenedReason ?? null,
  };
  return {
    write: true as const,
    next,
    view: view(next, id, sourceChanged, input.now),
  };
}
