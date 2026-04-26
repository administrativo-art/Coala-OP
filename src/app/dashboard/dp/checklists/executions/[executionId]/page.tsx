import { DPChecklistExecutionPage } from "@/components/dp/dp-checklists-v2-page";

export default async function DPChecklistExecutionRoute({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  return <DPChecklistExecutionPage executionId={executionId} />;
}
