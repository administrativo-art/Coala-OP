export const COMPANY_EMAIL_PURPOSES = ["onboarding", "termination", "aso", "vacation"] as const;

export type CompanyEmailPurpose = typeof COMPANY_EMAIL_PURPOSES[number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

export function companyEmailPurposeIndex(
  entity: { contact?: unknown; status?: unknown } | null | undefined,
  fallback?: { contact?: unknown; status?: unknown } | null,
): CompanyEmailPurpose[] {
  const source = record(entity);
  const previous = record(fallback);
  const status = Object.hasOwn(source, "status") ? source.status : previous.status;
  if (status === "inactive") return [];

  const contact = record(Object.hasOwn(source, "contact") ? source.contact : previous.contact);
  const indexedPurposes = new Set(
    records(contact.emails).flatMap((entry) => (
      Array.isArray(entry.purposes)
        ? entry.purposes.filter((purpose): purpose is CompanyEmailPurpose => (
            typeof purpose === "string" && COMPANY_EMAIL_PURPOSES.includes(purpose as CompanyEmailPurpose)
          ))
        : []
    )),
  );
  return COMPANY_EMAIL_PURPOSES.filter((purpose) => indexedPurposes.has(purpose));
}
