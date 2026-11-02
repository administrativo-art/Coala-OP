import DocumentTemplatesPage from "@/features/hr/documents/template-library-workspace";
import { PageContainer } from "@/components/layout/page-container";
import { DocumentNavigation } from "@/features/documents/central/document-navigation";
export default function GeneratorModelsPage() {
  return <PageContainer><DocumentNavigation active="generator" /><DocumentTemplatesPage /></PageContainer>;
}
