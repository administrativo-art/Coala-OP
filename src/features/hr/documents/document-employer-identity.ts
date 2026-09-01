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
 * Mantém separadas a razão social usada na qualificação contratual e a
 * identificação operacional, que também pode exibir o nome fantasia.
 */
export function applyDocumentEmployerLegalName(
  resolved: ResolvedDocumentData,
  legalName: unknown,
  tradeName?: unknown,
) {
  const canonicalName = typeof legalName === "string" ? legalName.trim() : "";
  if (!canonicalName) return resolved;
  const operationalName = typeof tradeName === "string" ? tradeName.trim() : "";
  const displayName = operationalName
    && operationalName.localeCompare(canonicalName, "pt-BR", { sensitivity: "base" }) !== 0
    ? `${canonicalName}, nome fantasia ${operationalName}`
    : canonicalName;
  setPath(resolved.data, "integration.employer_legal_name", canonicalName);
  setPath(resolved.data, "integration.employer_name", displayName);
  resolved.flat["integration.employer_legal_name"] = canonicalName;
  resolved.flat["integration.employer_name"] = displayName;
  resolved.rawFlat["integration.employer_legal_name"] = canonicalName;
  resolved.rawFlat["integration.employer_name"] = displayName;
  resolved.missingRequired = resolved.missingRequired.filter(
    (key) => key !== "integration.employer_legal_name" && key !== "integration.employer_name",
  );
  return resolved;
}
