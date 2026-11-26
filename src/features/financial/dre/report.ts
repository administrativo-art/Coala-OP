import type { CmvReconciliation } from "./cmv-reconciliation";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";
import { financialDateKey } from "../lib/financial-dates";
import type { calculateDreMetrics } from "./metrics";

export function formatDrePeriod(period: string, abbreviated = false) {
  const [year, month] = period.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, 1));
  if (abbreviated) return `${new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(date).replace(/\.$/, "")}/${year}`;
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
export function formatDreDateTime(value: string | null | undefined) {
  if (!value) return "Não informada";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replace(",", "");
}
export type DreMetrics = ReturnType<typeof calculateDreMetrics>;
export type DreReportMode = "monthly" | "twelve_months";
export function shiftDreMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}
export function dreReportPeriods(month: string, mode: DreReportMode) {
  return Array.from({ length: mode === "monthly" ? 1 : 12 }, (_, index) => shiftDreMonth(month, index - (mode === "monthly" ? 0 : 11)));
}
export const DRE_REPORT_LINES = [
  ["revBruta", "Receita bruta (vendas PDV)", 1], ["impostos", "(-) Impostos e deduções", -1],
  ["recLiq", "Receita líquida", 1], ["cmv", "(-) CMV", -1], ["margBruta", "Margem bruta", 1],
  ["custVar", "(-) Custos variáveis", -1], ["margContr", "Margem de contribuição", 1],
  ["pessoal", "(-) Pessoal", -1], ["despOp", "(-) Despesas operacionais", -1],
  ["ocupacao", "(-) Ocupação", -1], ["semCategoria", "(-) Sem categoria", -1],
  ["cashShortage", "(-) Faltas de caixa", -1], ["cashSurplus", "(+) Sobras de caixa", 1],
  ["resOp", "EBIT (resultado operacional)", 1], ["recFin", "(+) Receitas financeiras", 1],
  ["despFin", "(-) Despesas financeiras", -1], ["recNaoOp", "(+) Receitas não operacionais", 1],
  ["despNaoOp", "(-) Despesas não operacionais", -1], ["lair", "Resultado antes dos impostos", 1],
  ["irCsll", "(-) IRPJ / CSLL", -1], ["lucroLiq", "Lucro líquido", 1],
] as const;
export type DreLineKey = typeof DRE_REPORT_LINES[number][0];
export const reportNumber = (value: number) => Number.isFinite(value) ? value : null;
export function reportRatio(value: number, base: number) { return Number.isFinite(value) && Number.isFinite(base) && base > 0 ? value / base : null; }
export function reportVariation(value: number, previous: number) {
  return Number.isFinite(value) && Number.isFinite(previous) && previous !== 0 ? (value - previous) / Math.abs(previous) : null;
}
/** No source query is issued before the operational start; even expense-only rows are unknown. */
export function restrictDreReportCoverage(period: string, metrics: DreMetrics): DreMetrics {
  if (period >= FINANCIAL_DRE_START_MONTH_KEY) return metrics;
  return { ...metrics, ...Object.fromEntries(DRE_REPORT_LINES.map(([key]) => [key, NaN])), pe: NaN, margContPct: NaN,
    resultState: { status: "unavailable", reasons: ["Competência fora da cobertura operacional da DRE."] } };
}
export type DreReportMonth = {
  period: string; metrics: DreMetrics; partial: boolean; status: string; warnings: string[];
  units: Array<{ id: string; name: string; metrics: DreMetrics }>;
};
export type DreReport = {
  version: 1; generatedAt: string; mode: DreReportMode; criterion: "stock_movement"; selectedMonth: string;
  scope: string; months: DreReportMonth[]; previous: DreReportMonth | null;
  analysis: string[]; principalExpenses: Array<{ account: string; amount: number }>;
  comparisonNote: string; permissionsNote: string | null; cmvReconciliation?: CmvReconciliation;
};
export function describeReportMonth(period: string, metrics: DreMetrics, generatedAt: string) {
  const today = financialDateKey(generatedAt)!;
  const partial = period === today.slice(0, 7);
  const warnings = [...metrics.resultState.reasons];
  if (partial) warnings.unshift(`Competência em andamento; dados disponíveis até a geração (${formatDreDateTime(generatedAt)} · Belém). Não é um fechamento mensal.`);
  if (period < FINANCIAL_DRE_START_MONTH_KEY) warnings.push(`Competência anterior ao início da cobertura da DRE (${formatDrePeriod(FINANCIAL_DRE_START_MONTH_KEY)}).`);
  if (metrics.expenseIssues.length) warnings.push(`${metrics.expenseIssues.length} inconsistência(s) no contrato das despesas; valores conhecidos não certificam completude.`);
  if (!Number.isFinite(metrics.cmv)) warnings.push("CMV indisponível: resultados dependentes não foram substituídos por zero.");
  return { partial, warnings: [...new Set(warnings)], status: metrics.resultState.status === "unavailable" ? "Indisponível" : warnings.length ? "Provisório" : "Fontes sem pendências de cálculo" };
}
export function comparableDreMonths(current: DreReportMonth, previous: DreReportMonth | null) {
  return !!previous && !current.partial && !previous.partial && Number.isFinite(current.metrics.lucroLiq)
    && Number.isFinite(previous.metrics.lucroLiq) && !current.metrics.expenseIssues.length && !previous.metrics.expenseIssues.length;
}
export function buildDreReportAnalysis(months: DreReportMonth[], previous: DreReportMonth | null) {
  const latest = months.at(-1)!;
  const result: string[] = [];
  if (comparableDreMonths(latest, previous)) {
    const changes = DRE_REPORT_LINES.filter(([key]) => ["recLiq", "cmv", "pessoal", "despOp", "ocupacao", "cashShortage", "lucroLiq"].includes(key))
      .map(([key, label]) => ({ label, delta: latest.metrics[key] - previous!.metrics[key] }))
      .filter(row => Number.isFinite(row.delta)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);
    for (const row of changes) result.push(`${row.label}: variação de ${row.delta.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} frente ao mês anterior.`);
  } else result.push("Comparação homogênea com o mês anterior indisponível. Não foi aplicado pró-rata ou inferido um corte diário para fontes mensais.");
  result.push("As variações não identificam suas causas.");
  result.push(`${months.filter(m => Number.isFinite(m.metrics.lucroLiq)).length}/${months.length} competências com resultado numérico; totais de períodos não foram completados com zero.`);
  return result;
}
