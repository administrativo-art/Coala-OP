import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";

import {
  createCtBaseTemplate,
  CT_DOCUMENT_STYLE_IDS,
} from "../src/features/hr/documents/ct-document-standard.server";

const SOURCE = path.resolve(
  "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx",
);
const OUTPUT = path.resolve(
  "docs/modelos-documentos/base-ct-sorvetes.dotx",
);

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const source = await readFile(SOURCE);
const output = createCtBaseTemplate(source);
const zip = new PizZip(output);
const styles = zip.file("word/styles.xml")?.asText() ?? "";
const numbering = zip.file("word/numbering.xml")?.asText() ?? "";
const settings = zip.file("word/settings.xml")?.asText() ?? "";
const document = zip.file("word/document.xml")?.asText() ?? "";

for (const styleId of CT_DOCUMENT_STYLE_IDS) {
  if (!styles.includes(`w:styleId="${styleId}"`)) {
    throw new Error(`O modelo-base não contém o estilo ${styleId}.`);
  }
}
if (!numbering.includes('w:abstractNumId="90"')) {
  throw new Error("A lista multinível CT não foi criada.");
}
if (
  !settings.includes('<w:autoHyphenation w:val="true"/>') ||
  !settings.includes('<w:hyphenationZone w:val="357"/>')
) {
  throw new Error("As regras de hifenização não foram aplicadas.");
}
if (
  !document.includes('<w:pgSz w:w="11906" w:h="16838"/>') ||
  !document.includes(
    '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>',
  )
) {
  throw new Error("A geometria A4 do modelo-base está incorreta.");
}

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output);
process.stdout.write(
  `${JSON.stringify(
    {
      source: path.relative(process.cwd(), SOURCE),
      sourceHash: sha256(source),
      output: path.relative(process.cwd(), OUTPUT),
      outputHash: sha256(output),
      styles: CT_DOCUMENT_STYLE_IDS,
    },
    null,
    2,
  )}\n`,
);
