import { redirect } from "next/navigation";

import { DPChecklistsV2Page } from "@/components/dp/dp-checklists-v2-page";
import { shouldRedirectLegacyChecklistPages } from "@/features/dp-checklists/lib/rollout";

export default async function DPChecklistsRoute() {
  if (await shouldRedirectLegacyChecklistPages()) {
    redirect("/dashboard/forms");
  }

  return <DPChecklistsV2Page />;
}
