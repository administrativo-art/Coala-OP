import PizZip from "pizzip";

export const COALA_LETTERHEAD_PROFILE = {
  id: "coala-letterhead-v2",
  pageWidthTwips: 11_906,
  pageHeightTwips: 16_838,
  minimumTopTwips: 720,
  brandBandBottomTwips: 900,
  traceabilityBandBottomTwips: 360,
  traceabilityGapTwips: 100,
  minimumBottomTwips: 1_360,
  sizeToleranceTwips: 80,
} as const;

export type DocxTemplateValidationIssue = {
  code: "PAGE_SIZE" | "ORIENTATION" | "TOP_SAFE_AREA" | "BOTTOM_SAFE_AREA";
  section: number;
  message: string;
};

export type CtDocumentStandardIssue = {
  code:
    | "MISSING_STYLE"
    | "DIRECT_FORMATTING"
    | "MANUAL_TAB"
    | "MANUAL_LINE_BREAK"
    | "DOUBLE_SPACE"
    | "TYPED_NUMBERING"
    | "ORPHAN_SUBCLAUSE"
    | "LEVEL_THREE"
    | "LITERAL_CROSS_REFERENCE"
    | "HYPHENATION"
    | "PAGE_GEOMETRY"
    | "PAGE_FIELD_FORMAT";
  message: string;
};

const REQUIRED_CT_STYLES = [
  "CTCorpo",
  "CTTituloDocumento",
  "CTSecao",
  "CTClausulaN1",
  "CTClausulaN2",
  "CTPreambulo",
  "CTFecho",
  "CTAssinatura",
  "CTCabecalho",
  "CTRodape",
  "CTMarcaPrevia",
] as const;

