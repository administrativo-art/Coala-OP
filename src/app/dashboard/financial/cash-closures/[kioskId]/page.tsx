import { CashClosureMonthsPage } from "@/features/financial/cash-closures/components/cash-closure-months-page";

export default async function Page({ params }: { params: Promise<{ kioskId: string }> }) {
  const { kioskId } = await params;
  return <CashClosureMonthsPage kioskId={decodeURIComponent(kioskId)} />;
}
