type InterErrorBody = {
  title?: unknown;
  detail?: unknown;
  violacoes?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeText(value: unknown) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail ocultado]')
    .replace(/\+?\d[\d\s()./-]{6,}\d/g, '[dado ocultado]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function safeInterPaymentError(error: unknown, now = new Date().toISOString()) {
  const response = object(object(error).response);
  const status = typeof response.status === 'number' ? response.status : null;
  const body = object(response.data) as InterErrorBody;
  const violations = Array.isArray(body.violacoes)
    ? body.violacoes.slice(0, 3).flatMap((entry) => {
        const violation = object(entry);
        const property = safeText(violation.propriedade);
        const reason = safeText(violation.razao);
        return reason ? [`${property ? `${property}: ` : ''}${reason}`] : [];
      })
    : [];
  const bankDetail = violations.join('; ') || safeText(body.detail) || safeText(body.title);

  let safeMessage = 'Não foi possível concluir a comunicação com o Banco Inter. Consulte novamente antes de tentar outro envio.';
  if (status === 422) {
    safeMessage = bankDetail
      ? `O Banco Inter recusou os dados do pagamento: ${bankDetail}`
      : 'O Banco Inter recusou os dados do pagamento. Confirme se a chave Pix está ativa e pertence ao favorecido antes de tentar novamente.';
  } else if (!status) {
    const localMessage = safeText(object(error).message);
    if (localMessage && !/^request failed/i.test(localMessage)) safeMessage = localMessage;
  }

  return {
    code: status ? `INTER_HTTP_${status}` : 'INTER_REQUEST_FAILED',
    safeMessage,
    occurredAt: now,
  };
}