function xmlText(paragraph: string) {
  return [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function paragraphStyle(paragraph: string) {
  return paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/)?.[1] ?? null;
}

export function validateCtDocumentStandard(input: Buffer) {
  const zip = new PizZip(input);
  const documentXml = zip.file("word/document.xml")?.asText();
  const stylesXml = zip.file("word/styles.xml")?.asText();
  const settingsXml = zip.file("word/settings.xml")?.asText();
  const headerXml = zip.file("word/header1.xml")?.asText();
  if (!documentXml || !stylesXml || !settingsXml || !headerXml) {
    throw new Error("O arquivo não contém as partes OOXML obrigatórias.");
  }

  const issues: CtDocumentStandardIssue[] = [];
  for (const styleId of REQUIRED_CT_STYLES) {
    if (!stylesXml.includes(`w:styleId="${styleId}"`)) {
      issues.push({
        code: "MISSING_STYLE",
        message: `O estilo obrigatório ${styleId} não existe.`,
      });
    }
  }

  if (/<w:rFonts\b|<w:sz(?:Cs)?\b/.test(documentXml)) {
    issues.push({
      code: "DIRECT_FORMATTING",
      message:
        "O corpo contém fonte ou corpo aplicados diretamente; use os estilos CT.",
    });
  }
  if (/<w:tab\b[^>]*\/>/.test(documentXml)) {
    issues.push({
      code: "MANUAL_TAB",
      message: "O corpo contém tabulação manual.",
    });
  }
  if (/<w:br\b(?=[^>]*(?:w:type="textWrapping"|\/>))[^>]*\/>/.test(documentXml)) {
    issues.push({
      code: "MANUAL_LINE_BREAK",
      message: "O corpo contém quebra de linha manual.",
    });
  }

  const paragraphs = [
    ...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
  ].map((match) => match[0]);
  let currentChildren = 0;
  let sawLevelOne = false;
  let previousLevelOneHadChildren = false;
  const finishParent = () => {
    if (sawLevelOne && currentChildren === 1) {
      issues.push({
        code: "ORPHAN_SUBCLAUSE",
        message: "Uma cláusula possui apenas o subitem .1; crie o .2 ou elimine o nível.",
      });
    }
    previousLevelOneHadChildren = currentChildren > 0;
    currentChildren = 0;
  };

  for (const paragraph of paragraphs) {
    const text = xmlText(paragraph);
    const style = paragraphStyle(paragraph);
    if (/ {2,}/.test(text)) {
      issues.push({
        code: "DOUBLE_SPACE",
        message: `Há espaço duplo no trecho “${text.slice(0, 80)}”.`,
      });
    }
    if (/^\s*\d+(?:\.\d+)?\.\s/.test(text)) {
      issues.push({
        code: "TYPED_NUMBERING",
        message: `A numeração foi digitada no trecho “${text.slice(0, 80)}”.`,
      });
    }
    if (/\bcláusula\s+\d+(?:\.\d+)?\b/iu.test(text)) {
      issues.push({
        code: "LITERAL_CROSS_REFERENCE",
        message: `A referência cruzada deve ser um campo REF: “${text.slice(0, 90)}”.`,
      });
    }
    if (style === "CTClausulaN1") {
      finishParent();
      sawLevelOne = true;
    } else if (style === "CTClausulaN2") {
      if (!sawLevelOne) {
        issues.push({
          code: "ORPHAN_SUBCLAUSE",
          message: "Um subitem aparece antes da primeira cláusula de nível 1.",
        });
      }
      currentChildren += 1;
    } else if (/CTClausulaN(?:3|[4-9]\d*)/.test(style ?? "")) {
      issues.push({
        code: "LEVEL_THREE",
        message: `O estilo ${style} cria hierarquia além do segundo nível.`,
      });
    }
  }
  finishParent();
  void previousLevelOneHadChildren;

  if (
    !settingsXml.includes('<w:autoHyphenation w:val="true"/>') ||
    !settingsXml.includes('<w:hyphenationZone w:val="357"/>') ||
    !settingsXml.includes('<w:doNotHyphenateCaps w:val="true"/>')
  ) {
    issues.push({
      code: "HYPHENATION",
      message: "A hifenização automática obrigatória não está configurada.",
    });
  }
  if (
    !documentXml.includes('<w:pgSz w:w="11906" w:h="16838"/>') ||
    !documentXml.includes(
      '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>',
    )
  ) {
    issues.push({
      code: "PAGE_GEOMETRY",
      message: "A página não usa a geometria A4 e as margens do padrão CT.",
    });
  }
  const fieldRuns = [
    ...headerXml.matchAll(
      /<w:r>(?=[\s\S]*?(?:<w:fldChar\b|<w:instrText\b))[\s\S]*?<\/w:r>/g,
    ),
  ].map((match) => match[0]);
  if (
    fieldRuns.length < 2 ||
    fieldRuns.some(
      (run) => !run.includes('<w:rStyle w:val="CTCabecalhoCaractere"/>'),
    )
  ) {
    issues.push({
      code: "PAGE_FIELD_FORMAT",
      message: "PAGE e NUMPAGES não estão integralmente vinculados ao estilo do cabeçalho.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`(?:w:)?${name}="(\\d+)"`, "i"));
  return match ? Number(match[1]) : null;
}

export function validateDocxForLetterhead(
  input: Buffer,
  profile = COALA_LETTERHEAD_PROFILE,
) {
  const zip = new PizZip(input);
  const xml = zip.file("word/document.xml")?.asText();
  if (!xml) throw new Error("O DOCX não possui word/document.xml.");
  const sections = Array.from(xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)).map((match) => match[0]);
  const issues: DocxTemplateValidationIssue[] = [];

  (sections.length ? sections : [""]).forEach((sectionXml, index) => {
    const pageSizeTag = sectionXml.match(/<w:pgSz\b[^>]*\/?>/)?.[0] ?? "";
    const marginTag = sectionXml.match(/<w:pgMar\b[^>]*\/?>/)?.[0] ?? "";
    const width = attribute(pageSizeTag, "w");
    const height = attribute(pageSizeTag, "h");
    const orientation = /w:orient="landscape"/i.test(pageSizeTag) ? "landscape" : "portrait";
    const top = attribute(marginTag, "top");
    const bottom = attribute(marginTag, "bottom");
    const sectionNumber = index + 1;

    if (orientation !== "portrait") {
      issues.push({
        code: "ORIENTATION",
        section: sectionNumber,
        message: `A seção ${sectionNumber} está em paisagem; o timbrado exige A4 retrato.`,
      });
    }
    if (
      width === null ||
      height === null ||
      (
        Math.abs(width - profile.pageWidthTwips) > profile.sizeToleranceTwips ||
        Math.abs(height - profile.pageHeightTwips) > profile.sizeToleranceTwips
      )
    ) {
      issues.push({
        code: "PAGE_SIZE",
        section: sectionNumber,
        message: `A seção ${sectionNumber} não está configurada em A4.`,
      });
    }
    if (top === null || top < profile.minimumTopTwips) {
      issues.push({
        code: "TOP_SAFE_AREA",
        section: sectionNumber,
        message: `A margem superior da seção ${sectionNumber} deve ter pelo menos 1,27 cm.`,
      });
    }
    if (bottom === null || bottom < profile.minimumBottomTwips) {
      issues.push({
        code: "BOTTOM_SAFE_AREA",
        section: sectionNumber,
        message: `A margem inferior da seção ${sectionNumber} deve ter pelo menos 2,40 cm para as bandas de marca e rastreabilidade.`,
      });
    }
  });

  return {
    profileId: profile.id,
    valid: issues.length === 0,
    sectionCount: sections.length || 1,
    issues,
  };
}
