import { BackButton } from "@/components/navigation/back-button";
import { PageContainer } from "@/components/layout/page-container";
import { EditorDocumentsList } from "@/features/documents/editor/ui/editor-documents-list";

export default function DocumentEditorDocumentsPage() {
  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton
            fallbackHref="/dashboard/documents/editor"
            ariaLabel="Voltar ao editor de documentos"
            iconOnly
            variant="ds-secondary"
            className="h-11 w-11 rounded-ds-btn sm:h-9 sm:w-9"
            iconClassName="h-4 w-4"
          />
          <h1 className="text-xl font-extrabold text-ds-ink">Documentos do editor</h1>
        </div>
        <EditorDocumentsList />
      </div>
    </PageContainer>
  );
}
