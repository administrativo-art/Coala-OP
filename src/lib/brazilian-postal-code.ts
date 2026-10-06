const BRAZILIAN_POSTAL_CODE = /(?:\bCEP\s*:?[\s-]*)?(\d{5})-?(\d{3})\b/i;

export function extractBrazilianPostalCode(value: string) {
  const match = value.match(BRAZILIAN_POSTAL_CODE);
  return match ? `${match[1]}-${match[2]}` : null;
}
