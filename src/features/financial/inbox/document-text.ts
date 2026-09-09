const MAX_EXTRACTED_TEXT = 80_000;
const MAX_PDF_PAGES = 40;

export function isPdfDocument(contentType: string, filename: string) {
  return contentType.toLowerCase() === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
}

export function isImageDocument(contentType: string, filename: string) {
  return contentType.toLowerCase().startsWith("image/") || /\.(?:png|jpe?g|webp)$/i.test(filename);
}

function isXmlDocument(contentType: string, filename: string) {
  return /xml/i.test(contentType) || filename.toLowerCase().endsWith(".xml");
}

function isPlainTextDocument(contentType: string, filename: string) {
  return contentType.toLowerCase().startsWith("text/") || /\.(?:txt|csv)$/i.test(filename);
}

async function pdfText(buffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages: string[] = [];
    let extractedLength = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let current = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        current += `${current ? " " : ""}${item.str}`;
        if (item.hasEOL) {
          lines.push(current);
          current = "";
        }
      }
      if (current) lines.push(current);
      const pageText = lines.join("\n");
      pages.push(pageText);
      extractedLength += pageText.length;
      if (extractedLength >= MAX_EXTRACTED_TEXT) break;
    }
    return { text: pages.join("\n\n").slice(0, MAX_EXTRACTED_TEXT).trim(), pageCount: document.numPages };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

function xmlText(buffer: Buffer) {
  return buffer.toString("utf8")
    .replace(/<\?xml[^>]*>/gi, "")
    .replace(/<([A-Za-z_][\w:.-]*)[^>]*>/g, "$1: ")
    .replace(/<\/[^>]+>/g, "\n")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_EXTRACTED_TEXT)
    .trim();
}

export async function extractDeterministicFinancialDocumentText(params: {
  buffer: Buffer;
  filename: string;
  contentType: string;
}) {
  if (isPdfDocument(params.contentType, params.filename)) {
    const extracted = await pdfText(params.buffer);
    return { ...extracted, method: "pdf_text" as const, supported: true };
  }
  if (isXmlDocument(params.contentType, params.filename)) {
    return { text: xmlText(params.buffer), pageCount: null, method: "xml_text" as const, supported: true };
  }
  if (isPlainTextDocument(params.contentType, params.filename)) {
    return {
      text: params.buffer.toString("utf8").slice(0, MAX_EXTRACTED_TEXT).trim(),
      pageCount: null,
      method: "plain_text" as const,
      supported: true,
    };
  }
  return { text: "", pageCount: null, method: null, supported: isImageDocument(params.contentType, params.filename) };
}
