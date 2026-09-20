import { InterApiError } from './error';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function safeInterPaymentError(error: unknown, now = new Date().toISOString()) {
  if (error instanceof InterApiError) {
    return {
      code: error.code,
      safeMessage: error.safeMessage,
      occurredAt: now,
    };
  }
  const response = object(object(error).response);
  const status = typeof response.status === 'number' ? response.status : null;
  let safeMessage = 'Não foi possível concluir a comunicação com o Banco Inter. Consulte novamente antes de tentar outro envio.';
  if (status === 422) {
    safeMessage = 'O Banco Inter recusou os dados do pagamento. Revise os dados antes de tentar novamente.';
  }

  return {
    code: status ? `INTER_HTTP_${status}` : 'INTER_REQUEST_FAILED',
    safeMessage,
    occurredAt: now,
  };
}
