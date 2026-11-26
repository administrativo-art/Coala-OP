import 'server-only';
import { AppError } from '@/lib/observability/app-error';
import { confirmedOnboardingPublicPrefix } from './onboarding-upload-scope.server';
import { validateOnboardingUploadReference } from './onboarding-upload-reference';

/** Defense for legacy persisted browser references before any privileged download or email. */
export async function assertOnboardingAttachmentScope(id: string, process: Record<string, unknown>, document: { filePath?: string | null; fileUrl?: string | null }, bucket: string) {
  const path = document.filePath ?? '';
  const prefix = await confirmedOnboardingPublicPrefix(id, process, path);
  if (!prefix) throw new AppError({ code: 'ONBOARDING_ATTACHMENT_SCOPE_UNPROVEN', kind: 'CONFLICT', safeMessage: 'Um anexo não tem origem comprovada nesta admissão. Reenvie o arquivo pelo formulário antes de enviá-lo ao contador.' });
  const token = prefix.split('/')[2];
  const fileUrl = document.fileUrl || `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
  validateOnboardingUploadReference({ token, bucket, fileUrl, filePath: path });
}
