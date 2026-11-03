import { DocumentGeneratorWorkspace } from "@/components/documents/document-generator-workspace";
import { BackButton } from "@/components/navigation/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { DocumentModelsLink } from "@/features/documents/central/document-create-link";

export default async function DocumentGeneratorPage(props: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const templateId = Array.isArray(searchParams.template) ? searchParams.template[0] : searchParams.template;
  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton
            fallbackHref="/dashboard/documents"
            ariaLabel="Voltar ao Acervo"
            iconOnly
            variant="ds-secondary"
            className="h-11 w-11 rounded-ds-btn sm:h-9 sm:w-9"
            iconClassName="h-4 w-4"
          />
          <DocumentModelsLink />
        </div>
        <DocumentGeneratorWorkspace initialTemplateId={templateId} />
      </div>
    </PageContainer>
  );
}
