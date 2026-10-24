import type { FinancialInboxClassification } from "./types";

type BankPaymentSnapshot = {
  amount?: unknown;
  barcodeSnapshot?: unknown;
};

function positiveAmountCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  return Number.isInteger(cents) && cents > 0 ? cents : null;
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

/**
 * A bank request is a server-side snapshot of the values that passed the
 * payment preflight. Use it only to fill missing evidence fields; never let
 * it replace a value that was subsequently corrected on the inbox message.
 */
export function classificationWithPaymentSnapshot(
  classification: FinancialInboxClassification,
  payment: BankPaymentSnapshot,
) {
  const snapshot = payment.barcodeSnapshot && typeof payment.barcodeSnapshot === "object"
    ? payment.barcodeSnapshot as Record<string, unknown>
    : null;
  if (!snapshot) return classification;

  const amountCents = classification.amountCents ?? positiveAmountCents(payment.amount);
  const barcode = classification.barcode || text(snapshot.code);
  const barcodeMasked = classification.barcodeMasked || text(snapshot.maskedCode);
  const supplierTaxId = classification.billingIdentity?.supplierTaxId
    || text(snapshot.beneficiaryDocument)?.replace(/\D/g, "")
    || null;
  const currentIdentity = classification.billingIdentity;
  const billingIdentity = supplierTaxId && (currentIdentity || snapshot.beneficiaryDocument)
    ? {
        supplierTaxId,
        customerAccount: currentIdentity?.customerAccount ?? null,
        contractNumber: currentIdentity?.contractNumber ?? null,
        serviceType: currentIdentity?.serviceType ?? null,
        serviceNumbers: currentIdentity?.serviceNumbers ?? [],
      }
    : currentIdentity;

  return {
    ...classification,
    amountCents,
    dueDate: classification.dueDate || text(snapshot.dueDate),
    barcode,
    barcodeMasked,
    billingIdentity,
  };
}
