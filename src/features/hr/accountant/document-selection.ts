import type { OnboardingDocument } from '@/types';

export function isAutomaticAccountantDocument(
  document: Pick<OnboardingDocument, 'id'>,
) {
  return document.id === 'identity_document' || /^child_\d+_/.test(document.id);
}
