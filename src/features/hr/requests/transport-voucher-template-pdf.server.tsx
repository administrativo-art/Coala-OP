/** @jsxImportSource react-pdf-react-server */
import { readFile } from "node:fs/promises";
import path from "node:path";

import React from "react-pdf-react-server";
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from "react-pdf-renderer-server";

import { stampDocumentTemplateDemoPreview } from "@/features/hr/documents/document-template-demo-preview.server";
import { extractDocumentTemplateTextBlocks } from "@/features/hr/documents/document-template-text";
import { renderSystemDocumentTemplateDemoDocx } from "@/features/hr/documents/system-template-preview.server";
import type { SystemDocumentTemplate } from "@/features/hr/documents/system-template-catalog";

const CALADEA_FAMILY = "CaladeaTransportVoucher";
Font.register({
  family: CALADEA_FAMILY,
  fonts: [
    {
      src: path.join(process.cwd(), "node_modules/@fontsource/caladea/files/caladea-latin-400-normal.woff"),
      fontWeight: 400,
    },
    {
      src: path.join(process.cwd(), "node_modules/@fontsource/caladea/files/caladea-latin-700-normal.woff"),
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 96,
    paddingBottom: 86,
    paddingHorizontal: 58,
    fontFamily: CALADEA_FAMILY,
    fontSize: 9.1,
    lineHeight: 1.42,
    color: "#202124",
  },
  letterhead: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 595.28,
    height: 841.89,
  },
  title: {
    marginBottom: 17,
    fontWeight: 700,
    fontSize: 13.5,
    textAlign: "center",
  },
  paragraph: { marginBottom: 7, textAlign: "justify" },
  bulletRow: { flexDirection: "row", marginBottom: 4.5, paddingLeft: 10 },
  bullet: { width: 12, fontWeight: 700 },
  bulletText: { flex: 1, textAlign: "justify" },
  signatures: { flexDirection: "row", gap: 28, marginTop: 27 },
  signature: { flex: 1, borderTopWidth: 1, borderTopColor: "#4b5563", paddingTop: 6, textAlign: "center" },
  signatureName: { fontWeight: 700, fontSize: 8.8 },
  signatureRole: { marginTop: 2, color: "#5f6570", fontSize: 7.7 },
});

async function loadLetterhead() {
  return readFile(path.join(
    process.cwd(),
    "src/features/hr/documents/assets/coala-shakes-letterhead-a4-v2.png",
  ));
}

export async function renderTransportVoucherTemplateDemoPdf(template: SystemDocumentTemplate) {
  const [docx, letterhead] = await Promise.all([
    renderSystemDocumentTemplateDemoDocx(template),
    loadLetterhead(),
  ]);
  const blocks = extractDocumentTemplateTextBlocks(docx);
  if (blocks.length < 5) throw new Error("O modelo de vale-transporte não possui conteúdo suficiente.");

  const title = blocks[0]?.text ?? template.name;
  const signatureBlocks = blocks.slice(-4);
  const contentBlocks = blocks.slice(1, -4);
  const letterheadUri = `data:image/png;base64,${letterhead.toString("base64")}`;

  const pdf = await renderToBuffer(
    <Document title={title} author="Coala One" subject="Prévia com dados fictícios">
      <Page size="A4" style={styles.page}>
        <Image fixed src={letterheadUri} style={styles.letterhead} />
        <Text style={styles.title}>{title}</Text>
        {contentBlocks.map((block) => block.styleId === "ListParagraph" ? (
          <View key={block.id} style={styles.bulletRow} wrap={false}>
            <Text style={styles.bullet}>•</Text>
            <Text style={styles.bulletText}>{block.text}</Text>
          </View>
        ) : (
          <Text key={block.id} style={styles.paragraph}>{block.text}</Text>
        ))}
        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            <Text style={styles.signatureName}>{signatureBlocks[0]?.text ?? "EMPREGADO(A)"}</Text>
            <Text style={styles.signatureRole}>{signatureBlocks[1]?.text ?? "EMPREGADO(A)"}</Text>
          </View>
          <View style={styles.signature}>
            <Text style={styles.signatureName}>{signatureBlocks[2]?.text ?? "EMPREGADORA"}</Text>
            <Text style={styles.signatureRole}>{signatureBlocks[3]?.text ?? "EMPREGADORA"}</Text>
          </View>
        </View>
      </Page>
    </Document>,
  );
  return stampDocumentTemplateDemoPreview(Buffer.from(pdf));
}
