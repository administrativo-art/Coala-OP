import { InterApiError, interResponseDetails } from './error';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function safeInterPaymentError(error: unknown, now = new Date().toISOString()) {
  if (error instanceof InterApiError) {
    const rejected = error.statusCode === 400 || error.statusCode === 422;
    const genericInterMessage = 'Não foi possível concluir a comunicação com o Banco Inter.';
    return {
      code: error.code,
      safeMessage: rejected && error.safeMessage === genericInterMessage
        ? 'O Banco Inter recusou os dados do pagamento. Revise os dados antes de tentar novamente.'
        : error.safeMessage,
      occurredAt: now,
      ...(error.responseDetails ? { details: error.responseDetails } : {}),
    };
  }
  const response = object(object(error).response);
  const status = typeof response.status === 'number' ? response.status : null;
  let safeMessage = 'Não foi possível concluir a comunicação com o Banco Inter. Consulte novamente antes de tentar outro envio.';
  if (status === 422) {
    safeMessage = 'O Banco Inter recusou os dados do pagamento. Revise os dados antes de tentar novamente.';
  }
  const details = interResponseDetails(error);

  return {
    code: status ? `INTER_HTTP_${status}` : 'INTER_REQUEST_FAILED',
    safeMessage,
    occurredAt: now,
    ...(details ? { details } : {}),
  };
}
