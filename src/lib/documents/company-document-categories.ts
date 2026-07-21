export const COMPANY_DOCUMENT_CATEGORIES = [
  "Societário",
  "Fiscal e contábil",
  "Trabalhista e RH",
  "Licenças e autorizações",
  "Contratos",
  "Financeiro",
  "Marca e propriedade intelectual",
  "A classificar",
] as const;

export type CompanyDocumentCategory = (typeof COMPANY_DOCUMENT_CATEGORIES)[number];

export function isCompanyDocumentCategory(value: unknown): value is CompanyDocumentCategory {
  return typeof value === "string" && (COMPANY_DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}
