import PizZip from "pizzip";

export type TemplatePersonalDataFinding = {
  type: "cpf" | "salary" | "personal_email" | "filled_person_name";
  maskedEvidence: string;
};

export type DocumentTemplateMappingProposal = {
  exactText: string;
  expectedOccurrences: number;
  variableKey: string;
  confidence: number;
  rationale: string;
};

export type DocumentTemplateAiPlan = {
  schemaVersion: 1;
  sourceHash: string;
  mappings: DocumentTemplateMappingProposal[];
  formSchemaProposal: Record<string, unknown> | null;
  documentClass: string;
  retentionAnchorType: string;
  signatureScope: "bundle" | "standalone" | "none";
  reviewed: boolean;
  reviewedAt?: string;
  reviewedBy?: string;
  appliedVersion?: number;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractDocxPlainText(input: Buffer) {
  const zip = new PizZip(input);
  return Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
    .map((name) => {
      const xml = zip.file(name)?.asText() ?? "";
      return Array.from(xml.matchAll(/<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXml(match[1]))
        .join(" ");
    })
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function mask(value: string) {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length > 4 ? `***${digits.slice(-4)}` : "***";
}

export function scanDocxTemplateForPersonalData(input: Buffer) {
  const text = extractDocxPlainText(input);
  const findings: TemplatePersonalDataFinding[] = [];
  const add = (type: TemplatePersonalDataFinding["type"], evidence: string) => {
    if (!findings.some((item) => item.type === type && item.maskedEvidence === mask(evidence))) {
      findings.push({ type, maskedEvidence: mask(evidence) });
    }
  };
  for (const match of text.matchAll(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g)) add("cpf", match[0]);
  for (const match of text.matchAll(/\bR\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})\b/g)) add("salary", match[0]);
  for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) {
    if (!/@coala(?:shakes)?\.com(?:\.br)?$/i.test(match[0])) add("personal_email", match[0]);
  }
  for (const match of text.matchAll(/\bEu,\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'-]+){1,5})/gu)) {
    if (!match[1].includes("TITULAR")) add("filled_person_name", match[1]);
  }
  return { safeForAi: findings.length === 0, findings, text };
}

export function validateTemplateAiPlan(
  text: string,
  mappings: DocumentTemplateMappingProposal[],
) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.exactText.trim() || !mapping.variableKey.trim()) {
      errors.push("Mapeamento sem trecho ou variável.");
      continue;
    }
    if (seen.has(mapping.exactText)) errors.push(`Trecho repetido no plano: ${mapping.exactText}`);
    seen.add(mapping.exactText);
    const occurrences = text.split(mapping.exactText).length - 1;
    if (occurrences !== mapping.expectedOccurrences) {
      errors.push(
        `“${mapping.exactText}”: plano prevê ${mapping.expectedOccurrences}, fonte contém ${occurrences}.`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}
