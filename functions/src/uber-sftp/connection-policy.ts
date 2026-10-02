export const SFTP_READY_TIMEOUT_MS = 90_000;
export const SFTP_CONNECTION_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 15_000] as const;

const RETRYABLE_CODES = new Set([
  'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENOTFOUND', 'ERR_GENERIC_CLIENT', 'ETIMEDOUT',
]);

export function sftpConnectionRetryDelay(attempt: number, error: unknown): number | null {
  const delay = RETRY_DELAYS_MS[attempt - 1];
  if (!delay || !(error instanceof Error)) return null;
  const message = error.message.toLocaleLowerCase('en-US');
  if (/authentication|host denied|fingerprint|private\s*key|unsupported key/.test(message)) return null;
  const code = 'code' in error && typeof error.code === 'string' ? error.code.toUpperCase() : '';
  return RETRYABLE_CODES.has(code)
    || /timed?\s*out|connection (?:closed|lost|reset|refused)|socket closed/.test(message)
    ? delay : null;
}
