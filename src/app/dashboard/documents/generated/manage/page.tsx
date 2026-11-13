import { PageContainer } from "@/components/layout/page-container";
import GeneratedDocumentsWorkspace from "../workspace";
import { BackButton } from "@/components/navigation/back-button";

export default function GeneratedDocumentsManagementPage() {
  return <PageContainer><div className="mb-4"><BackButton fallbackHref="/dashboard/documents/generated" ariaLabel="Voltar aos fluxos" /></div><GeneratedDocumentsWorkspace history /></PageContainer>;
}
