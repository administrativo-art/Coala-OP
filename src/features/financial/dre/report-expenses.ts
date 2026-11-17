import { calculateDreExpenses } from "../lib/dre-expense-calculation";
/** Subsets retain the full apportionment policy; never normalize to selected units. */
export function calculateDreReportExpenses(input: Omit<Parameters<typeof calculateDreExpenses>[0], "resultCenter"> & { centers: Array<string | null> }) {
  const calculations = [...new Set(input.centers)].map(resultCenter => calculateDreExpenses({ ...input, resultCenter }));
  return calculations.reduce((sum, calc) => {
    for (const [key, value] of Object.entries(calc.totalsByPosition)) sum.totalsByPosition[key] = (Math.round((sum.totalsByPosition[key] ?? 0) * 100) + Math.round(value * 100)) / 100;
    for (const [key, details] of Object.entries(calc.detailsByPosition)) sum.detailsByPosition[key] = [...(sum.detailsByPosition[key] ?? []), ...details];
    for (const issue of calc.issues) if (!sum.issues.some(i => i.expenseId === issue.expenseId && i.code === issue.code)) sum.issues.push(issue);
    return sum;
  }, { totalsByPosition: {}, detailsByPosition: {}, issues: [] } as ReturnType<typeof calculateDreExpenses>);
}
