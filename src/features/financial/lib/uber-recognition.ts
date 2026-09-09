export type UberRecognitionView = {
  status: 'matched' | 'waiting' | 'ambiguous';
  title: string;
  detail: string | null;
};

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function dateLabel(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function amountLabel(record: Record<string, unknown>) {
  const amount = Number(record.uberTripAmount);
  const currency = text(record.uberTripCurrency).toUpperCase() || 'BRL';
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function uberRecognitionView(record: Record<string, unknown>): UberRecognitionView | null {
  if (record.uberCandidate !== true) return null;
  const status = text(record.uberRecognitionStatus);
  if (status === 'matched') {
    const requester = text(record.uberRequesterName) || text(record.uberRequesterEmail) || 'Solicitante não informado';
    const detail = [
      text(record.uberService),
      dateLabel(record.uberRequestDateLocal),
      amountLabel(record),
      text(record.uberTripId) ? `viagem ${text(record.uberTripId)}` : '',
    ].filter(Boolean).join(' · ');
    return {
      status: 'matched',
      title: `Solicitada por ${requester}`,
      detail: detail || null,
    };
  }
  if (status === 'ambiguous') {
    return {
      status: 'ambiguous',
      title: 'Mais de uma viagem pode corresponder a esta despesa',
      detail: 'Confira o valor, a data e o solicitante antes de concluir a auditoria.',
    };
  }
  return {
    status: 'waiting',
    title: 'Uber identificada; aguardando o relatório diário',
    detail: 'O Coala One tentará novamente quando a Uber disponibilizar a viagem.',
  };
}
