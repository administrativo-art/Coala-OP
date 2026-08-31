import { createHash } from "node:crypto";

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
} from "pdf-lib";

import {
  canonicalManifestJson,
  DOCUMENT_COMPOSER_VERSION,
  type DocumentPackageManifest,
  type DocumentPackageParty,
  type DocumentPackageType,
  type DocumentPdfProfile,
  type DocumentSignatureScope,
} from "@/features/hr/documents/document-package-manifest";
import { embedCaladeaFont } from "@/features/hr/documents/document-pdf-fonts.server";

export const DOCUMENT_TRACEABILITY_BANDS = {
  brand: {
    bottomPoints: 0,
    heightPoints: 45,
  },
  traceability: {
    bottomPoints: 45,
    heightPoints: 18,
    textBaselinePoints: 50,
  },
} as const;

// PDFs individuais podem trazer numeração própria alinhada à direita. A faixa
// precisa cobrir o campo inteiro antes de aplicar a numeração global do pacote.
export const DOCUMENT_PAGE_NUMBER_REPLACEMENT_BAND = {
  widthPoints: 220,
  rightInsetPoints: 22,
  topInsetPoints: 49,
  heightPoints: 20,
} as const;

export type DocumentPdfComponent = {
  componentId: string;
  title: string;
  buffer: Buffer;
  templateId?: string | null;
  templateVersion?: number | null;
  sourceDocxHash?: string | null;
  signatureScope?: DocumentSignatureScope;
};

export type ComposedDocumentArtifact = {
  componentId: string;
  buffer: Buffer;
  contentHash: string;
  artifactHash: string;
  startPage: number;
  endPage: number;
};

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertPdf(buffer: Buffer, title: string) {
  if (buffer.byteLength < 5 || buffer.subarray(0, 4).toString() !== "%PDF") {
    throw new Error(`O documento ${title} não possui uma versão PDF válida.`);
  }
}

function fitText(
  font: PDFFont,
  text: string,
  maximumWidth: number,
  preferredSize = 7,
) {
  let size = preferredSize;
  while (size > 5 && font.widthOfTextAtSize(text, size) > maximumWidth) {
    size -= 0.25;
  }
  if (font.widthOfTextAtSize(text, size) > maximumWidth) {
    throw new Error("O rodapé de rastreabilidade excedeu a largura reservada.");
  }
  return size;
}

function trackingLabel(params: {
  mode: "package" | "standalone";
  protocol: string;
  componentIndex: number;
  componentCount: number;
  startPage: number;
  endPage: number;
  totalPages: number;
  contentHash: string;
}) {
  const hashPrefix = params.contentHash.slice(0, 8).toUpperCase();
  if (params.mode === "standalone") {
    return `Documento ${params.protocol} | Conteúdo ${hashPrefix}`;
  }
  return (
    `Pacote ${params.protocol} | Componente ${params.componentIndex}/${params.componentCount}` +
    ` | Págs. ${params.startPage}-${params.endPage}/${params.totalPages}` +
    ` | Conteúdo ${hashPrefix}`
  );
}

export function pageNumberReplacementGeometry(
  pageWidth: number,
  pageHeight: number,
) {
  const bandWidth = Math.min(
    DOCUMENT_PAGE_NUMBER_REPLACEMENT_BAND.widthPoints,
    pageWidth,
  );
  const rightInset = Math.min(
    DOCUMENT_PAGE_NUMBER_REPLACEMENT_BAND.rightInsetPoints,
    pageWidth,
  );
  return {
    x: pageWidth - bandWidth,
    y: Math.max(
      0,
      pageHeight - DOCUMENT_PAGE_NUMBER_REPLACEMENT_BAND.topInsetPoints,
    ),
    width: Math.max(0, bandWidth - rightInset),
    height: DOCUMENT_PAGE_NUMBER_REPLACEMENT_BAND.heightPoints,
  };
}

function replacePageNumber(
  page: PDFPage,
  font: PDFFont,
  pageNumber: number,
  totalPages: number,
) {
  const { width, height } = page.getSize();
  const size = 8;
  const label = `Página ${pageNumber} de ${totalPages}`;
  const labelWidth = font.widthOfTextAtSize(label, size);
  page.drawRectangle({
    ...pageNumberReplacementGeometry(width, height),
    color: rgb(1, 1, 1),
  });
  page.drawText(label, {
    x: width - 30 - labelWidth,
    y: height - 42,
    size,
    font,
    color: rgb(0.42, 0.47, 0.52),
  });
}

