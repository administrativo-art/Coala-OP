import { redirect } from "next/navigation";

import { DPChecklistTemplateBuilderPage } from "@/components/dp/dp-checklists-v2-page";
import { shouldRedirectLegacyChecklistPages } from "@/features/dp-checklists/lib/rollout";

export default async function DPChecklistTemplateEditPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  if (await shouldRedirectLegacyChecklistPages()) {
    redirect(`/dashboard/forms/legacy-template-${templateId}`);
  }

  return <DPChecklistTemplateBuilderPage templateId={templateId} />;
}
