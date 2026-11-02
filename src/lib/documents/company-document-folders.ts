export const TIME_RECORDING_COMPLIANCE_FOLDER = "time_recording_compliance" as const;
export const TIME_RECORDING_COMPLIANCE_LABEL = "Regularidade do sistema de registro de ponto";
export const TIME_RECORDING_COMPLIANCE_CATEGORY = "Sistemas e conformidade";

export type CompanyDocumentFolderCode = typeof TIME_RECORDING_COMPLIANCE_FOLDER | null;

export const TIME_RECORDING_EVIDENCE_SECTIONS = [
  { code: "registration", label: "01 Registro e atestados" },
  { code: "samples", label: "02 Amostras e assinaturas" },
  { code: "validation", label: "03 Relatórios de validação" },
  { code: "technical", label: "04 Controles técnicos" },
  { code: "versions", label: "05 Dossiês e versões" },
] as const;
export type TimeRecordingEvidenceSection = (typeof TIME_RECORDING_EVIDENCE_SECTIONS)[number]["code"];
export function isTimeRecordingEvidenceSection(value: unknown): value is TimeRecordingEvidenceSection {
  return TIME_RECORDING_EVIDENCE_SECTIONS.some((section) => section.code === value);
}

/** Reconhece os registros REP-P arquivados antes de existir o campo folderCode. */
export function companyDocumentFolderCode(document: {
  category?: unknown;
  title?: unknown;
  folderCode?: unknown;
}): CompanyDocumentFolderCode {
  if (document.folderCode === TIME_RECORDING_COMPLIANCE_FOLDER) return TIME_RECORDING_COMPLIANCE_FOLDER;
  if (document.folderCode === null) return null;
  return document.category === "Trabalhista e RH" && typeof document.title === "string" && /^REP-P\s*[—–-]/i.test(document.title.trim())
    ? TIME_RECORDING_COMPLIANCE_FOLDER
    : null;
}

export function companyDocumentNavigationCategory(document: { category?: unknown; title?: unknown; folderCode?: unknown }): string {
  return companyDocumentFolderCode(document) === TIME_RECORDING_COMPLIANCE_FOLDER
    ? TIME_RECORDING_COMPLIANCE_CATEGORY
    : typeof document.category === "string" ? document.category : "A classificar";
}

/** Classificação visual conservadora dos sete itens legados do REP-P. */
export function companyDocumentEvidenceSection(document: {
  category?: unknown;
  title?: unknown;
  folderCode?: unknown;
  evidenceSection?: unknown;
}): TimeRecordingEvidenceSection | null {
  if (companyDocumentFolderCode(document) !== TIME_RECORDING_COMPLIANCE_FOLDER) return null;
  if (isTimeRecordingEvidenceSection(document.evidenceSection)) return document.evidenceSection;
  const title = typeof document.title === "string" ? document.title.toLocaleLowerCase("pt-BR") : "";
  if (title.includes("dossiê") || title.includes("dossie")) return "versions";
  if (title.includes("relatório iti") || title.includes("relatorio iti")) return "validation";
  if (title.includes("afd") || title.includes("aej") || title.includes("comprovante")) return "samples";
  return null;
}
