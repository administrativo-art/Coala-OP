import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import type { DailySalesApiResult } from "../sales-reconciliation/review-state";
import { dailySalesSourceFingerprint } from "../sales-reconciliation/review-state";
import type { PixSourceResult } from "../sales-reconciliation/pix-source";
import type { FeeRequest } from "./contracts";
import { feeHash, feeTotalCents, feeUnits } from "./evidence";
import { buildRecognitionBatches, contractFeeCents, feeComponentIdentity, selectRateContract } from "./recognition";
import type { FeeRecognitionComponent, FeeRecognitionPolicy } from "./recognition-contracts";
const centsDecimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
const decimalUnits = (value: bigint) => `${value / BigInt(1000000000000)}.${String(value % BigInt(1000000000000)).padStart(12, "0")}`;
export function collectSaleRecognition(input: { request: FeeRequest; workspaceId: string; file: ReturnType<typeof parseStoneAgendaXml> | null;
  pix: PixSourceResult | null; review: DailySalesApiResult | null; policy: FeeRecognitionPolicy | null }) {
  const { request, review, policy } = input; const pending: string[] = []; const components: FeeRecognitionComponent[] = [];
  if (!policy?.enabled) pending.push("Configure e habilite a apuração deste vínculo; nenhuma tarifa é inventada.");
  if (!review || review.review.status !== "closed" || review.scope.workspaceId !== input.workspaceId || review.scope.kioskId !== request.kioskId
    || review.mappingId !== request.mappingId || review.scope.stoneCode !== request.stoneCode || review.scope.referenceDate !== request.referenceDate)
    pending.push("Conclua a conciliação do bruto PDV por meio e unidade antes de reconhecer taxas.");
  if (pending.length) return { batches: [], pending };
  const fingerprint = dailySalesSourceFingerprint(review!);
  const proof = (providerId: string, channel: "pix" | "debit_card" | "credit_card", gross: number) => {
    const facts = review!.stoneSales.filter(s => s.channel === channel && s.identifiers.providerTransactionId === providerId && s.grossAmountCents === gross);
    if (facts.length !== 1) return null;
    const matches = review!.cases.filter(c => c.kind === "matched" && c.reviewStatus === "auto_checked" && c.differenceAmountCents === 0
      && c.channel === channel && c.kioskId === request.kioskId && c.businessDate === request.referenceDate && c.stoneSaleIds.includes(facts[0].id)
      && !["unmatched", "candidate_group"].includes(c.matchBasis));
    return matches.length === 1 ? matches[0] : null;
  };
  const common = { soldOn: request.referenceDate, reviewId: review!.review.id, reviewRevision: review!.review.revision, reviewFingerprint: fingerprint };
  if (request.source === "cards") {
    if (!input.file) pending.push("Arquivo de capturas indisponível; não é necessário aguardar pagamento, mas a origem da venda é obrigatória.");
    for (const transaction of input.file?.transactions ?? []) {
      if (transaction.sourceSection !== "FinancialTransactions" || transaction.events.Captures !== 1) continue;
      const soldOn = transaction.captureLocalDateTime ? `${transaction.captureLocalDateTime.slice(0, 4)}-${transaction.captureLocalDateTime.slice(4, 6)}-${transaction.captureLocalDateTime.slice(6, 8)}` : null;
      const badEvent = Object.entries(transaction.events).some(([key, value]) => !["Captures", "Payments"].includes(key) && Number(value) > 0);
      const channel = ["1", "3"].includes(transaction.accountTypeCode ?? "") ? "debit_card" : "credit_card";
      let gross: number; try { gross = feeTotalCents(transaction.installments.map(i => i.grossAmount)); } catch { pending.push("Bruto inválido na captura."); continue; }
      if (soldOn !== request.referenceDate || transaction.currencyCode !== "986" || !["1", "2", "3", "4"].includes(transaction.accountTypeCode ?? "")
        || badEvent || !transaction.installments.length || !proof(transaction.transactionId, channel, gross)) { pending.push("Captura sem pareamento PDV íntegro, com evento adverso ou modalidade não comprovada."); continue; }
      if (transaction.feeTypeCode === "2") { pending.push("Taxa combinada sem segregação; revisar antes de contabilizar."); continue; }
      for (const item of transaction.installments) {
        if (!item.expectedPaymentDate || item.suspendedByChargeback || item.saleFee !== null) { pending.push("Parcela sem vencimento ou com desconto não segregado."); continue; }
        try {
          const grossUnits = feeUnits(item.grossAmount), netUnits = feeUnits(item.netAmount); let feeDecimal: string; let expectedNetDecimal = item.netAmount;
          let measurement: "assessed" | "estimated" = "assessed", basis: "provider_fee" | "capture_net" | "contract" = "provider_fee", contractId: string | null = null, contractVersion: number | null = null;
          if (grossUnits <= BigInt(0) || netUnits > grossUnits) { pending.push("Valores da parcela incompatíveis."); continue; }
          if (item.mdrAmount !== null) feeDecimal = item.mdrAmount;
          else if ((item.netAmount.split(".")[1] ?? "").length > 2 && (item.advanceRateAmount === null || feeUnits(item.advanceRateAmount) === BigInt(0))) {
            // In a capture, original forecast net precedes anticipation. Combined/other sale fees are excluded above.
            feeDecimal = decimalUnits(grossUnits - netUnits); basis = "capture_net";
          } else {
            const contract = selectRateContract(policy!, { date: soldOn!, source: "cards", brandCode: transaction.brandCode, accountTypeCode: transaction.accountTypeCode, installmentCount: transaction.installmentCount ?? transaction.installments.length });
            if (!contract) { pending.push("Taxa desconhecida: sem MDR/precisão comprovada e sem contrato vigente configurado."); continue; }
            const cents = contractFeeCents(item.grossAmount, contract); feeDecimal = centsDecimal(cents);
            expectedNetDecimal = decimalUnits(grossUnits - feeUnits(feeDecimal)); measurement = "estimated"; basis = "contract"; contractId = contract.id; contractVersion = contract.version;
          }
          if (feeUnits(feeDecimal) > grossUnits || feeUnits(feeDecimal) > grossUnits - feeUnits(expectedNetDecimal)) { pending.push("Taxa incompatível com o líquido previsto; residual não foi classificado como MDR."); continue; }
          if (measurement === "assessed" && feeUnits(feeDecimal) !== grossUnits - feeUnits(expectedNetDecimal)) { pending.push("Desconto residual não segregado; apuração pendente."); continue; }
          components.push({ ...common, id: feeComponentIdentity(input.workspaceId, request.stoneCode, transaction.transactionId, item.number, "mdr"), kind: "mdr", transactionId: transaction.transactionId, installment: item.number,
            dueOn: item.expectedPaymentDate, grossDecimal: item.grossAmount, feeDecimal, expectedNetDecimal, measurement, basis,
            sourceFileId: input.file!.fileId, sourceHash: feeHash(input.file), contractId, contractVersion, settledOn: null, paidNetDecimal: null, anticipationDecimal: null });
        } catch { pending.push("Parcela/contrato ambíguo ou valores inválidos; nenhuma taxa inferida."); }
      }
    }
  } else {
    const pix = input.pix;
    if (!pix || pix.status !== "available" || !pix.feeEvidence) pending.push("Fonte PIX Stone indisponível; PIX de outro banco exige fonte própria.");
    if (pix?.excludedCount || pix?.feeExcludedCount) pending.push("Há eventos PIX excluídos ou incompletos; conferir cobertura.");
    for (const row of pix?.feeEvidence ?? []) {
      if (!proof(row.e2eId, "pix", row.grossCents)) { pending.push("PIX sem pareamento aprovado com o bruto do PDV."); continue; }
      components.push({ ...common, id: feeComponentIdentity(input.workspaceId, request.stoneCode, row.e2eId, 0, "pix"), kind: "pix", transactionId: row.e2eId, installment: 0,
        dueOn: row.settledOn, grossDecimal: centsDecimal(row.grossCents), feeDecimal: centsDecimal(row.feeCents), expectedNetDecimal: centsDecimal(row.grossCents - row.feeCents),
        measurement: "assessed", basis: "provider_fee", sourceFileId: pix!.fileId!, sourceHash: pix!.sourceHash ?? feeHash(pix), contractId: null, contractVersion: null,
        settledOn: row.settledOn, paidNetDecimal: centsDecimal(row.grossCents - row.feeCents), anticipationDecimal: null });
    }
  }
  return { batches: buildRecognitionBatches(input.workspaceId, request.kioskId, request.stoneCode, components), pending: [...new Set(pending)] };
}
