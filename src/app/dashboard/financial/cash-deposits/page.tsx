import { CashDepositsPage } from "@/features/financial/cash-deposits/cash-deposits-page";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { sessionId } = await searchParams;
  return <CashDepositsPage focusSessionId={sessionId} />;
}
