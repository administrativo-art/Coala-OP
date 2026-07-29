import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { Document, Image, Page, renderToBuffer, StyleSheet } from "@react-pdf/renderer";

import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import {
  type SystemDocumentTemplate,
} from "@/features/hr/documents/system-template-catalog";
import { loadSystemDocumentTemplateSource } from "@/features/hr/documents/system-template-source.server";
import { renderUniformSystemTemplatePreview } from "@/features/uniforms/term.server";
import { uniformSystemTemplateById } from "@/features/uniforms/template-catalog";

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    margin: 0,
    padding: 0,
  },
  letterhead: {
    height: 841.89,
    left: 0,
    position: "absolute",
    top: 0,
    width: 595.28,
  },
});

export class SystemTemplatePreviewUnavailableError extends Error {}

function workspacePath(relativePath: string) {
  return path.join(process.cwd(), relativePath);
}

async function loadLetterhead() {
  return readFile(workspacePath("src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png"));
}

export async function loadSystemTemplateSource(template: SystemDocumentTemplate) {
  return loadSystemDocumentTemplateSource(template);
}

async function renderBlankLetterhead() {
  const letterhead = await loadLetterhead();
  const dataUri = `data:image/png;base64,${letterhead.toString("base64")}`;
  return renderToBuffer(
    <Document title="Papel timbrado Coala Shakes - em branco" author="Coala One">
      <Page size="A4" style={styles.page}>
        <Image fixed src={dataUri} style={styles.letterhead} />
      </Page>
    </Document>,
  );
}

export async function renderSystemDocumentTemplatePreview(template: SystemDocumentTemplate) {
  if (template.renderer === "letterhead") {
    return Buffer.from(await renderBlankLetterhead());
  }
  if (template.renderer === "uniform") {
    const uniformTemplate = uniformSystemTemplateById(template.id);
    if (!uniformTemplate) throw new Error("Modelo de uniforme não encontrado.");
    return renderUniformSystemTemplatePreview(uniformTemplate.type);
  }
  const source = await loadSystemTemplateSource(template);
  const pdf = await convertDocxToPdf(source);
  if (!pdf) {
    throw new SystemTemplatePreviewUnavailableError(
      "A prévia em PDF não está disponível neste ambiente. Baixe o arquivo Word original.",
    );
  }
  return applyCoalaLetterheadToPdf(pdf);
}
