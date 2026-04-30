import { FormTemplateDetailShell } from "@/components/forms/form-template-detail-shell";

export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FormTemplateDetailShell templateId={id} />;
}
