import type { OnboardingDocument } from "@/types";
import {
  EMPLOYEE_DOCUMENT_TYPE_CATALOG,
  employeeDocumentTypeConfigByCode,
} from "@/lib/hr/employee-document-options";

const LEGACY_DOCUMENT_CODES: Record<string, string> = {
  identity_document: "PERSONAL_ID",
  profile_photo: "PROFILE_PHOTO",
  ctps: "WORK_CARD",
  pis: "PIS_PASEP",
  address_proof: "ADDRESS_PROOF",
  civil_certificate: "CIVIL_CERTIFICATE",
  aso_admission: "ASO_ADMISSION",
  cnh: "PERSONAL_ID",
};

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function onboardingDocumentTypeCode(document: Pick<OnboardingDocument, "id" | "label" | "documentTypeCode">) {
  if (document.documentTypeCode) {
    return employeeDocumentTypeConfigByCode(document.documentTypeCode).code;
  }

  const legacyCode = LEGACY_DOCUMENT_CODES[document.id];
  if (legacyCode) return legacyCode;
  if (/^child_\d+_birth_certificate$/.test(document.id)) return "DEPENDENT_DOCUMENT";
  if (/^child_\d+_vaccination$/.test(document.id)) return "VACCINATION_RECORD";
  if (/^child_\d+_school_attendance$/.test(document.id)) return "SCHOOL_ATTENDANCE";

  const normalizedLabel = normalize(document.label);
  const matched = EMPLOYEE_DOCUMENT_TYPE_CATALOG.find((config) =>
    normalize(config.label) === normalizedLabel || config.aliases.some((alias) => normalize(alias) === normalizedLabel)
  );
  return matched?.code ?? "UNKNOWN_DOCUMENT";
}
