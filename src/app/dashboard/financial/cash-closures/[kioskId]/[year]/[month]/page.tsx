import { CashClosureCalendarPage } from "@/features/financial/cash-closures/components/cash-closure-calendar-page";

export default async function Page({ params }: { params: Promise<{ kioskId: string; year: string; month: string }> }) {
  const { kioskId, year, month } = await params;
  return <CashClosureCalendarPage kioskId={decodeURIComponent(kioskId)} year={Number(year)} month={Number(month)} />;
}
