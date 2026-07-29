import "server-only";

import { createHash } from "node:crypto";

export const DOCUMENT_PIPELINE_VERSION = "coala-document-pipeline-v3";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

export function canonicalDocumentJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export function buildDocumentGenerationKey(params: {
  templateId: string;
  templateVersion: unknown;
  templateHash: unknown;
  employeeId?: string | null;
  onboardingId?: string | null;
  legalEntityId?: string | null;
  resolvedValues: unknown;
  manualValues: unknown;
  formValues?: unknown;
  letterheadVersion: string;
  revisionKey?: string | null;
}) {
  const digest = createHash("sha256")
    .update(canonicalDocumentJson({
      pipelineVersion: DOCUMENT_PIPELINE_VERSION,
      ...params,
    }))
    .digest("hex");
  return `gen_${digest}`;
}
