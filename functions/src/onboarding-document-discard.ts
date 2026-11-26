import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
const secret = defineSecret('ONBOARDING_DOCUMENT_DISCARD_SECRET');
const jobUrl = process.env.ONBOARDING_DOCUMENT_DISCARD_URL?.trim() || 'https://op.coalashakes.com/api/jobs/hr/onboarding-document-discard';
const hrDb = getFirestore('coala-rh');
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const id = (v: unknown): v is string => typeof v === 'string' && /^[^/\\\u0000]{1,250}$/.test(v);
async function runJob(onboardingId?: string) {
  const response = await fetch(jobUrl, { method: 'POST', headers: { Authorization: `Bearer ${secret.value()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(onboardingId ? { onboardingId } : {}) });
  if (!response.ok) throw new Error(`Onboarding document discard HTTP ${response.status}`);
}
async function enqueue(onboardingId: string) {
  const ref = hrDb.collection('onboardingProcesses').doc(onboardingId);
  const eligible = await hrDb.runTransaction(async (tx) => {
    const parent = await tx.get(ref);
    if (!parent.exists || parent.get('completedAt') || !parent.get('cancelledAt') && !parent.get('documentDiscard')) return false;
    tx.set(ref, { status: 'cancelled', documentDiscard: { status: 'pending' }, documentDiscardProgress: FieldValue.delete(), documentDiscardRevision: FieldValue.increment(1) }, { merge: true });
    return true;
  });
  if (eligible) await runJob(onboardingId);
}
export const onboardingDocumentDiscardRequested = onDocumentWritten({ document: 'onboardingProcesses/{onboardingId}', database: 'coala-rh', retry: true, maxInstances: 2, secrets: [secret] }, async (event) => {
  const before = event.data?.before.data() ?? {}, after = event.data?.after.data();
  if (!after || !after.documentDiscard || after.completedAt) return;
  const previous = record(before.documentDiscard), current = record(after.documentDiscard);
  // Worker completion clears pointers and updates its result atomically; that is not a new producer write.
  if (current.status === 'completed' && current.updatedAt !== previous.updatedAt && after.status === 'cancelled') return;
  const keys = ['documents', 'asoWorkflow', 'accountantWorkflow', 'pjWorkflow', 'signatureWorkflow', 'documentPromotion'];
  const changedArtifacts = keys.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
  if (!before.documentDiscard || after.status !== 'cancelled' || changedArtifacts) await enqueue(event.params.onboardingId);
});
export const discardLateOnboardingObject = onObjectFinalized({ retry: true, maxInstances: 2, secrets: [secret] }, async (event) => {
  const file = event.data, name = file.name ?? '';
  if (!/^(hr\/onboarding|hr\/employee-documents|generated-documents|signed-documents|signature-packages|signature-documents)\//.test(name)) return;
  let onboardingId: unknown = file.metadata?.onboardingId;
  const parts = name.split('/');
  if (!id(onboardingId) && parts[0] === 'signature-packages') onboardingId = parts[1];
  if (!id(onboardingId) && parts[0] === 'hr' && parts[1] === 'employee-documents' && parts[3] === 'documents' && id(parts[4])) {
    onboardingId = (await hrDb.collection('employeeDocuments').doc(parts[4]).get()).get('sourceOnboardingId');
  }
  if (id(onboardingId)) await enqueue(onboardingId);
});
export const discardLateOnboardingEmployeeDocument = onDocumentWritten({ document: 'employeeDocuments/{documentId}', database: 'coala-rh', retry: true, maxInstances: 2, secrets: [secret] }, async (event) => {
  const after = event.data?.after.data();
  if (!after || after.deletedAt || !['recruitment_onboarding', 'autentique_signature'].includes(String(after.source)) || !id(after.sourceOnboardingId)) return;
  await enqueue(after.sourceOnboardingId);
});
export const retryOnboardingDocumentDiscard = onSchedule({ schedule: 'every 5 minutes', timeZone: 'America/Belem', retryCount: 2, timeoutSeconds: 300, maxInstances: 1, secrets: [secret] }, async () => { await runJob(); });
