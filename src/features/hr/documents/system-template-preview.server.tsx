/** @jsxImportSource react-pdf-react-server */
import { readFile } from "node:fs/promises";
import path from "node:path";
import React from "react-pdf-react-server";
import { Document, Image, Page, renderToBuffer, StyleSheet } from "react-pdf-renderer-server";

import { convertDocxToPdf } from "@/features/hr/documents/pdf-converter.server";
import { generateDocx } from "@/features/hr/documents/docx-generator";
import { buildDocumentTemplateDemoData } from "@/features/hr/documents/document-template-demo-data";
import { stampDocumentTemplateDemoPreview } from "@/features/hr/documents/document-template-demo-preview.server";
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import {
  type SystemDocumentTemplate,
} from "@/features/hr/documents/system-template-catalog";
import { loadSystemDocumentTemplateSource } from "@/features/hr/documents/system-template-source.server";
import { REP_P_RECEIPT_PREVIEW_SNAPSHOT, renderRepPReceiptPdf } from "@/features/dp/rep-p/receipt";
import { REP_P_PILOT_RECEIPT_PREVIEW_SNAPSHOT, renderRepPPilotReceipt } from "@/features/dp/rep-p/pilot-receipt";
import { MIRROR_PREVIEW_SNAPSHOT } from "@/features/dp/time-adjustments/mirror-core";
import { renderMirrorPdf } from "@/features/dp/time-adjustments/mirror-pdf";
import type { EditorContent } from "@/features/documents/editor/content-schema";
import { convertHtmlToPdf } from "@/features/documents/editor/html-pdf-converter.server";
import { PROVISIONAL_PAGE_LAYOUT, renderEditorHtml } from "@/features/documents/editor/render-html";
import { uniformSystemTemplateById } from "@/features/uniforms/template-catalog";
import { loadUniformSystemTemplatePreview } from "@/features/uniforms/template-preview.server";

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

export async function renderSystemDocumentTemplateDemoDocx(template: SystemDocumentTemplate) {
  if (template.sourceFormat !== "docx") {
    throw new Error("Este modelo não possui uma fonte Word para prévia.");
  }
  const source = await loadSystemTemplateSource(template);
  return generateDocx(source, buildDocumentTemplateDemoData({
    variables: template.variables,
    fieldMapping: template.fieldMapping,
  }));
}

async function finalizeSystemDocumentTemplateDemoPdf(pdf: Buffer) {
  return stampDocumentTemplateDemoPreview(await applyCoalaLetterheadToPdf(pdf));
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

const EDITOR_PREVIEW_CONTENT: EditorContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Documento de exemplo" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Este texto demonstra o documento livre. Campo do catálogo: " },
        { type: "documentField", attrs: { key: "employee.name" } },
        { type: "text", text: "." },
      ],
    },
  ],
};

async function renderEditorPreview() {
  const { html } = renderEditorHtml(EDITOR_PREVIEW_CONTENT, { mode: "sample" });
  const result = await convertHtmlToPdf(html, {
    paper: { widthPx: PROVISIONAL_PAGE_LAYOUT.widthPx, heightPx: PROVISIONAL_PAGE_LAYOUT.heightPx },
    margins: {
      topPx: PROVISIONAL_PAGE_LAYOUT.marginTopPx,
      bottomPx: PROVISIONAL_PAGE_LAYOUT.marginBottomPx,
      leftPx: PROVISIONAL_PAGE_LAYOUT.marginLeftPx,
      rightPx: PROVISIONAL_PAGE_LAYOUT.marginRightPx,
    },
  });
  if (!result.ok) {
    throw new SystemTemplatePreviewUnavailableError("A prévia em PDF não está disponível neste ambiente.");
  }
  return finalizeSystemDocumentTemplateDemoPdf(result.pdf);
}

export async function renderSystemDocumentTemplatePreview(template: SystemDocumentTemplate) {
  if (template.renderer === "editor_html") {
    return renderEditorPreview();
  }
  if (template.renderer === "letterhead") {
    return Buffer.from(await renderBlankLetterhead());
  }
  if (template.renderer === "rep_p_receipt") {
    return renderRepPReceiptPdf(REP_P_RECEIPT_PREVIEW_SNAPSHOT, { preview: true });
  }
  if (template.renderer === "rep_p_pilot_receipt") {
    return (await renderRepPPilotReceipt(REP_P_PILOT_RECEIPT_PREVIEW_SNAPSHOT)).bytes;
  }
  if (template.renderer === "time_mirror") {
    return renderMirrorPdf(MIRROR_PREVIEW_SNAPSHOT, "0".repeat(64), null, { preview: true });
  }
  if (template.renderer === "uniform") {
    const uniformTemplate = uniformSystemTemplateById(template.id);
    if (!uniformTemplate) throw new Error("Modelo de uniforme não encontrado.");
    return loadUniformSystemTemplatePreview(uniformTemplate.type);
  }
  const demoDocx = await renderSystemDocumentTemplateDemoDocx(template);
  const pdf = await convertDocxToPdf(demoDocx);
  if (!pdf) {
    throw new SystemTemplatePreviewUnavailableError(
      "A prévia em PDF não está disponível neste ambiente. Baixe o arquivo Word original.",
    );
  }
  return finalizeSystemDocumentTemplateDemoPdf(pdf);
}
