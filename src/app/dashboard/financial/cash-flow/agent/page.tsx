import { StoneAnticipationsPage } from "@/features/financial/pages/stone-anticipations-page";
import { ReceivablesPage } from "@/features/financial/receivables/receivables-page";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const { topic } = await searchParams;
  if (topic === "receivables") return <ReceivablesPage agentEntry />;
  return <StoneAnticipationsPage agentEntry />;
}
