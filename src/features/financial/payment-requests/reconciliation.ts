import { createHash } from 'node:crypto';

import { normalizeBrazilianDocument } from '@/features/financial/beneficiaries/normalization';

export type PaymentReceiverComparison = "matched" | "divergent" | "unavailable";

type PixStatementEntry = {
  references: string[];
  amount: number;
  operationType: string;
  transactionType: string;
  raw: Record<string, unknown>;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function findExactPixReceiverDocument(
  entries: PixStatementEntry[],
  input: { interRequestId: string; endToEndId?: string | null; amount: number },
) {
  const expectedReferences = new Set([input.interRequestId, input.endToEndId].filter(Boolean));
  const documents = new Set<string>();
  for (const entry of entries) {
    if (entry.operationType.trim().toUpperCase() !== "D") continue;
    if (entry.transactionType.trim().toUpperCase() !== "PIX") continue;
    if (Math.round(Math.abs(entry.amount) * 100) !== Math.round(input.amount * 100)) continue;
    if (!entry.references.some((reference) => expectedReferences.has(reference))) continue;
    const details = record(entry.raw.detalhes ?? entry.raw.details);
    const document = normalizeBrazilianDocument(details.cpfCnpjRecebedor ?? details.receiverDocument);
    if (document && [11, 14].includes(document.length)) documents.add(document);
  }
  return documents.size === 1 ? [...documents][0] : null;
}

export function comparePaymentReceiverToSnapshot(input: {
  receiverDocument: unknown;
  snapshotDocument: unknown;
  snapshotDocumentHash?: string | null;
}): PaymentReceiverComparison {
  const receiver = normalizeBrazilianDocument(input.receiverDocument);
  const snapshot = normalizeBrazilianDocument(input.snapshotDocument);
  // The Pix status endpoint may return values such as ***610293**. Partial
  // documents are evidence neither of equality nor of divergence.
  if (!receiver || ![11, 14].includes(receiver.length)) return "unavailable";
  if (input.snapshotDocumentHash) {
    return createHash('sha256').update(receiver).digest('hex') === input.snapshotDocumentHash
      ? "matched"
      : "divergent";
  }
  if (!snapshot || ![11, 14].includes(snapshot.length)) return "unavailable";
  return receiver.length === snapshot.length && receiver === snapshot
    ? "matched"
    : "divergent";
}

export function paymentReceiverMatchesSnapshot(input: {
  receiverDocument: unknown;
  snapshotDocument: unknown;
  snapshotDocumentHash?: string | null;
}) {
  return comparePaymentReceiverToSnapshot(input) !== "divergent";
}
