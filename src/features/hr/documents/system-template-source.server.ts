import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SystemDocumentTemplate } from "@/features/hr/documents/system-template-catalog";

export async function loadSystemDocumentTemplateSource(
  template: SystemDocumentTemplate,
) {
  if (!template.sourcePath) {
    throw new Error("Este modelo não possui arquivo de origem.");
  }
  const source = await readFile(path.join(process.cwd(), template.sourcePath));
  if (template.contentHash) {
    const actualHash = createHash("sha256").update(source).digest("hex");
    if (actualHash !== template.contentHash) {
      throw new Error("O arquivo de origem do modelo não corresponde à versão catalogada.");
    }
  }
  return source;
}
