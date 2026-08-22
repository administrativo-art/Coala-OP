import { createHash } from 'node:crypto';

import { normalizeBrazilianDocument } from '@/features/financial/beneficiaries/normalization';

export function paymentReceiverMatchesSnapshot(input: {
  receiverDocument: unknown;
  snapshotDocument: unknown;
  snapshotDocumentHash?: string | null;
}) {
  const receiver = normalizeBrazilianDocument(input.receiverDocument);
  const snapshot = normalizeBrazilianDocument(input.snapshotDocument);
  if (!receiver || !snapshot) return true;
  if (input.snapshotDocumentHash) {
    return createHash('sha256').update(receiver).digest('hex') === input.snapshotDocumentHash;
  }
  return receiver.length === snapshot.length && receiver === snapshot;
}
