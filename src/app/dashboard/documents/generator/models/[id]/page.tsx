import DocumentTemplateDetailPage from "@/features/hr/documents/template-editor-workspace";
import { PageContainer } from "@/components/layout/page-container";
import { DocumentNavigation } from "@/features/documents/central/document-navigation";
export default function GeneratorModelEditorPage() {
  return <PageContainer variant="wide"><DocumentNavigation active="generator" /><DocumentTemplateDetailPage /></PageContainer>;
}
