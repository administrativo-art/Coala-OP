import { CashDifferencesPage } from "@/features/financial/cash-differences/components/cash-differences-page";

export default async function Page({ searchParams }: { searchParams: Promise<{ period?: string; kioskId?: string }> }) {
  const params = await searchParams;
  return <CashDifferencesPage initialPeriod={params.period} initialKioskId={params.kioskId} />;
}
