import { AppError, isAppError } from '@/lib/observability/app-error';

// Adapt the existing untyped requireUser failures without classifying DB outages as login errors.
export function rethrowServerAuthenticationFailure(error: unknown): never {
  if (isAppError(error)) throw error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired',
    'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found'].includes(code) ||
    ['Authorization header ausente ou inválido.', 'Usuário inválido.', 'Usuário não encontrado.'].includes(message)) {
    throw new AppError({ code: 'AUTHENTICATION_REQUIRED', kind: 'AUTHENTICATION' });
  }
  if (message === 'Atualização cadastral obrigatória pendente.') {
    throw new AppError({ code: 'PROFILE_COMPLIANCE_REQUIRED', kind: 'AUTHORIZATION' });
  }
  throw error;
}
