import {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  type EmployeeDocumentCategoryId,
} from "@/lib/hr/employee-document-options";

export const MAX_EMPLOYEE_DOCUMENT_BYTES = 15 * 1024 * 1024;

export const ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export type EmployeeDocumentPlanInput = {
  employeeId: string;
  employeeName?: string | null;
  category: EmployeeDocumentCategoryId;
  documentType: string;
  originalName: string;
  documentId: string;
  mimeType?: string | null;
};

export function documentCategoryLabel(category: EmployeeDocumentCategoryId) {
  return EMPLOYEE_DOCUMENT_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function slugForDocumentPath(value: string, fallback = "documento") {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || fallback;
}

export function fileExtension(originalName: string, mimeType?: string | null) {
  const extension = originalName.split(".").pop()?.trim().toLowerCase();
  if (extension && extension !== originalName.toLowerCase() && /^[a-z0-9]{2,8}$/.test(extension)) {
    return extension;
  }
  return mimeType ? MIME_EXTENSION[mimeType] ?? "bin" : "bin";
}

function fileBaseName(originalName: string) {
  const withoutExtension = originalName.replace(/\.[^.]+$/, "");
  return slugForDocumentPath(withoutExtension, "arquivo").slice(0, 60);
}

export function buildEmployeeDocumentPlan(input: EmployeeDocumentPlanInput) {
  const categoryLabel = documentCategoryLabel(input.category);
  const typeSlug = slugForDocumentPath(input.documentType, "tipo").slice(0, 60);
  const originalSlug = fileBaseName(input.originalName);
  const extension = fileExtension(input.originalName, input.mimeType);
  const shortId = input.documentId.replace(/-/g, "").slice(0, 8);

  // Nome para download: SEM nome completo do colaborador e SEM CPF.
  // (O tipo documental — ex.: CONTRACHEQUE — é permitido, como no padrão da spec.)
  const fileName = `${typeSlug}__${originalSlug}__${shortId}.${extension}`;

  // Caminho físico: APENAS identificadores técnicos. Nada de nome, CPF, cargo,
  // tipo médico ou descrição disciplinar no path (evita vazamento de PII).
  const storageSubfolder = `hr/employee-documents/${input.employeeId}/documents/${input.documentId}`;

  return {
    categoryLabel,
    typeSlug,
    fileName,
    storageSubfolder,
    storagePath: `${storageSubfolder}/original.${extension}`,
    destinationTrail: ["Documentos do colaborador", categoryLabel, input.documentType],
  };
}

export function isAllowedEmployeeDocumentMimeType(value: string) {
  return ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES.includes(value as typeof ALLOWED_EMPLOYEE_DOCUMENT_MIME_TYPES[number]);
}
