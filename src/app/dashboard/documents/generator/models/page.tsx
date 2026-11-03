import DocumentTemplatesPage from "@/features/hr/documents/template-library-workspace";
import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
export default function GeneratorModelsPage() {
  return <PageContainer><div className="mb-4"><BackButton fallbackHref="/dashboard/documents/generator" ariaLabel="Voltar ao Gerador" /></div><DocumentTemplatesPage /></PageContainer>;
}
