import { formatStoneMoney } from "../agent/presentation";
import type { PeriodRow, ReceivablePeriodResult } from "./period-review";

export const receivableQuestions = {
  future: "Quanto está previsto neste recorte?",
  dates: "Quando vencem as parcelas previstas?",
  excluded: "Quais pagamentos ficaram fora da previsão?",
  pending: "O que precisa de conferência?",
} as const;
export type ReceivableQuestion = keyof typeof receivableQuestions;
export type ReceivableEvidenceFilter = "all" | PeriodRow["status"] | "paid_records" | "attention";

export function receivableRowMatches(row: PeriodRow, filter: ReceivableEvidenceFilter) {
  if (filter === "all") return true;
  if (filter === "paid_records") return row.status === "paid" || row.status === "paid_early";
  if (filter === "attention") return row.status === "needs_review" || row.status === "overdue_unconfirmed";
  return row.status === filter;
}

const date = (value: string) => value.split("-").reverse().join("/");

/** Uses only the authenticated query result; changing questions performs no new read. */
export function receivableAnswer(result: ReceivablePeriodResult, question: ReceivableQuestion): {
  answer: string; filter: ReceivableEvidenceFilter; evidenceLabel: string;
} {
  const { summary, rows, period, missingDates } = result;
  const scope = `Vendas capturadas de ${date(period.from)} a ${date(period.through)}, com eventos conferidos até ${date(period.through)}.`;
  const limit = "Não representa a carteira completa nem saldo disponível. Pagamento Stone não confirma crédito bancário.";
  const incomplete = summary.projectedNet === null;
  let answer: string;
  let filter: ReceivableEvidenceFilter;
  let evidenceLabel: string;
  if (question === "future") {
    answer = incomplete
      ? "A previsão líquida não foi apurada: há cobertura vazia ou pendências. Não interprete isso como saldo zero."
      : `Previsão líquida do recorte: ${formatStoneMoney(summary.projectedNet)}, em ${summary.projectedCount} parcela(s). O líquido original já incorpora as taxas da origem; não desconte o MDR novamente.`;
    filter = incomplete ? "all" : "projected";
    evidenceLabel = incomplete ? "Ver parcelas e pendências" : "Ver parcelas previstas";
  } else if (question === "dates") {
    const dates = rows.filter(row => row.status === "projected" && row.dueDate).map(row => row.dueDate!).sort();
    answer = dates.length
      ? `${dates.length} parcela(s) com vencimentos previstos de ${date(dates[0])} a ${date(dates[dates.length - 1])}. ${incomplete ? "A cobertura tem pendências; essas datas não formam uma agenda completa e o total permanece não apurado." : "Datas posteriores ao último dia conferido; pagamentos posteriores a esse dia não foram consultados."}`
      : "Nenhuma parcela elegível foi identificada como futura neste recorte. Isso não comprova ausência de recebíveis fora dele.";
    filter = "projected";
    evidenceLabel = "Ver vencimentos previstos";
  } else if (question === "excluded") {
    answer = `${summary.paidEarlyCount} parcela(s) paga(s) antes do vencimento e ${summary.paidCount} outro(s) pagamento(s) compatível(is) foram excluídos da previsão. ${summary.paymentsOutsideCaptureCohort} parcela(s) de pagamento sem captura no recorte não foram somadas nem subtraídas. Pagamentos parciais ou incompatíveis permanecem pendentes, sem saldo residual presumido.`;
    filter = "paid_records";
    evidenceLabel = "Ver pagamentos excluídos";
  } else {
    answer = `${summary.pendingCount} parcela(s) pendente(s), ${summary.overdueUnconfirmedCount} vencida(s) sem pagamento identificado, ${summary.unsupportedCaptureCount} captura(s) sem parcelas utilizáveis e ${missingDates.length} arquivo(s) indisponível(is). ${!rows.length ? "Nenhuma parcela pôde ser exibida; arquivo vazio não prova saldo zero." : "Confira os motivos e as evidências das parcelas antes de concluir."}`;
    filter = "attention";
    evidenceLabel = "Ver parcelas que exigem conferência";
  }
  return { answer: `${scope} ${answer} ${limit}`, filter, evidenceLabel };
}
