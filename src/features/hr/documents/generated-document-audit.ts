import {
  DOCUMENT_VARIABLE_CATALOG,
  DOCUMENT_VARIABLE_SCHEMA_VERSION,
} from "@/features/hr/integration/document-variables";
import type { TemplateFieldMapping } from "@/features/hr/documents/field-mapping";

export const DOCUMENT_AUDIT_SCHEMA_VERSION = "generated-values-v1";
export const DOCUMENT_FORMATTER_VERSION = "document-output-v1";
export const MAX_INLINE_DOCUMENT_AUDIT_BYTES = 256 * 1024;

export type GeneratedDocumentAuditValue = {
  rawValue: unknown;
  renderedValue: unknown;
  sourceType: string;
  sourceReference: string;
  formatter: string;
  formatterVersion: typeof DOCUMENT_FORMATTER_VERSION;
  sensitive: boolean;
};

export type GeneratedDocumentResolvedValuesAudit = {
  schemaVersion: typeof DOCUMENT_AUDIT_SCHEMA_VERSION;
  catalogVersion: typeof DOCUMENT_VARIABLE_SCHEMA_VERSION;
  resolvedAt: string;
  storageMode: "inline";
  values: Record<string, GeneratedDocumentAuditValue>;
};

function valueAtPath(root: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[part];
  }, root);
}

export function buildGeneratedDocumentAudit(params: {
  variables: string[];
  mapping: TemplateFieldMapping;
  data: Record<string, unknown>;
  flat: Record<string, unknown>;
  rawFlat: Record<string, unknown>;
  manualValues: Record<string, unknown>;
  schemaVariables?: ReadonlySet<string>;
  schemaSensitiveVariables?: ReadonlySet<string>;
  resolvedAt: string;
}) {
  const values: Record<string, GeneratedDocumentAuditValue> = {};
  for (const variable of params.variables) {
    const binding = params.mapping[variable];
    if (binding?.kind === "manual") {
      values[variable] = {
        rawValue: params.manualValues[variable] ?? binding.defaultValue ?? null,
        renderedValue: valueAtPath(params.data, variable) ?? null,
        sourceType: "manual",
        sourceReference: variable,
        formatter: binding.format,
        formatterVersion: DOCUMENT_FORMATTER_VERSION,
        sensitive: false,
      };
      continue;
    }

    const sourceKey = binding?.kind === "system" ? binding.key : variable;
    const catalog = DOCUMENT_VARIABLE_CATALOG[sourceKey];
    const schemaVariable = params.schemaVariables?.has(variable) === true;
    const sensitive = catalog?.sensitive === true
      || params.schemaSensitiveVariables?.has(variable) === true;
    values[variable] = {
      rawValue: sensitive ? null : params.rawFlat[sourceKey] ?? null,
      renderedValue:
        valueAtPath(params.data, variable)
        ?? params.flat[sourceKey]
        ?? null,
      sourceType:
        binding?.kind === "system"
          ? "mapped_system"
          : schemaVariable
            ? "schema_form"
            : catalog?.resolution[0]?.source ?? "template",
      sourceReference: sourceKey,
      formatter:
        binding?.kind === "system" && binding.formatter
          ? binding.formatter
          : catalog?.format ?? "source",
      formatterVersion: DOCUMENT_FORMATTER_VERSION,
      sensitive,
    };
  }

  const audit: GeneratedDocumentResolvedValuesAudit = {
    schemaVersion: DOCUMENT_AUDIT_SCHEMA_VERSION,
    catalogVersion: DOCUMENT_VARIABLE_SCHEMA_VERSION,
    resolvedAt: params.resolvedAt,
    storageMode: "inline",
    values,
  };
  const size = Buffer.byteLength(JSON.stringify(audit), "utf8");
  if (size > MAX_INLINE_DOCUMENT_AUDIT_BYTES) {
    throw new Error(
      `Auditoria dos valores resolvidos excedeu ${MAX_INLINE_DOCUMENT_AUDIT_BYTES} bytes; use armazenamento externo protegido.`,
    );
  }
  return { audit, size };
}
