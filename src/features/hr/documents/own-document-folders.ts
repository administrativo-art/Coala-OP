import {
  EMPLOYEE_DOCUMENT_CATEGORIES,
  isEmployeeDocumentCategory,
  resolveEmployeeDocumentFolderPath,
  type EmployeeDocumentCategoryId,
} from "@/lib/hr/employee-document-options";
import { documentCategoryLabel } from "@/lib/hr/employee-document-planning";
import type { EmployeeDossierFolder } from "@/lib/hr/employee-document-folder-templates";

export type OwnFolderDocument = {
  id: string;
  category: string | null;
  documentType: string | null;
  documentTypeCode: string | null;
  destinationTrail: string[];
  publishedAt: string | null;
};

export type OwnDocumentFolder<T extends OwnFolderDocument = OwnFolderDocument> = {
  key: string;
  path: string[];
  documents: T[];
};

function categoryOf(document: OwnFolderDocument): EmployeeDocumentCategoryId {
  return document.category && isEmployeeDocumentCategory(document.category)
    ? document.category
    : "pending_classification";
}

export function ownDocumentFolderPath(document: OwnFolderDocument): string[] {
  const category = categoryOf(document);
  return [
    documentCategoryLabel(category),
    ...resolveEmployeeDocumentFolderPath({
      category,
      documentTypeCode: document.documentTypeCode,
      documentTypeLabel: document.documentType,
      destinationTrail: document.destinationTrail,
    }),
  ];
}

export function groupOwnDocumentsByFolder<T extends OwnFolderDocument>(documents: T[], templateFolders: EmployeeDossierFolder[] = []): OwnDocumentFolder<T>[] {
  const groups = new Map<string, OwnDocumentFolder<T>>();
  for (const folder of templateFolders.filter((entry) => entry.employeeVisible)) {
    const path = [documentCategoryLabel(folder.category), ...folder.path];
    const key = path.join("/");
    if (!groups.has(key)) groups.set(key, { key, path, documents: [] });
  }
  for (const document of documents) {
    const path = ownDocumentFolderPath(document);
    const key = path.join("/");
    const current = groups.get(key);
    if (current) current.documents.push(document);
    else groups.set(key, { key, path, documents: [document] });
  }
  const categoryOrder = new Map<string, number>(EMPLOYEE_DOCUMENT_CATEGORIES.map((category, index) => [category.label, index]));
  return [...groups.values()]
    .map((group) => ({
      ...group,
      documents: [...group.documents].sort((left, right) =>
        String(right.publishedAt).localeCompare(String(left.publishedAt))
        || String(left.documentType).localeCompare(String(right.documentType), "pt-BR")),
    }))
    .sort((left, right) =>
      (categoryOrder.get(left.path[0]) ?? 999) - (categoryOrder.get(right.path[0]) ?? 999)
      || left.key.localeCompare(right.key, "pt-BR"));
}
