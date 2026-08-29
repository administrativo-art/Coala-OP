import { CashClosureCalendarPage } from "@/features/financial/cash-closures/components/cash-closure-calendar-page";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ kioskId: string; year: string; month: string }>;
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const { kioskId, year, month } = await params;
  const { sessionId } = await searchParams;
  return <CashClosureCalendarPage kioskId={decodeURIComponent(kioskId)} year={Number(year)} month={Number(month)} sessionId={sessionId} />;
}
