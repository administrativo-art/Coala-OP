import { createHash } from "node:crypto";

import { maskPaymentBarcode, normalizePaymentBarcode } from "./parser";
import type {
  FinancialDocumentIdentity,
  FinancialInboxClassification,
} from "./types";

const CONFIDENCE_RANK: Record<FinancialDocumentIdentity["confidence"], number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function strings(values: unknown, limit = 50) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].slice(0, limit);
}

function confidence(value: unknown): FinancialDocumentIdentity["confidence"] {
  return value === "high" || value === "low" ? value : "medium";
}

export function paymentBarcodeHash(value: string | null | undefined) {
  const barcode = normalizePaymentBarcode(value ?? "");
  return barcode ? createHash("sha256").update(barcode).digest("hex") : null;
}

export function financialDocumentIdentityFromClassification(
  classification: FinancialInboxClassification,
  messageId: string,
): FinancialDocumentIdentity {
  const barcode = normalizePaymentBarcode(classification.barcode ?? "") || null;
  return {
    barcode,
    barcodeMasked: barcode ? maskPaymentBarcode(barcode) : classification.barcodeMasked ?? null,
    barcodeHash: paymentBarcodeHash(barcode),
    documentReferences: strings(classification.documentReferences),
    sourceMessageIds: strings([messageId]),
    confidence: confidence(classification.confidence),
    conflictFields: [],
  };
}

export function normalizeFinancialDocumentIdentity(value: unknown): FinancialDocumentIdentity {
  const source = value && typeof value === "object" ? value as Partial<FinancialDocumentIdentity> : {};
  const barcode = normalizePaymentBarcode(source.barcode ?? "") || null;
  return {
    barcode,
    barcodeMasked: barcode ? maskPaymentBarcode(barcode) : String(source.barcodeMasked ?? "").trim() || null,
    barcodeHash: paymentBarcodeHash(barcode),
    documentReferences: strings(source.documentReferences),
    sourceMessageIds: strings(source.sourceMessageIds),
    confidence: confidence(source.confidence),
    conflictFields: strings(source.conflictFields)
      .filter((field): field is "barcode" => field === "barcode"),
  };
}

export function mergeFinancialDocumentIdentities(
  currentValue: unknown,
  incomingValue: unknown,
): FinancialDocumentIdentity {
  const current = normalizeFinancialDocumentIdentity(currentValue);
  const incoming = normalizeFinancialDocumentIdentity(incomingValue);
  const barcodeConflict = Boolean(current.barcode && incoming.barcode && current.barcode !== incoming.barcode);
  const barcode = current.barcode || incoming.barcode;
  const bestConfidence = CONFIDENCE_RANK[current.confidence] >= CONFIDENCE_RANK[incoming.confidence]
    ? current.confidence
    : incoming.confidence;
  return {
    barcode,
    barcodeMasked: barcode ? maskPaymentBarcode(barcode) : current.barcodeMasked || incoming.barcodeMasked,
    barcodeHash: paymentBarcodeHash(barcode),
    documentReferences: strings([...current.documentReferences, ...incoming.documentReferences]),
    sourceMessageIds: strings([...current.sourceMessageIds, ...incoming.sourceMessageIds]),
    confidence: bestConfidence,
    conflictFields: barcodeConflict
      ? ["barcode"]
      : strings([...current.conflictFields, ...incoming.conflictFields])
        .filter((field): field is "barcode" => field === "barcode"),
  };
}
