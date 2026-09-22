import { AppError } from "@/lib/observability/app-error";
import { queryStoneAnticipationReview, type StoneAnticipationReview } from "@/lib/integrations/stone/anticipation-review";
import { financialAgentPrioritySchema, financialAgentRequestSchema,
  type FinancialActionId, type FinancialAgentMapping, type FinancialAgentRequest } from "./contracts";
import { resolveFinancialAgentMapping } from "./mapping";

export type FinancialAgentAction = { id: FinancialActionId; evidence: string; action: string };
export type FinancialAgentPriorityInput = {
  availableActionIds: FinancialActionId[];
  earlyCount: number;
  pendingCount: number;
  providerConfirmedCount: number;
};
export type FinancialAgentDependencies = {
  resolveMapping: (request: FinancialAgentRequest, workspaceId: string) => Promise<FinancialAgentMapping>;
  readStone: (query: { stoneCode: string; referenceDate: string }) => Promise<string>;
  prioritize?: (input: FinancialAgentPriorityInput) => Promise<unknown>;
};

export function buildFinancialAgentEvidence(review: StoneAnticipationReview) {
  const early = review.rows.filter(row => row.status === "paid_early");
  const incomplete = review.summary.pendingCount > 0 || review.unavailableDates.length > 0 || review.skippedDates.length > 0;
  const missingFees = early.some(row => row.mdr === null || row.anticipationFee === null || !row.providerAnticipationConfirmed);
  // Per-row checking matters: opposite residuals must not cancel out and hide a discrepancy.
  const residual = early.some(row => row.unexplainedDifference !== null && !/^-?0(?:\.0+)?$/.test(row.unexplainedDifference));
  const actions: FinancialAgentAction[] = [];
  if (incomplete) actions.push({ id: "check_origins", evidence: "pendingCount/unavailableDates/skippedDates",
    action: "Conferir origens e parcelas pendentes antes de concluir a análise do dia." });
  if (missingFees) actions.push({ id: "check_fees", evidence: "rows.mdr/anticipationFee/providerAnticipationConfirmed",
    action: "Confirmar taxas ausentes na fonte; diferença residual não comprova custo de antecipação." });
  if (residual) actions.push({ id: "check_residual", evidence: "rows.unexplainedDifference",
    action: "Investigar diferenças por parcela entre bruto, líquido e taxas informadas, sem reclassificar automaticamente." });
  actions.push({ id: "reconcile_bank", evidence: "bankReceiptConfirmed=false",
    action: "Conferir os créditos no extrato da conta vinculada antes de reconhecer caixa realizado." });
  actions.push({ id: "read_full_portfolio", evidence: review.coverage,
    action: "Consultar a carteira e os eventos da registradora antes de afirmar o saldo futuro disponível." });
  return {
    source: "Stone / XML 2.2 / FinancialTransactionsAccounts + FinancialTransactions",
    tool: "queryStoneAnticipationReview",
    nature: "source_data_and_exact_calculations" as const,
    dateBasis: "payment_date" as const,
    stoneCode: review.stoneCode, referenceDate: review.referenceDate,
    collectedAt: review.collectedAt, paymentFileId: review.paymentFileId,
    coverage: review.coverage,
    quality: incomplete ? "partial" as const : review.rows.length === 0 ? "empty_file_not_proof_of_absence" as const : "reviewed_payment_rows" as const,
    summaryScope: "identified_early_payments_only" as const,
    summary: review.summary,
    conclusion: incomplete
      ? "Há dados pendentes. Os totais abrangem somente as parcelas antecipadas identificadas; não representam o total completo do dia."
      : review.rows.length === 0
        ? "O arquivo consultado não contém parcelas de pagamento. Isso não comprova ausência de antecipações ou de recebíveis."
        : early.length === 0
          ? "Não foram identificados pagamentos antecipados nas parcelas comparadas deste arquivo. Isso não representa a carteira completa."
          : "Foram identificadas parcelas pagas antes do vencimento original. As taxas explícitas e as pendências estão discriminadas na evidência.",
    unavailableDates: review.unavailableDates, skippedDates: review.skippedDates,
    bankReceiptConfirmed: false as const, portfolioBalanceConfirmed: false as const,
    drePostingPerformed: false as const, writesPerformed: false as const,
    limitations: [
      "Esta consulta não calcula faturamento do PDV, lucro, DRE nem saldo bancário.",
      "O vínculo vale para a data de pagamento. Não comprova a unidade de origem de cada venda histórica nem a conta efetivamente creditada.",
      "As antecipações identificadas não podem ser somadas novamente ao saldo futuro; esta leitura não baixa ou reconstrói a agenda.",
      "Valores preservam a precisão da fonte; arredondar somente na apresentação.",
    ],
    actions,
  };
}

/** Only registered intent; no natural-language guessing of unit, dates, tool or permissions. */
export async function runFinancialAgent(input: unknown,
  context: { isDefaultAdmin: boolean; workspace_id: string }, dependencies: FinancialAgentDependencies) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "FINANCIAL_AGENT_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = financialAgentRequestSchema.safeParse(input);
  if (!parsed.success) throw new AppError({ code: "FINANCIAL_AGENT_INVALID_REQUEST", kind: "VALIDATION",
    safeMessage: "Informe unidade, StoneCode, data válida e a intenção suportada: review_anticipations." });
  const request = parsed.data;
  const mapping = await dependencies.resolveMapping(request, context.workspace_id);
  // Revalidate the repository boundary; authorization cannot be delegated to the model.
  resolveFinancialAgentMapping([mapping], request, context.workspace_id);
  const review = await queryStoneAnticipationReview({ stoneCode: request.stoneCode, referenceDate: request.referenceDate }, context, dependencies.readStone);
  const evidence = buildFinancialAgentEvidence(review);
  let actions = evidence.actions;
  let reasoningMode: "deterministic" | "ai_prioritized" | "ai_unavailable" | "ai_rejected" = "deterministic";
  if (request.prioritizeWithAi) {
    reasoningMode = "ai_unavailable";
    if (dependencies.prioritize) {
      try {
        // Counts and action IDs only: no credentials, XML, names, account details or transaction IDs.
        const result = financialAgentPrioritySchema.safeParse(await dependencies.prioritize({
          availableActionIds: actions.map(action => action.id),
          earlyCount: review.summary.earlyCount, pendingCount: review.summary.pendingCount,
          providerConfirmedCount: review.summary.providerConfirmedCount,
        }));
        const ids = result.success ? result.data.orderedActionIds : [];
        if (!result.success || ids.length !== actions.length || new Set(ids).size !== actions.length ||
            ids.some(id => !actions.some(action => action.id === id))) {
          reasoningMode = "ai_rejected";
        } else {
          const ordered = ids.map(id => actions.find(action => action.id === id)!);
          actions = ordered;
          reasoningMode = "ai_prioritized";
        }
      } catch {
        // Model availability never replaces source evidence with invented data or raw provider errors.
        reasoningMode = "ai_unavailable";
      }
    }
  }
  return {
    agent: "Coala Financeiro", version: "financial-read-v1", reasoningMode,
    scope: { workspaceId: mapping.workspaceId, kioskId: mapping.kioskId, stoneCode: request.stoneCode,
      accountId: mapping.accountId, mappingId: mapping.id, validFrom: mapping.validFrom, validTo: mapping.validTo ?? null },
    evidence: { ...evidence, actions },
    // Original read-only evidence remains inspectable; the model cannot change any of its fields.
    review,
  };
}
