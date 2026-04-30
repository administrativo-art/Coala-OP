import { redirect } from "next/navigation";

import { DPChecklistTemplateBuilderPage } from "@/components/dp/dp-checklists-v2-page";
import { shouldRedirectLegacyChecklistPages } from "@/features/dp-checklists/lib/rollout";

export default async function DPChecklistTemplateNewPage() {
  if (await shouldRedirectLegacyChecklistPages()) {
    redirect("/dashboard/forms");
  }

  return <DPChecklistTemplateBuilderPage />;
}
