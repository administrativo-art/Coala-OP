import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { dbAdmin } from "@/lib/firebase-admin";
import { financialDbAdmin } from "@/lib/firebase-financial-admin";
import { AppError } from "@/lib/observability/app-error";
import { getDreSourceData } from "../dre/source-data.server";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";
import { readReceivablePeriodMapping } from "../receivables/mapping.server";
import { latestPublishedDate, queryReceivablePeriod } from "../receivables/period-review";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { exactSalesCents } from "../sales-reconciliation/validation";
import { analyzeManagement, managementPeriod, managementRequestSchema, FEE_ACCOUNTS,
  type CashEvidence } from "./management";

const fail = (code: string, message: string): never => { throw new AppError({ code, kind: "EXPECTED_BUSINESS", safeMessage: message }); };
const date = (value: unknown): string | null => {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return null;
};

export async function runManagementAnalysis(raw: unknown, context: { isDefaultAdmin: boolean; workspace_id: string }, signal?: AbortSignal) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "FINANCIAL_MANAGEMENT_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = managementRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "FINANCIAL_MANAGEMENT_INVALID", kind: "VALIDATION" });
  const request = parsed.data; const period = managementPeriod(request.month);
  const published = latestPublishedDate(new Date());
  const through = period.through < published ? period.through : published;
  const mappingPeriod = { kioskId: request.kioskId, stoneCode: request.stoneCode, from: period.from, through: period.through };
  const mapping = await readReceivablePeriodMapping(mappingPeriod, context.workspace_id);
  if (mapping.id !== request.mappingId) fail("FINANCIAL_MANAGEMENT_MAPPING_CHANGED", "Recarregue o vínculo oficial.");
  signal?.throwIfAborted();
  const unit = await dbAdmin.collection("kiosks").doc(request.kioskId).get();
  const centers = await financialDbAdmin.collection("resultCenters").where("unitIds", "array-contains", request.kioskId).limit(2).get();
  if (centers.size > 1) fail("FINANCIAL_MANAGEMENT_CENTER_AMBIGUOUS", "A unidade tem mais de um centro de resultado. Revise o cadastro.");
  const center = centers.docs[0]; const centerName = String(center?.data().name ?? unit.data()?.name ?? "");
  if (!centerName || (center?.data().workspaceId && center.data().workspaceId !== context.workspace_id)) fail("FINANCIAL_MANAGEMENT_CENTER_INVALID", "Centro de resultado inválido.");
  const centerNames: Record<string, string> = { [request.kioskId]: centerName, [centerName]: centerName };
  if (center) centerNames[center.id] = centerName;
  const from = Timestamp.fromDate(new Date(`${period.from}T00:00:00-03:00`));
  const end = Timestamp.fromDate(new Date(`${period.through}T23:59:59.999-03:00`));
  const [source, transactions, expenseSnapshot, receivables] = await Promise.all([
    getDreSourceData({ workspaceId: context.workspace_id, kioskIds: [request.kioskId], periods: [period.previous, request.month].filter(month => month >= FINANCIAL_DRE_START_MONTH_KEY), canViewExpenseDetails: true }),
    financialDbAdmin.collection("transactions").where("accountId", "==", mapping.accountId)
      .where("date", ">=", from).where("date", "<=", end).limit(501).get(),
    financialDbAdmin.collection("expenses").where("resultCenter", "in", [...new Set([request.kioskId, centerName, ...(center ? [center.id] : [])])])
      .where("dueDate", ">=", from).where("dueDate", "<=", end).limit(501).get(),
    request.includeStone && through >= period.from ? queryReceivablePeriod({ ...mappingPeriod, through }, context, {
      resolveMapping: readReceivablePeriodMapping,
      read: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }),
    }) : Promise.resolve(null),
  ]);
  if (transactions.size > 500 || expenseSnapshot.size > 500) fail("FINANCIAL_MANAGEMENT_LIMIT", "A consulta excede 500 movimentos ou despesas. Use os relatórios operacionais paginados.");
  const accountIds = [...new Set([...Object.values(FEE_ACCOUNTS), ...source.expenses.flatMap(expense => [
    expense.accountId, expense.accountPlan, ...(expense.accountAllocations ?? []).map(a => a.accountPlanId),
  ]).filter((id): id is string => typeof id === "string" && !!id)])];
  if (accountIds.length > 500 || accountIds.some(id => id.includes("/"))) fail("FINANCIAL_MANAGEMENT_ACCOUNTS", "Plano de contas excede o limite ou contém referência inválida.");
  const accounts = await financialDbAdmin.getAll(...accountIds.map(id => financialDbAdmin.collection("accounts").doc(id)));
  const accountMeta = Object.fromEntries(accounts.filter(doc => doc.exists).map(doc => {
    const data = doc.data()!;
    if (data.workspaceId && data.workspaceId !== context.workspace_id) fail("FINANCIAL_MANAGEMENT_ACCOUNT_SCOPE", "Conta contábil fora do escopo.");
    return [doc.id, { name: String(data.name ?? doc.id), drePosition: typeof data.dre_position === "string" ? data.dre_position : null, isDreAccount: data.is_dre_account !== false }];
  }));
  const movements: CashEvidence[] = []; let excludedCount = 0;
  for (const doc of transactions.docs) {
    const row = doc.data(); const amount = exactSalesCents(row.amount); const occurredAt = date(row.date);
    if (row.reversed === true || row.auditStatus === "reversed") continue;
    if ((row.workspaceId && row.workspaceId !== context.workspace_id) || !occurredAt || amount === null
      || !["in", "out"].includes(row.direction)) { excludedCount++; continue; }
    movements.push({ id: doc.id, date: occurredAt, amountCents: amount, direction: row.direction,
      status: row.importedFrom === "bank_statement" ? "bank_confirmed" : "reported",
      expenseId: typeof (row.expenseId ?? row.linkedExpenseId) === "string" ? row.expenseId ?? row.linkedExpenseId : null });
  }
  const linked = new Set(movements.filter(row => row.status === "bank_confirmed" && row.expenseId).map(row => row.expenseId));
  for (const doc of expenseSnapshot.docs) {
    const row = doc.data();
    if (["paid", "draft", "cancelled", "reconciled"].includes(row.status) || row.cashEffectIncludedInNetReceivable === true) continue;
    const due = date(row.dueDate);
    const remaining = row.status === "partially_paid" ? row.settlementSummary?.balanceAmountCents : exactSalesCents(row.totalValue);
    // Do not subtract a bank movement from an unreconciled obligation by guessing.
    if ((linked.has(doc.id) && row.status !== "partially_paid") || row.isApportioned || row.hasPersonAllocations || !due
      || (row.workspaceId && row.workspaceId !== context.workspace_id)
      || !["pending", "provisioned", "partially_paid"].includes(row.status)
      || !Number.isSafeInteger(remaining) || remaining < 0 || remaining > 100_000_000_000) { excludedCount++; continue; }
    const account = row.bankAccountId ?? row.paymentAccountId;
    if (account && account !== mapping.accountId) continue;
    movements.push({ id: doc.id, date: due, amountCents: remaining, direction: "out", status: "forecast", expenseId: doc.id });
  }
  const after = await readReceivablePeriodMapping(mappingPeriod, context.workspace_id);
  if (JSON.stringify(after) !== JSON.stringify(mapping)) fail("FINANCIAL_MANAGEMENT_MAPPING_CHANGED", "O vínculo mudou durante a consulta. Consulte novamente.");
  signal?.throwIfAborted();
  return { ...analyzeManagement({ request, source, accounts: accountMeta, centerName, centerNames,
    // No canonical bank-balance source is connected in this implementation.
    // Statement movements prove cash activity, never an opening/closing balance.
    cash: { movements, excludedCount, confirmedBalance: null }, receivables }),
    scope: { ...request, accountId: mapping.accountId }, collectedAt: new Date().toISOString(),
    sourceStats: source.stats, receivableCoverage: receivables?.coverage ?? "not_requested_or_unavailable" };
}
export type ManagementResult = Awaited<ReturnType<typeof runManagementAnalysis>>;
