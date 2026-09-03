export const UNDEFINED_DP_UNIT_CITY = 'Sem cidade definida';

function cleanLabel(value: string | undefined) {
  const cleaned = value?.trim().replace(/\s+/g, ' ');
  return cleaned || undefined;
}

export function extractCityFromDPUnitAddress(address: string | undefined) {
  const cleanedAddress = cleanLabel(address);
  if (!cleanedAddress) return undefined;

  const cityAndState = cleanedAddress.match(
    /(?:^|,)\s*([^,]+?)\s*[-/]\s*[A-Z]{2}(?:\s*,\s*\d{5}-?\d{3})?\s*$/i,
  );
  if (cityAndState?.[1]) return cleanLabel(cityAndState[1]);

  const parts = cleanedAddress
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^\d{5}-?\d{3}$/.test(part));
  const lastPart = parts.at(-1);
  if (lastPart && /^[A-Z]{2}$/i.test(lastPart)) {
    return cleanLabel(parts.at(-2));
  }

  return undefined;
}

export function resolveDPUnitCity({
  calendarCity,
  address,
  groupName,
}: {
  calendarCity?: string;
  address?: string;
  groupName?: string;
}) {
  return cleanLabel(calendarCity)
    ?? extractCityFromDPUnitAddress(address)
    ?? cleanLabel(groupName)
    ?? UNDEFINED_DP_UNIT_CITY;
}
