import { createHash } from "node:crypto";
import { getStorage } from "firebase-admin/storage";

import { extractDocxVariables } from "@/features/hr/documents/docx-generator";
import { normalizeFieldMapping } from "@/features/hr/documents/field-mapping";
import { adminApp } from "@/lib/firebase-admin";
import { firebaseClientConfig } from "@/lib/firebase-client-config";

type TemplateSnapshotLike = {
  get(field: string): unknown;
};

export type DocumentTemplateIntegrityResult = {
  valid: boolean;
  checkedAt: string;
  expectedHash: string | null;
  actualHash: string;
  storedVariables: string[];
  actualVariables: string[];
  tokensMissingFromFile: string[];
  tokensMissingFromRecord: string[];
  mappedFieldsWithoutToken: string[];
  issues: Array<{
    code: "hash_mismatch" | "token_missing_from_file" | "token_missing_from_record" | "mapping_without_token";
    message: string;
  }>;
};

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

function difference(left: string[], right: string[]) {
  const known = new Set(right);
  return left.filter((value) => !known.has(value));
}

export async function inspectStoredDocumentTemplateIntegrity(
  document: TemplateSnapshotLike,
): Promise<DocumentTemplateIntegrityResult> {
  const storagePath = document.get("storagePath");
  if (typeof storagePath !== "string" || !storagePath) {
    throw new Error("O modelo não possui um arquivo DOCX armazenado.");
  }
  const [source] = await getStorage(adminApp)
    .bucket(firebaseClientConfig.storageBucket)
    .file(storagePath)
    .download();
  const expectedHash = typeof document.get("contentHash") === "string"
    ? String(document.get("contentHash"))
    : null;
  const actualHash = createHash("sha256").update(source).digest("hex");
  const storedVariables = stringArray(document.get("variables"));
  const actualVariables = [...extractDocxVariables(source)].sort();
  const mapping = normalizeFieldMapping(document.get("fieldMapping"), storedVariables);
  const tokensMissingFromFile = difference(storedVariables, actualVariables);
  const tokensMissingFromRecord = difference(actualVariables, storedVariables);
  const mappedFieldsWithoutToken = difference(Object.keys(mapping).sort(), actualVariables);
  const issues: DocumentTemplateIntegrityResult["issues"] = [];

  if (expectedHash && expectedHash !== actualHash) {
    issues.push({
      code: "hash_mismatch",
      message: "O arquivo DOCX armazenado não corresponde ao hash da versão mapeada.",
    });
  }
  if (tokensMissingFromFile.length) {
    issues.push({
      code: "token_missing_from_file",
      message: `Tokens registrados que não existem mais no DOCX: ${tokensMissingFromFile.join(", ")}.`,
    });
  }
  if (tokensMissingFromRecord.length) {
    issues.push({
      code: "token_missing_from_record",
      message: `Tokens existentes no DOCX que não foram registrados: ${tokensMissingFromRecord.join(", ")}.`,
    });
  }
  if (mappedFieldsWithoutToken.length) {
    issues.push({
      code: "mapping_without_token",
      message: `Campos mapeados sem token correspondente no DOCX: ${mappedFieldsWithoutToken.join(", ")}.`,
    });
  }

  return {
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    expectedHash,
    actualHash,
    storedVariables,
    actualVariables,
    tokensMissingFromFile,
    tokensMissingFromRecord,
    mappedFieldsWithoutToken,
    issues,
  };
}
