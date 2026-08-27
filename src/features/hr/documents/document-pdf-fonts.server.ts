import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

type CaladeaWeight = "regular" | "bold";

const FONT_FILES: Record<CaladeaWeight, string> = {
  regular: "caladea-latin-400-normal.woff",
  bold: "caladea-latin-700-normal.woff",
};

const fontBuffers = new Map<CaladeaWeight, Promise<Buffer>>();

function loadFontBuffer(weight: CaladeaWeight) {
  const cached = fontBuffers.get(weight);
  if (cached) return cached;

  const promise = readFile(
    path.join(
      process.cwd(),
      "node_modules/@fontsource/caladea/files",
      FONT_FILES[weight],
    ),
  );
  fontBuffers.set(weight, promise);
  return promise;
}

export async function embedCaladeaFont(
  document: PDFDocument,
  weight: CaladeaWeight = "regular",
): Promise<PDFFont> {
  document.registerFontkit(fontkit);
  return document.embedFont(await loadFontBuffer(weight), {
    subset: true,
  });
}
