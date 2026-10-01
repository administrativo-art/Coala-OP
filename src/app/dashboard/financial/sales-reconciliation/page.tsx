import { SalesReviewPage } from "@/features/financial/sales-reconciliation/review-page";
import { financialAgentIdentifier } from "@/features/financial/agent/contracts";
import { financialDateKey } from "@/features/financial/lib/financial-dates";
import { latestPublishedDate } from "@/features/financial/receivables/period-review";
import { reviewDate } from "@/features/financial/sales-reconciliation/validation";

const one = (value: string | string[] | undefined) => typeof value === "string" ? value : "";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const dateValue = one(query.date);
  const monthValue = one(query.month);
  const mappingValue = one(query.mapping);
  const stoneCodeValue = one(query.stoneCode);
  const initialDate = reviewDate.safeParse(dateValue).success ? dateValue : "";
  const initialMonth = !initialDate && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue) ? monthValue : "";
  const initialMappingId = financialAgentIdentifier.safeParse(mappingValue).success ? mappingValue : "";
  const initialStoneCode = /^[1-9]\d{0,19}$/.test(stoneCodeValue) ? stoneCodeValue : "";
  const now = new Date();
  const calendarToday = financialDateKey(now) ?? "";
  const publishedThrough = latestPublishedDate(now);
  return <SalesReviewPage key={[initialDate, initialMonth, initialMappingId, initialStoneCode].join(":")}
    initialDate={initialDate} initialMonth={initialMonth}
    initialMappingId={initialMappingId} initialStoneCode={initialStoneCode}
    calendarToday={calendarToday} publishedThrough={publishedThrough} />;
}
