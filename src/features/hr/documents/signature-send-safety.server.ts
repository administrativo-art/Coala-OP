import 'server-only';
import { randomUUID } from 'node:crypto';
import type { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import { historicalSignaturePersonKeys } from '@/features/privacy/signature-person-history';
import { AppError } from '@/lib/observability/app-error';

export function signatureOutcomeUnconfirmed() {
  return new AppError({ code: 'SIGNATURE_SEND_OUTCOME_UNCONFIRMED', kind: 'CONFLICT', retryable: false, safeMessage: 'Envio em andamento ou sem confirmação no provedor. Não reenvie nem adicione signatários. É necessária reconciliação com a Autentique antes de outra criação.' });
}
export function assertSignatureCreateClaimable(current: Record<string, unknown>) {
  if (current.providerDocumentId) return false;
  if (current.sendAttemptId || current.sendingStartedAt || ['sending', 'failed', 'send_failed', 'send_unconfirmed'].includes(String(current.status))) throw signatureOutcomeUnconfirmed();
  return true;
}
/** A failed or expired network call never releases the right to create another external document. */
export async function claimSignatureCreate(ref: DocumentReference, data: Record<string, unknown>, expectedUpdateTime?: Timestamp) {
  const attempt = randomUUID();
  return ref.firestore.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!assertSignatureCreateClaimable(current.data() ?? {})) return false;
    if (expectedUpdateTime && !current.updateTime?.isEqual(expectedUpdateTime)) throw new AppError({ code: 'SIGNATURE_PREPARATION_CHANGED', kind: 'CONFLICT', retryable: false, safeMessage: 'O pacote ou o posicionamento mudou. Atualize e confirme a versão atual antes de enviar.' });
    tx.set(ref, { ...data, status: 'sending', sendAttemptId: attempt, sendingStartedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
}


/** Only repair links from the authoritative frozen request, never infer origin from provider names. */
export async function repairSignatureTargetLinks(ref: DocumentReference, onboardingId: string, providerId: string, targets: readonly DocumentReference[]) {
  await ref.firestore.runTransaction(async tx => {
    const request = await tx.get(ref);
    const components = targets.length ? await tx.getAll(...targets) : [];
    const ids = Array.isArray(request.get('workflowDocumentIds')) ? request.get('workflowDocumentIds') as string[] : [request.get('workflowDocumentId')];
    if (!request.exists || request.get('onboardingId') !== onboardingId || request.get('providerDocumentId') !== providerId || ids.length !== components.length || !components.length
      || components.some(component => !component.exists || component.get('onboardingId') !== onboardingId || !ids.includes(component.id)
        || component.get('signatureRequestId') && component.get('signatureRequestId') !== ref.id
        || component.get('providerDocumentId') && component.get('providerDocumentId') !== providerId)) {
      throw new AppError({ code: 'SIGNATURE_RECONCILIATION_ORIGIN_MISMATCH', kind: 'DATA_INTEGRITY', safeMessage: 'Os componentes não correspondem à solicitação original.' });
    }
    historicalSignaturePersonKeys(ref.id, request.data() ?? {});
    for (const component of components) tx.update(component.ref, { signatureRequestId: ref.id, providerDocumentId: providerId });
  });
}
