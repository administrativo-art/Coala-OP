type ResolvedDocumentData = {
  data: Record<string, unknown>;
  flat: Record<string, unknown>;
  rawFlat: Record<string, unknown>;
  missingRequired: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else cursor = cursor[part] = record(cursor[part]);
  });
}

/**
 * Documentos jurídicos devem usar a razão social resolvida pelo CNPJ. O nome
 * operacional da unidade continua no onboarding, mas não qualifica a parte.
 */
export function applyDocumentEmployerLegalName(
  resolved: ResolvedDocumentData,
  legalName: unknown,
) {
  const canonicalName = typeof legalName === "string" ? legalName.trim() : "";
  if (!canonicalName) return resolved;
  setPath(resolved.data, "integration.employer_name", canonicalName);
  resolved.flat["integration.employer_name"] = canonicalName;
  resolved.rawFlat["integration.employer_name"] = canonicalName;
  resolved.missingRequired = resolved.missingRequired.filter(
    (key) => key !== "integration.employer_name",
  );
  return resolved;
}
