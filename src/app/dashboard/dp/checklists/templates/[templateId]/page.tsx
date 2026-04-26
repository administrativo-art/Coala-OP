import { DPChecklistTemplateBuilderPage } from "@/components/dp/dp-checklists-v2-page";

export default async function DPChecklistTemplateEditPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <DPChecklistTemplateBuilderPage templateId={templateId} />;
}
