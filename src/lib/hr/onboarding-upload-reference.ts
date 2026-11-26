import { AppError } from '@/lib/observability/app-error';

const invalid = () => new AppError({ code: 'ONBOARDING_DOCUMENT_REFERENCE_INVALID', kind: 'VALIDATION', safeMessage: 'O arquivo não pertence a este formulário. Anexe-o novamente pelo link desta admissão.' });

/** Only the flat namespace produced by /api/hr/upload, with a canonical decoded object name. */
export function isOnboardingUploadPath(path: string, token: string) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(token)) return false;
  const parts = path.split('/');
  return parts.length === 4 && parts[0] === 'hr' && parts[1] === 'onboarding' && parts[2] === token
    && /^[a-zA-Z0-9._-]+$/.test(parts[3]) && !['.', '..'].includes(parts[3]);
}

export function onboardingUploadUrlPath(value: unknown, bucket: string) {
  if (typeof value !== 'string' || value.length > 1200) throw invalid();
  try {
    // Match the original string before WHATWG URL can erase raw/encoded dot segments.
    if (/[\\\u0000-\u0020\u007f]/.test(value)) throw invalid();
    const match = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/?#]+)\/o\/([^/?#]+)(?:\?[^#]*)?$/.exec(value);
    if (!match || decodeURIComponent(match[1]) !== bucket) throw invalid();
    const path = decodeURIComponent(match[2]);
    if (path.includes('%') || path.includes('\\') || path.includes('\0')) throw invalid();
    return path;
  } catch { throw invalid(); }
}

export function validateOnboardingUploadReference(input: { token: string; bucket: string; fileUrl: unknown; filePath?: unknown; existingPath?: string | null }) {
  const urlPath = onboardingUploadUrlPath(input.fileUrl, input.bucket);
  const supplied = input.filePath;
  if (supplied != null && typeof supplied !== 'string') throw invalid();
  const path = typeof supplied === 'string' && supplied.trim() ? supplied.trim() : input.existingPath ?? null;
  if (path === null || path.length > 700 || !isOnboardingUploadPath(urlPath, input.token) || !isOnboardingUploadPath(path, input.token) || path !== urlPath) throw invalid();
  return { fileUrl: input.fileUrl as string, filePath: path };
}
