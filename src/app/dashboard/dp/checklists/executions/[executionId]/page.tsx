import { redirect } from "next/navigation";

import { DPChecklistExecutionPage } from "@/components/dp/dp-checklists-v2-page";
import { shouldRedirectLegacyChecklistPages } from "@/features/dp-checklists/lib/rollout";

export default async function DPChecklistExecutionRoute({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  if (await shouldRedirectLegacyChecklistPages()) {
    redirect(`/dashboard/forms/legacy-execution-${executionId}/view`);
  }

  return <DPChecklistExecutionPage executionId={executionId} />;
}
