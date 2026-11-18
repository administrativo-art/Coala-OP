import type { SuggestedSalesReconciliationCase } from "./types";

export type UnlinkedResolutionActor =
  | { namespace: "main.users"; id: string }
  | { namespace: "system"; id: string; authorizationReference: string };

export type UnlinkedResolution = {
  caseKey: string;
  evidenceKey: string;
  sourceHash: string;
  justification: string;
  actor: UnlinkedResolutionActor;
  decidedAt: string;
  checkedThrough: string;
  decidedRevision: number;
};

export function applyUnlinkedResolutions(cases: SuggestedSalesReconciliationCase[], resolutions: UnlinkedResolution[]) {
  const byKey = new Map(resolutions.map(resolution => [resolution.caseKey, resolution]));
  return cases.map(row => {
    const { unlinkedResolution, ...original } = row;
    const resolution = byKey.get(row.deterministicKey);
    if (resolution) return { ...original, reviewStatus: "resolved_without_link" as const, unlinkedResolution: resolution };
    return unlinkedResolution || original.reviewStatus === "resolved_without_link"
      ? { ...original, reviewStatus: "attention_required" as const } : original;
  });
}
