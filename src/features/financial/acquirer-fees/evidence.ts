import { createHash } from "node:crypto";
import { AppError } from "@/lib/observability/app-error";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { compareStonePayments } from "@/lib/integrations/stone/anticipation-review";
import type { PixSourceResult } from "../sales-reconciliation/pix-source";
import type { FeeBatch, FeeComponent, FeeRequest } from "./contracts";

export const MAX_FEE_MEMBERS = 100;
export const feeHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const SCALE = BigInt("1000000000000");
const CENT = SCALE / BigInt(100);
export function feeUnits(value: string) {
  if (!/^\d{1,15}(?:\.\d{1,12})?$/.test(value)) throw new AppError({ code: "ACQUIRER_FEE_INVALID_AMOUNT", kind: "DATA_INTEGRITY" });
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0"));
}
export function feeTotalCents(values: string[]) {
  const units = values.reduce((sum, item) => sum + feeUnits(item), BigInt(0));
  const rounded = (units + CENT / BigInt(2)) / CENT;
  if (rounded > BigInt(100_000_000)) throw new AppError({ code: "ACQUIRER_FEE_AMOUNT_LIMIT", kind: "DATA_INTEGRITY" });
  return Number(rounded);
}
type File = ReturnType<typeof parseStoneAgendaXml>;
export function collectFeeEvidence(request: FeeRequest, workspaceId: string, payment: File | null, originals: File[], pix: PixSourceResult) {
  const components: FeeComponent[] = [];
  const pending: string[] = [];
  const identity = (providerId: string, installment: number, kind: FeeComponent["kind"]) =>
    feeHash(["acquirer_fee", workspaceId, request.stoneCode, providerId, installment, kind]);
  if (!payment && request.source === "cards") pending.push("Arquivo de pagamentos de cartão indisponível; taxas não presumidas como zero.");
  if (payment) {
    if (payment.transactions.filter(t => t.sourceSection === "FinancialTransactionsAccounts" && t.events.Payments)
      .reduce((sum, t) => sum + t.installments.length, 0) > 500) throw new AppError({ code: "ACQUIRER_FEE_SOURCE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Máximo de 500 parcelas por consulta; nada foi lançado." });
    const comparison = compareStonePayments(payment, originals);
    if (comparison.rows.length > 500) throw new AppError({ code: "ACQUIRER_FEE_SOURCE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "O dia excede 500 parcelas de cartão. Não houve lançamento." });
    for (const row of comparison.rows) {
      const paidTransaction = payment.transactions.find(t => t.sourceSection === "FinancialTransactionsAccounts" && t.transactionId === row.transactionId)!;
      const paidItem = paidTransaction.installments.find(i => i.number === row.installment)!;
      const original = originals.flatMap(file => file.transactions).find(t => t.sourceSection === "FinancialTransactions" && t.events.Captures && t.transactionId === row.transactionId);
      const originalItem = original?.installments.find(item => item.number === row.installment);
      const combined = paidTransaction.feeTypeCode === "2" || original?.feeTypeCode === "2" || paidItem.saleFee !== null || originalItem?.saleFee != null;
      if (row.status === "needs_review" || !row.saleDate || !row.paymentDate || !row.paymentId || !original
        || original.currencyCode !== "986" || !["1", "2", "3", "4"].includes(original.accountTypeCode ?? "") || combined) {
        pending.push(combined ? "SaleFee combinado: não segregado nesta entrega; conferir antes de contabilizar." : "Parcela sem origem BRL/cartão, com estorno ou vínculo incompleto: conferência pendente.");
        continue;
      }
      const evidence = { transactionId: row.transactionId, installment: row.installment, paymentId: row.paymentId,
        gross: row.gross, net: row.paidNet, originalNet: row.originalNet };
      // Explicit fees must be nonnegative and fit within the actual retention.
      // A residual is NEVER invented as a new fee.
      try {
        const gross = feeUnits(row.gross), net = feeUnits(row.paidNet);
        const mdr = row.mdr === null ? null : feeUnits(row.mdr);
        const anticipation = row.anticipationFee === null ? null : feeUnits(row.anticipationFee);
        if (net > gross || (mdr ?? BigInt(0)) + (anticipation ?? BigInt(0)) > gross - net) {
          pending.push("Taxas explícitas incompatíveis com a retenção da parcela."); continue;
        }
        if (mdr === null) pending.push("MDR não informado; valor desconhecido não vira zero.");
        else if (mdr > BigInt(0)) components.push({ id: identity(row.transactionId, row.installment, "mdr"), kind: "mdr", amountDecimal: row.mdr!, competenceDate: row.saleDate, settledOn: row.paymentDate, evidence });
        if (anticipation && anticipation > BigInt(0)) {
          if (row.providerAnticipationConfirmed) components.push({ id: identity(row.transactionId, row.installment, "anticipation"), kind: "anticipation", amountDecimal: row.anticipationFee!, competenceDate: row.paymentDate, settledOn: row.paymentDate, evidence });
          else pending.push("Antecipação sem confirmação explícita de data original/custo: pendente.");
        } else if (row.status === "paid_early" && anticipation === null) pending.push("Pagamento antecipado sem custo explícito: diferença não foi classificada como taxa.");
        if ((mdr ?? BigInt(0)) + (anticipation ?? BigInt(0)) < gross - net) pending.push("Há retenção residual não classificada; somente taxas explícitas são elegíveis.");
      } catch (error) {
        if (error instanceof AppError && error.code === "ACQUIRER_FEE_INVALID_AMOUNT") pending.push("Valor negativo ou inválido: ajuste exige revisão.");
        else throw error;
      }
    }
  }
  if (request.source === "pix" && (pix.status !== "available" || !pix.feeEvidence)) pending.push("Arquivo Pix indisponível/incompleto; taxas Pix não presumidas como zero.");
  else if (request.source === "pix" && pix.feeEvidence) {
    if (pix.feeEvidence.length > 500) throw new AppError({ code: "ACQUIRER_FEE_SOURCE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Máximo de 500 registros Pix por consulta; nada foi lançado." });
    if (pix.excludedCount) pending.push(`${pix.excludedCount} registro(s) Pix excluído(s) por evidência incompleta/estorno.`);
    if (pix.feeExcludedCount) pending.push(`${pix.feeExcludedCount} taxa(s) Pix pendente(s): evento financeiro anterior à venda ou futuro.`);
    for (const row of pix.feeEvidence) if (row.feeCents > 0) {
      const amountDecimal = `${Math.floor(row.feeCents / 100)}.${String(row.feeCents % 100).padStart(2, "0")}`;
      components.push({ id: identity(row.e2eId, 0, "pix"), kind: "pix", amountDecimal, competenceDate: row.soldOn, settledOn: row.settledOn,
        evidence: { transactionId: row.e2eId, installment: 0, paymentId: row.eventId, gross: String(row.grossCents), net: String(row.grossCents - row.feeCents), originalNet: null } });
    }
  }
  if (components.length > 500) throw new AppError({ code: "ACQUIRER_FEE_COMPONENT_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "A prévia excede 500 componentes de taxa. Revisão necessária; nada foi lançado." });
  if (new Set(components.map(row => row.id)).size !== components.length) throw new AppError({ code: "ACQUIRER_FEE_DUPLICATE_SOURCE", kind: "DATA_INTEGRITY" });
  const groups = new Map<string, FeeComponent[]>();
  for (const row of components) {
    const key = `${row.kind}:${row.competenceDate}:${row.settledOn}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const batches: FeeBatch[] = [];
  for (const rows of groups.values()) {
    if (rows.length > MAX_FEE_MEMBERS) { pending.push("Grupo com mais de 100 parcelas: revisão necessária; não fracionado para evitar arredondamento duplicado."); continue; }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    for (let start = 0; start < rows.length; start += MAX_FEE_MEMBERS) {
      const members = rows.slice(start, start + MAX_FEE_MEMBERS);
      const amountCents = feeTotalCents(members.map(row => row.amountDecimal));
      if (amountCents === 0) { pending.push("Grupo abaixo de meio centavo: sem lançamento, sem arredondar parcelas individualmente."); continue; }
      const id = feeHash([workspaceId, request.kioskId, request.stoneCode, members.map(row => row.id)]);
      batches.push({ id, fingerprint: feeHash(members), kind: members[0].kind, competenceDate: members[0].competenceDate, settledOn: members[0].settledOn, amountCents, members });
    }
  }
  if (batches.length > 100) throw new AppError({ code: "ACQUIRER_FEE_BATCH_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "A prévia excede 100 grupos. Revisão necessária; nada foi lançado." });
  return { batches: batches.sort((a, b) => a.id.localeCompare(b.id)), pending: [...new Set(pending)] };
}
