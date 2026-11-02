import { PageContainer } from "@/components/layout/page-container";
import { AcervoNavigation } from "@/features/documents/central/acervo-navigation";
import { FinancialDocumentArchive } from "@/features/documents/central/financial-archive";
export default function FinancialDocumentArchivePage() {
  return <PageContainer><AcervoNavigation /><FinancialDocumentArchive /></PageContainer>;
}
