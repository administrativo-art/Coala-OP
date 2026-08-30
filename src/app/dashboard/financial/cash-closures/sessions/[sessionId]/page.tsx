import { CashCountingSessionPage } from "@/features/financial/cash-counting-sessions/components/cash-counting-session-page";

export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <CashCountingSessionPage sessionId={sessionId} />;
}
