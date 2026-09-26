import type { ExpensePersonAllocation } from "@/features/financial/lib/expense-person-allocations";

/** Presentation of the recorded allocations only; no allocation or financial write. */
export function expensePersonCenterTotals(allocations: ExpensePersonAllocation[]) {
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    const center = allocation.resultCenter?.trim() || "";
    totals.set(center, (totals.get(center) ?? 0) + Math.round(allocation.amount * 100));
  }
  return Array.from(totals, ([resultCenter, amountCents]) => ({ resultCenter, amountCents }));
}
