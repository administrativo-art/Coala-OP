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
