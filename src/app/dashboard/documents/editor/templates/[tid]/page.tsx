import { BackButton } from "@/components/navigation/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { EditorLoader } from "@/features/documents/editor/ui/editor-loader";

export default async function DocumentEditorTemplatePage(props: { params: Promise<{ tid: string }> }) {
  const { tid } = await props.params;
  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton
            fallbackHref="/dashboard/documents/editor/templates"
            ariaLabel="Voltar aos modelos do editor"
            iconOnly
            variant="ds-secondary"
            className="h-11 w-11 rounded-ds-btn sm:h-9 sm:w-9"
            iconClassName="h-4 w-4"
          />
        </div>
        <EditorLoader templateId={tid} />
      </div>
    </PageContainer>
  );
}
