import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { UniformTransactionType } from "@/types";

const PREVIEW_FILE_BY_TYPE: Record<UniformTransactionType, string> = {
  delivery: "uniform-delivery-preview.pdf",
  exchange: "uniform-exchange-preview.pdf",
  return: "uniform-return-preview.pdf",
};

export async function loadUniformSystemTemplatePreview(
  type: UniformTransactionType,
) {
  const fileName = PREVIEW_FILE_BY_TYPE[type];
  if (!fileName) throw new Error("Tipo de modelo de uniforme inválido.");
  const buffer = await readFile(path.join(
    process.cwd(),
    "public/document-previews/uniforms",
    fileName,
  ));
  if (buffer.subarray(0, 4).toString() !== "%PDF") {
    throw new Error("A prévia versionada do uniforme não é um PDF válido.");
  }
  return buffer;
}
