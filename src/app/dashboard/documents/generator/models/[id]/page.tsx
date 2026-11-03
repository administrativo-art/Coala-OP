import DocumentTemplateDetailPage from "@/features/hr/documents/template-editor-workspace";
import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
export default function GeneratorModelEditorPage() {
  return <PageContainer variant="wide"><div className="mb-4"><BackButton fallbackHref="/dashboard/documents/generator/models" ariaLabel="Voltar aos modelos" /></div><DocumentTemplateDetailPage /></PageContainer>;
}
