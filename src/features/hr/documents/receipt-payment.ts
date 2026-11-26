import { createHash } from "node:crypto";
import { normalizeInterPixKey } from "@/lib/integrations/inter/pix-payments.server";

export type ReceiptPaymentSnapshot = {
  direction: string;
  method: string;
  amountCents: number;
  pixKeyHash: string | null;
  issuerDocumentHash: string | null;
  recipientDocumentHash: string | null;
};

export function receiptPartyDocumentHash(input: unknown) {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits.length === 11 || digits.length === 14 ? createHash("sha256").update(digits).digest("hex") : null;
}

/** Captured from the resolved form at generation; bank details typed in the receipt are never payment instructions. */
export function receiptPaymentSnapshot(values: Record<string, unknown>): ReceiptPaymentSnapshot {
  const receipt = values.receipt && typeof values.receipt === "object" ? values.receipt as Record<string, unknown> : {};
  const payment = receipt.payment && typeof receipt.payment === "object" ? receipt.payment as Record<string, unknown> : {};
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const cents = items.reduce((sum, row) => {
    const value = row && typeof row === "object" ? Number((row as Record<string, unknown>).value) : NaN;
    if (!Number.isFinite(value) || value < 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return NaN;
    return sum + Math.round(value * 100);
  }, 0);
  return {
    direction: String(receipt.direction ?? ""),
    method: String(payment.method ?? ""),
    amountCents: Number.isSafeInteger(cents) ? cents : 0,
    pixKeyHash: typeof payment.pixKey === "string" && payment.pixKey.trim()
      ? createHash("sha256").update(normalizeInterPixKey(payment.pixKey)).digest("hex")
      : null,
    issuerDocumentHash: receiptPartyDocumentHash(receipt.issuer && typeof receipt.issuer === "object" ? (receipt.issuer as Record<string, unknown>).snapshot && typeof (receipt.issuer as Record<string, unknown>).snapshot === "object" ? ((receipt.issuer as Record<string, unknown>).snapshot as Record<string, unknown>).document : null : null),
    recipientDocumentHash: receiptPartyDocumentHash(receipt.recipient && typeof receipt.recipient === "object" ? (receipt.recipient as Record<string, unknown>).snapshot && typeof (receipt.recipient as Record<string, unknown>).snapshot === "object" ? ((receipt.recipient as Record<string, unknown>).snapshot as Record<string, unknown>).document : null : null),
  };
}

export function assertPayableReceipt(snapshot: ReceiptPaymentSnapshot) {
  if (snapshot.direction !== "Pagamos") throw new Error("Somente recibos de saída (Pagamos) podem originar pagamento.");
  if (snapshot.method !== "pix") throw new Error("Selecione Pix no recibo para pagamento pelo Inter.");
  if (!snapshot.pixKeyHash || !/^[a-f0-9]{64}$/.test(snapshot.pixKeyHash)) throw new Error("A chave Pix impressa no recibo é obrigatória para conferir o favorecido.");
  if (!snapshot.issuerDocumentHash || !snapshot.recipientDocumentHash) throw new Error("Os documentos das partes do recibo são necessários para conferir o pagamento.");
  if (!Number.isSafeInteger(snapshot.amountCents) || snapshot.amountCents <= 0 || snapshot.amountCents > 100_000_000) throw new Error("O valor do recibo deve ser positivo e de até R$ 1.000.000,00.");
}

export function receiptPixDestinationMatches(snapshot: ReceiptPaymentSnapshot, pixKey: string | undefined, pixKeyType?: "cpf" | "cnpj" | "email" | "phone" | "random") {
  return Boolean(pixKey && snapshot.pixKeyHash && createHash("sha256").update(normalizeInterPixKey(pixKey, pixKeyType)).digest("hex") === snapshot.pixKeyHash);
}

export function canResumePreparedReceiptPayment(payment: { status?: unknown; submissionStartedAt?: unknown; interRequestId?: unknown }) {
  return payment.status === "ready_to_submit" && !payment.submissionStartedAt && !payment.interRequestId;
}
