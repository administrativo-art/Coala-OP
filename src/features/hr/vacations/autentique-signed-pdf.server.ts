import 'server-only';

import { AppError } from '@/lib/observability';

function allowedAutentiqueSignedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && [
      'painel.autentique.com.br',
      'api.autentique.com.br',
      'storage.googleapis.com',
    ].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function downloadVacationAutentiqueSignedPdf(url: string) {
  if (!allowedAutentiqueSignedUrl(url)) {
    throw new AppError({
      code: 'DP_VACATION_SIGNATURE_URL_REJECTED',
      kind: 'SECURITY_INCIDENT',
      safeMessage: 'A origem do documento assinado não foi autorizada.',
    });
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
  if (!response.ok) {
    throw new AppError({
      code: 'DP_VACATION_SIGNATURE_DOWNLOAD_FAILED',
      kind: 'TRANSIENT_EXTERNAL',
      safeMessage: 'O documento assinado ainda não pôde ser arquivado.',
      metadata: { httpStatus: response.status },
    });
  }
  const maxBytes = 30 * 1024 * 1024;
  const announcedLength = Number(response.headers.get('content-length') ?? 0);
  if (announcedLength > maxBytes) {
    throw new AppError({
      code: 'DP_VACATION_SIGNATURE_TOO_LARGE',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O documento assinado ultrapassa o limite permitido.',
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes || buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
    throw new AppError({
      code: 'DP_VACATION_SIGNATURE_INVALID_PDF',
      kind: 'DATA_INTEGRITY',
      safeMessage: 'O arquivo assinado recebido não é um PDF válido.',
    });
  }
  return buffer;
}
