import { redirect } from "next/navigation";

import { DPChecklistManualCreatePage } from "@/components/dp/dp-checklists-v2-page";
import { shouldRedirectLegacyChecklistPages } from "@/features/dp-checklists/lib/rollout";

export default async function DPChecklistManualNewPage() {
  if (await shouldRedirectLegacyChecklistPages()) {
    redirect("/dashboard/forms");
  }

  return <DPChecklistManualCreatePage />;
}
