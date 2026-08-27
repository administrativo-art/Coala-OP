import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import {
  SignedUniformMovementTermDocument,
  type SignedUniformTermItem,
} from "../src/components/pdf/UniformTermDocument";
import type { UniformTransactionType } from "../src/types";

const OUTPUT_DIRECTORY = path.resolve(
  "public/document-previews/uniforms",
);
const LETTERHEAD = path.resolve(
  "src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png",
);

const returnedItems: SignedUniformTermItem[] = [
  {
    productName: "Camiseta polo",
    quantity: 1,
    condition: "usado",
    apparelType: "Piquê Coala",
    apparelColor: "Preta",
    apparelSize: "M",
    stockDisposition: "retorna_estoque",
  },
  {
    productName: "Avental operacional",
    quantity: 1,
    condition: "danificado",
    apparelType: "Linha Frente",
    apparelColor: "Rosa",
    apparelSize: "Único",
    stockDisposition: "descartar",
  },
];

const deliveredItems: SignedUniformTermItem[] = [
  {
    productName: "Camiseta polo",
    quantity: 2,
    condition: "novo",
    apparelType: "Piquê Coala",
    apparelColor: "Preta",
    apparelSize: "M",
  },
  {
    productName: "Avental operacional",
    quantity: 1,
    condition: "novo",
    apparelType: "Linha Frente",
    apparelColor: "Rosa",
    apparelSize: "Único",
  },
];

const typeFile: Array<[UniformTransactionType, string]> = [
  ["delivery", "uniform-delivery-preview.pdf"],
  ["exchange", "uniform-exchange-preview.pdf"],
  ["return", "uniform-return-preview.pdf"],
];

const letterhead = await readFile(LETTERHEAD);
const letterheadDataUri = `data:image/png;base64,${letterhead.toString("base64")}`;
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

for (const [type, fileName] of typeFile) {
  const document = React.createElement(SignedUniformMovementTermDocument, {
    type,
    protocol: "GERADO AUTOMATICAMENTE",
    collaboratorName: "Nome do colaborador",
    collaboratorDocument: "***.***.***-**",
    registeredByName: "Responsável/RH",
    occurredAt: "dd/mm/aaaa",
    outgoingItems: type === "return" ? [] : deliveredItems,
    incomingItems: type === "delivery" ? [] : returnedItems,
    letterheadDataUri,
    preview: true,
  }) as Parameters<typeof renderToBuffer>[0];
  const output = Buffer.from(await renderToBuffer(document));
  await writeFile(path.join(OUTPUT_DIRECTORY, fileName), output);
  process.stdout.write(`${type}: ${output.byteLength} bytes\n`);
}