function drawTrackingFooter(page: PDFPage, font: PDFFont, label: string) {
  const { width } = page.getSize();
  const horizontalMargin = 30;
  const size = fitText(font, label, width - horizontalMargin * 2);
  page.drawRectangle({
    x: 0,
    y: DOCUMENT_TRACEABILITY_BANDS.traceability.bottomPoints,
    width,
    height: DOCUMENT_TRACEABILITY_BANDS.traceability.heightPoints,
    color: rgb(1, 1, 1),
  });
  page.drawText(label, {
    x: horizontalMargin,
    y: DOCUMENT_TRACEABILITY_BANDS.traceability.textBaselinePoints,
    size,
    font,
    color: rgb(0.38, 0.42, 0.47),
  });
}

export async function composeDocumentPackage(params: {
  packageId: string;
  packageType: DocumentPackageType;
  protocol: string;
  title: string;
  parties: DocumentPackageParty[];
  components: DocumentPdfComponent[];
  letterheadVersion: string;
  pdfProfile?: DocumentPdfProfile;
  generatedAt?: string;
  traceabilityMode?: "package" | "standalone";
}) {
  if (!params.components.length) {
    throw new Error("A composição não possui documentos.");
  }
  const mode = params.traceabilityMode
    ?? (params.components.length === 1 && params.packageType !== "admission"
      ? "standalone"
      : "package");
  if (
    mode === "package" &&
    params.components.some((component) => component.signatureScope === "standalone")
  ) {
    throw new Error(
      "Documento com aceite independente não pode integrar um pacote de assinatura.",
    );
  }

  const loaded = await Promise.all(
    params.components.map(async (component) => {
      assertPdf(component.buffer, component.title);
      const pdf = await PDFDocument.load(component.buffer, {
        ignoreEncryption: false,
      });
      return {
        component,
        pageCount: pdf.getPageCount(),
        contentHash: hashBuffer(component.buffer),
      };
    }),
  );
  const totalPages = loaded.reduce((sum, item) => sum + item.pageCount, 0);
  let pageCursor = 1;
  const artifacts: ComposedDocumentArtifact[] = [];

  for (const [index, item] of loaded.entries()) {
    const startPage = pageCursor;
    const endPage = startPage + item.pageCount - 1;
    const document = await PDFDocument.load(item.component.buffer, {
      ignoreEncryption: false,
    });
    const font = await embedCaladeaFont(document);
    const label = trackingLabel({
      mode,
      protocol: params.protocol,
      componentIndex: index + 1,
      componentCount: loaded.length,
      startPage,
      endPage,
      totalPages,
      contentHash: item.contentHash,
    });
    document.getPages().forEach((page, localIndex) => {
      replacePageNumber(page, font, startPage + localIndex, totalPages);
      drawTrackingFooter(page, font, label);
    });
    const artifactBuffer = Buffer.from(
      await document.save({ useObjectStreams: false }),
    );
    artifacts.push({
      componentId: item.component.componentId,
      buffer: artifactBuffer,
      contentHash: item.contentHash,
      artifactHash: hashBuffer(artifactBuffer),
      startPage,
      endPage,
    });
    pageCursor = endPage + 1;
  }

  const packageDocument = await PDFDocument.create();
  packageDocument.setTitle(params.title);
  packageDocument.setAuthor("Coala One");
  packageDocument.setCreator("Coala One");
  packageDocument.setProducer(
    `Coala One - ${DOCUMENT_COMPOSER_VERSION}`,
  );
  for (const artifact of artifacts) {
    const source = await PDFDocument.load(artifact.buffer);
    const pages = await packageDocument.copyPages(
      source,
      source.getPageIndices(),
    );
    pages.forEach((page) => packageDocument.addPage(page));
  }
  const packageBuffer = Buffer.from(
    await packageDocument.save({ useObjectStreams: false }),
  );
  const packageHash = hashBuffer(packageBuffer);
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const manifest: DocumentPackageManifest = {
    schemaVersion: 1,
    packageId: params.packageId,
    packageType: params.packageType,
    protocol: params.protocol,
    parties: params.parties,
    components: loaded.map((item, index) => {
      const artifact = artifacts[index];
      return {
        componentId: item.component.componentId,
        templateId: item.component.templateId ?? "unknown",
        templateVersion: item.component.templateVersion ?? 1,
        title: item.component.title,
        order: index + 1,
        startPage: artifact.startPage,
        endPage: artifact.endPage,
        contentHash: artifact.contentHash,
        artifactHash: artifact.artifactHash,
        sourceDocxHash: item.component.sourceDocxHash ?? null,
        signatureScope: item.component.signatureScope ?? "bundle",
      };
    }),
    totalPages,
    letterheadVersion: params.letterheadVersion,
    composerVersion: DOCUMENT_COMPOSER_VERSION,
    pdfProfile: params.pdfProfile ?? "pdf-1.7",
    packageHash,
    generatedAt,
  };
  const manifestHash = createHash("sha256")
    .update(canonicalManifestJson(manifest))
    .digest("hex");

  return {
    buffer: packageBuffer,
    packageHash,
    manifest,
    manifestHash,
    artifacts,
    pageCount: totalPages,
  };
}
