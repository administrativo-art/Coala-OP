import { DocumentGeneratorWorkspace } from "@/components/documents/document-generator-workspace";

export default async function DocumentGeneratorPage(props: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const templateId = Array.isArray(searchParams.template) ? searchParams.template[0] : searchParams.template;
  return <DocumentGeneratorWorkspace initialTemplateId={templateId} />;
}
