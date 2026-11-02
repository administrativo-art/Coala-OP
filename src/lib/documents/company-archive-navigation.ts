/** Presentation only: category values and existing document/storage identities stay unchanged. */
const COMPANY_FOLDER_ORDER = [
  "Societário", "Fiscal e contábil", "Trabalhista e RH", "Sistemas e conformidade",
  "Licenças e autorizações", "Contratos", "Financeiro", "Jurídico",
  "Marca e propriedade intelectual", "Modelos", "A classificar",
] as const;

export function companyArchiveFolderLabel(name: string): string {
  const index = (COMPANY_FOLDER_ORDER as readonly string[]).indexOf(name);
  return index < 0 ? name : `${String(index + 1).padStart(2, "0")} - ${name}`;
}

export function companyArchiveHref(category?: string): string {
  return `/dashboard/documents/company${category ? `?category=${encodeURIComponent(category)}` : ""}`;
}
