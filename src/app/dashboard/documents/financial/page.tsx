import { FinancialDocumentArchive } from "@/features/documents/central/financial-archive";
import { redirect } from "next/navigation";
import { companyArchiveHref } from "@/lib/documents/company-archive-navigation";
export default async function FinancialDocumentArchivePage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  if (scope !== "identified" && scope !== "archived") redirect(companyArchiveHref("Financeiro"));
  return <FinancialDocumentArchive />;
}
