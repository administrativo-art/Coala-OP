import PizZip from "pizzip";

export type DocumentTemplateTextBlockKind =
  | "title"
  | "section"
  | "clause"
  | "subclause"
  | "signature"
  | "paragraph";

export type DocumentTemplateTextBlock = {
  id: string;
  kind: DocumentTemplateTextBlockKind;
  styleId: string | null;
  number: string | null;
  text: string;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function paragraphText(paragraphXml: string) {
  const parts = Array.from(
    paragraphXml.matchAll(
      /<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g,
    ),
  ).map((match) => {
    if (match[0].startsWith("<w:tab")) return "\t";
    if (match[0].startsWith("<w:br")) return "\n";
    return decodeXml(match[1] ?? "");
  });
  return parts
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function paragraphStyle(paragraphXml: string) {
  return paragraphXml.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/)?.[1] ?? null;
}

function blockKind(styleId: string | null): DocumentTemplateTextBlockKind {
  if (styleId === "CTTituloDocumento" || styleId === "Title") return "title";
  if (styleId === "CTSecao" || /^Heading[1-3]$/i.test(styleId ?? "")) return "section";
  if (styleId === "CTClausulaN1") return "clause";
  if (styleId === "CTClausulaN2") return "subclause";
  if (
    styleId === "CTAssinatura"
    || styleId === "CTAssinaturaLinha"
    || styleId === "CTAssinaturaNome"
    || styleId === "CTAssinaturaQualificacao"
  ) {
    return "signature";
  }
  return "paragraph";
}

export function extractDocumentTemplateTextBlocks(input: Buffer) {
  const zip = new PizZip(input);
  const documentXml = zip.file("word/document.xml")?.asText();
  if (!documentXml) throw new Error("O DOCX não possui o texto principal.");

  let clause = 0;
  let subclause = 0;
  const blocks: DocumentTemplateTextBlock[] = [];
  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const text = paragraphText(match[0]);
    if (!text) continue;
    const styleId = paragraphStyle(match[0]);
    const kind = blockKind(styleId);
    let number: string | null = null;
    if (kind === "clause") {
      clause += 1;
      subclause = 0;
      number = `${clause}.`;
    } else if (kind === "subclause") {
      subclause += 1;
      number = `${clause}.${subclause}.`;
    }
    blocks.push({
      id: `block-${blocks.length + 1}`,
      kind,
      styleId,
      number,
      text,
    });
  }
  return blocks;
}
