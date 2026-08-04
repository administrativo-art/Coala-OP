import { CashClosureDayPage } from "@/features/financial/cash-closures/components/cash-closure-day-page";

export default async function Page({
  params,
}: {
  params: Promise<{ kioskId: string; year: string; month: string; day: string }>;
}) {
  const { kioskId, year, month, day } = await params;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return <CashClosureDayPage kioskId={decodeURIComponent(kioskId)} date={date} />;
}
