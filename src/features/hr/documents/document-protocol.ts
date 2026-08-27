function entityCode(value: unknown) {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  return normalized.slice(0, 4) || "CS";
}

export function formatDocumentProtocol(params: {
  entity: unknown;
  year: number;
  sequence: number;
  type?: string;
}) {
  const type = String(params.type ?? "DOC")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6) || "DOC";
  return `${entityCode(params.entity)}-${type}-${params.year}-${String(params.sequence).padStart(6, "0")}`;
}

export function documentProtocolEntityCode(value: unknown) {
  return entityCode(value);
}

export function documentProtocolEntityFromSnapshot(
  snapshot: unknown,
  fallback: unknown = "CS",
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return fallback;
  const value = snapshot as Record<string, unknown>;
  return value.tradeName
    ?? value.legalName
    ?? value.cnpj
    ?? fallback;
}
