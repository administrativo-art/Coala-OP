import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { Document, Image, Page, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";

import { SignedUniformMovementTermDocument } from "../src/components/pdf/UniformTermDocument";

const outputDir = path.join(process.cwd(), "output/pdf");
await mkdir(outputDir, { recursive: true });

async function signatureDataUrl(label: string, color: string) {
  const svg = `<svg width="520" height="120" xmlns="http://www.w3.org/2000/svg">
    <rect width="520" height="120" fill="white"/>
    <path d="M25 80 C70 20,80 100,125 55 S190 95,225 50 S280 85,325 45 S385 80,455 38" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
    <text x="30" y="108" font-family="Arial" font-size="18" fill="${color}">${label}</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

const [letterhead, collaboratorSignature, responsibleSignature] = await Promise.all([
  readFile(path.join(process.cwd(), "src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png")),
  signatureDataUrl("Maria da Silva", "#1f2937"),
  signatureDataUrl("Responsável RH", "#9d174d"),
]);
const letterheadDataUri = `data:image/png;base64,${letterhead.toString("base64")}`;
await writeFile(
  path.join(outputDir, "modelo-papel-timbrado-coala-shakes-em-branco.pdf"),
  await renderToBuffer(
    <Document title="Papel timbrado Coala Shakes - em branco" author="Coala One">
      <Page size="A4" style={{ margin: 0, padding: 0 }}>
        <Image
          fixed
          src={letterheadDataUri}
          style={{ position: "absolute", left: 0, top: 0, width: 595.28, height: 841.89 }}
        />
      </Page>
    </Document>,
  ),
);

const common = {
  collaboratorName: "Maria da Silva",
  collaboratorDocument: "***.456.***-10",
  registeredByName: "Responsável RH",
  occurredAt: "2026-07-27",
  collaboratorSignature,
  responsibleSignature,
  signedAt: "2026-07-27T14:30:00-03:00",
  letterheadDataUri,
};

const samples = [
  {
    name: "termo-uniforme-entrega-amostra.pdf",
    document: (
      <SignedUniformMovementTermDocument
        {...common}
        type="delivery"
        protocol="11111111-1111-4111-8111-111111111111"
        outgoingItems={[{
          productName: "Camiseta Polo Coala Shakes",
          quantity: 2,
          condition: "novo",
          apparelType: "Camiseta polo",
          apparelColor: "Preta",
          apparelSize: "M",
        }]}
        incomingItems={[]}
        notes="Entrega inicial para início das atividades."
      />
    ),
  },
  {
    name: "termo-uniforme-troca-amostra.pdf",
    document: (
      <SignedUniformMovementTermDocument
        {...common}
        type="exchange"
        protocol="22222222-2222-4222-8222-222222222222"
        incomingItems={[{
          productName: "Camiseta Polo Coala Shakes",
          quantity: 1,
          condition: "bom_estado",
          stockDisposition: "retorna_estoque",
          apparelType: "Camiseta polo",
          apparelColor: "Preta",
          apparelSize: "M",
        }]}
        outgoingItems={[{
          productName: "Camiseta Polo Coala Shakes",
          quantity: 1,
          condition: "novo",
          apparelType: "Camiseta polo",
          apparelColor: "Preta",
          apparelSize: "G",
        }]}
        notes="Troca de tamanho M por G."
      />
    ),
  },
  {
    name: "termo-uniforme-devolucao-amostra.pdf",
    document: (
      <SignedUniformMovementTermDocument
        {...common}
        type="return"
        protocol="33333333-3333-4333-8333-333333333333"
        outgoingItems={[]}
        incomingItems={[{
          productName: "Avental Operacional",
          quantity: 1,
          condition: "usado",
          stockDisposition: "retorna_estoque",
          apparelType: "Avental",
          apparelColor: "Rosa",
          apparelSize: "Único",
        }]}
        notes="Peça devolvida sem rasgos e com sinais normais de uso."
      />
    ),
  },
];

const modelCommon = {
  collaboratorName: "Nome do colaborador",
  collaboratorDocument: "***.***.***-**",
  registeredByName: "Responsável/RH",
  occurredAt: "dd/mm/aaaa",
  protocol: "GERADO AUTOMATICAMENTE",
  letterheadDataUri,
};
const returnedModelItems = [
  { productName: "Camiseta polo", quantity: 1, condition: "usado", stockDisposition: "retorna_estoque", apparelType: "Piquê Coala", apparelColor: "Preta", apparelSize: "M" },
  { productName: "Avental operacional", quantity: 1, condition: "danificado", stockDisposition: "descartar", apparelType: "Linha Frente", apparelColor: "Rosa", apparelSize: "Único" },
  { productName: "Boné trucker", quantity: 1, condition: "danificado", stockDisposition: "descartar", apparelType: "Aba curva", apparelColor: "Azul", apparelSize: "Único" },
];
const deliveredModelItems = [
  { productName: "Camiseta polo", quantity: 2, condition: "novo", apparelType: "Piquê Coala", apparelColor: "Preta", apparelSize: "M" },
  { productName: "Avental operacional", quantity: 1, condition: "novo", apparelType: "Linha Frente", apparelColor: "Rosa", apparelSize: "Único" },
  { productName: "Boné trucker", quantity: 1, condition: "novo", apparelType: "Aba curva", apparelColor: "Azul", apparelSize: "Único" },
];
const models = [
  {
    name: "modelo-termo-uniforme-entrega.pdf",
    document: <SignedUniformMovementTermDocument {...modelCommon} type="delivery" outgoingItems={deliveredModelItems} incomingItems={[]} />,
  },
  {
    name: "modelo-termo-uniforme-troca.pdf",
    document: <SignedUniformMovementTermDocument {...modelCommon} type="exchange" outgoingItems={deliveredModelItems} incomingItems={returnedModelItems} />,
  },
  {
    name: "modelo-termo-uniforme-devolucao.pdf",
    document: <SignedUniformMovementTermDocument {...modelCommon} type="return" outgoingItems={[]} incomingItems={returnedModelItems.slice(0, 2)} />,
  },
];

for (const sample of [...samples, ...models]) {
  const buffer = await renderToBuffer(sample.document);
  await writeFile(path.join(outputDir, sample.name), Buffer.from(buffer));
  console.log(path.join(outputDir, sample.name));
}
