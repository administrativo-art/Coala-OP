import type { runFinancialAgent } from "./service";
export type FinancialAgentResult = Awaited<ReturnType<typeof runFinancialAgent>>;
export const anticipationQuestions = {
  summary: "Houve antecipações nesse dia?",
  fees: "Quanto custaram as antecipações?",
  installments: "Quais parcelas foram antecipadas?",
  future: "Quais vencimentos futuros foram afetados?",
} as const;
export type AnticipationQuestion = keyof typeof anticipationQuestions;
export function formatStoneMoney(value: string | null) {
  if (value === null) return "Não informado";
  // Exact decimal rounding; never convert a 12-decimal financial value to binary float first.
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const digits = fraction.padEnd(3, "0");
  const cents = BigInt(whole) * BigInt(100) + BigInt(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? BigInt(1) : BigInt(0));
  return `${negative && cents > BigInt(0) ? "-" : ""}R$ ${(cents / BigInt(100)).toLocaleString("pt-BR")},${String(cents % BigInt(100)).padStart(2, "0")}`;
}
export function anticipationAnswer(result: FinancialAgentResult, question: AnticipationQuestion) {
  const summary = result.evidence.summary;
  const base = result.evidence.conclusion;
  if (result.evidence.quality === "empty_file_not_proof_of_absence" || (summary.earlyCount === 0 && summary.pendingCount > 0)) {
    return `${base} Não há base suficiente para totalizar antecipações, taxas ou vencimentos afetados com segurança. Confira as pendências; não interprete ausência de identificação como valor zero.`;
  }
  if (question === "fees") return `${base} MDR: ${formatStoneMoney(summary.mdr)}. Custo de antecipação explícito: ${formatStoneMoney(summary.anticipationFee)}. Líquido Stone: ${formatStoneMoney(summary.paidNet)}. O líquido já incorpora as deduções; não desconte as taxas novamente. Valores somente das parcelas antecipadas identificadas, não de todos os pagamentos do dia.`;
  if (question === "future") return `${base} Veja o vencimento original de cada parcela na tabela. Essas parcelas já aparecem como pagas pela Stone e não devem ser contadas novamente como recebimento futuro. Esta consulta não apura o saldo restante da carteira nem confirma entrada no banco.`;
  if (question === "installments") return `${base} ${summary.earlyCount} parcela(s) identificada(s) como pagas antes do prazo; ${summary.pendingCount} vínculo(s) pendente(s). As parcelas estão discriminadas abaixo por transação, vencimento original e pagamento.`;
  return `${base} Parcelas identificadas: ${summary.earlyCount}; bruto: ${formatStoneMoney(summary.gross)}; líquido Stone: ${formatStoneMoney(summary.paidNet)}. Entrada bancária ainda não conciliada.`;
}
