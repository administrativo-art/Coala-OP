const formatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBrlCurrency(value: number) {
  return Number.isFinite(value) ? formatter.format(value) : '';
}

export function parseBrlCurrency(value: string) {
  const sanitized = value.trim().replace(/[^\d,.-]/g, '');
  if (!sanitized) return null;
  let normalized: string;
  if (sanitized.includes(',')) {
    normalized = sanitized.replace(/\./g, '').replace(',', '.');
  } else {
    const dotParts = sanitized.split('.');
    normalized = dotParts.length === 2 && dotParts[1].length <= 2
      ? sanitized
      : sanitized.replace(/\./g, '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
