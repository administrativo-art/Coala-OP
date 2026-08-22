export type AsoClinicLocation = {
  name: string;
  address: string;
  city: string;
  reference: string | null;
  mapsUrl: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function clinicLocationFromConfig(clinicName: unknown, addressValue: unknown): AsoClinicLocation | null {
  const address = record(addressValue);
  const street = text(address.street);
  const number = text(address.number);
  const district = text(address.district);
  const cityName = text(address.city);
  const state = text(address.state).toUpperCase();
  const postalCode = text(address.postalCode);
  if (!street || !number || !district || !cityName || !state || !postalCode) return null;

  const complement = text(address.complement);
  const addressLine = [
    `${street}, ${number}`,
    complement || null,
    district,
  ].filter(Boolean).join(' · ');
  const cityLine = `${cityName}/${state} · CEP ${postalCode}`;
  const mapsUrl = text(address.mapsUrl)
    || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${addressLine}, ${cityLine}`)}`;
  return {
    name: text(clinicName) || 'Clínica do ASO',
    address: addressLine,
    city: cityLine,
    reference: text(address.reference) || null,
    mapsUrl,
  };
}

export function readClinicLocation(value: unknown): AsoClinicLocation | null {
  const location = record(value);
  const name = text(location.name);
  const address = text(location.address);
  const city = text(location.city);
  const mapsUrl = text(location.mapsUrl);
  if (!name || !address || !city || !mapsUrl) return null;
  return {
    name,
    address,
    city,
    reference: text(location.reference) || null,
    mapsUrl,
  };
}

export function clinicLocationLabel(value: unknown) {
  const location = readClinicLocation(value);
  if (!location) return '';
  return [
    location.name,
    location.address,
    location.city,
    location.reference ? `Referência: ${location.reference}` : null,
  ].filter(Boolean).join(' · ');
}
