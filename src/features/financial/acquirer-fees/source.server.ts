import "server-only";
import { AppError } from "@/lib/observability/app-error";
import { parseStoneAgendaXml } from "@/lib/integrations/stone/agenda-parser";
import { fetchStoneAgendaXml } from "@/lib/integrations/stone/agenda-transport";
import { readFinancialAgentMapping } from "../agent/mapping.server";
import { resolveFinancialAgentMapping } from "../agent/mapping";
import type { FinancialAgentMapping } from "../agent/contracts";
import { readPixSalesSource } from "../sales-reconciliation/pix-source.server";
import type { PixSourceResult } from "../sales-reconciliation/pix-source";
import { latestPublishedDate } from "../receivables/period-review";
import { collectFeeEvidence, feeHash } from "./evidence";
import { feeRequestSchema, type FeeRequest } from "./contracts";

export type FeeContext = { isDefaultAdmin: boolean; workspace_id: string; decoded: { uid: string } };
export type FeeDependencies = {
  readMapping: (request: FeeRequest, workspaceId: string) => Promise<FinancialAgentMapping>;
  readStone: (input: { stoneCode: string; referenceDate: string }) => Promise<string>;
  readPix: typeof readPixSalesSource;
  now?: () => Date;
};
export function feeDependencies(signal?: AbortSignal): FeeDependencies {
  return { readMapping: (request, workspaceId) => readFinancialAgentMapping({ ...request, intent: "review_anticipations", prioritizeWithAi: false }, workspaceId),
    readStone: query => fetchStoneAgendaXml(query, { apiKey: process.env.STONE_CONCILIATION_API_KEY, signal }), readPix: readPixSalesSource };
}
export function assertFeeAdmin(context: FeeContext) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "ACQUIRER_FEE_FORBIDDEN", kind: "AUTHORIZATION" });
}
export function validateFeeMapping(mapping: FinancialAgentMapping, request: FeeRequest, workspaceId: string, dates = [request.referenceDate]) {
  for (const referenceDate of dates) {
    const resolved = resolveFinancialAgentMapping([mapping], { ...request, referenceDate, intent: "review_anticipations", prioritizeWithAi: false }, workspaceId);
    if (resolved.id !== request.mappingId) throw new AppError({ code: "ACQUIRER_FEE_MAPPING_CHANGED", kind: "CONFLICT" });
  }
}
export async function queryFeeEvidence(raw: unknown, context: FeeContext, deps: FeeDependencies) {
  assertFeeAdmin(context);
  const parsed = feeRequestSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "ACQUIRER_FEE_QUERY_INVALID", kind: "VALIDATION" });
  const request = parsed.data;
  if (request.referenceDate > latestPublishedDate((deps.now ?? (() => new Date()))())) throw new AppError({ code: "ACQUIRER_FEE_NOT_PUBLISHED", kind: "VALIDATION", safeMessage: "Selecione uma data já publicada pela Stone." });
  const mapping = await deps.readMapping(request, context.workspace_id);
  validateFeeMapping(mapping, request, context.workspace_id);
  let payment: ReturnType<typeof parseStoneAgendaXml> | null = null;
  const originals: ReturnType<typeof parseStoneAgendaXml>[] = [];
  const pending: string[] = [];
  let pix: PixSourceResult = { status: "not_configured", coverage: null,
    facts: [], excludedCount: 0, fileId: null };
  if (request.source === "pix") pix = await deps.readPix({ workspaceId: context.workspace_id, kioskId: request.kioskId, stoneCode: request.stoneCode, referenceDate: request.referenceDate });
  else {
    payment = parseStoneAgendaXml(await deps.readStone(request), request);
    const transactions = payment.transactions.filter(t => t.sourceSection === "FinancialTransactionsAccounts" && t.events.Payments);
    if (transactions.reduce((sum, t) => sum + t.installments.length, 0) > 500) throw new AppError({ code: "ACQUIRER_FEE_SOURCE_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Máximo de 500 parcelas por consulta. Não houve lançamento." });
    const ids = new Set(transactions.map(t => t.transactionId));
    const dates = [...new Set(transactions.flatMap(t => t.captureLocalDateTime ? [`${t.captureLocalDateTime.slice(0, 4)}-${t.captureLocalDateTime.slice(4, 6)}-${t.captureLocalDateTime.slice(6, 8)}`] : []))].filter(date => date <= request.referenceDate).sort();
    if (dates.length > 31) pending.push("Há origens além do limite de 31 datas; parcelas sem origem ficam pendentes.");
    for (let start = 0; start < Math.min(dates.length, 31); start += 2) await Promise.all(dates.slice(start, Math.min(start + 2, 31)).map(async referenceDate => {
      try {
        const query = { stoneCode: request.stoneCode, referenceDate };
        const file = referenceDate === request.referenceDate ? payment! : parseStoneAgendaXml(await deps.readStone(query), query);
        originals.push({ ...file, transactions: file.transactions.filter(t => ids.has(t.transactionId)) });
      } catch (error) {
        if (error instanceof AppError && ["STONE_AGENDA_UPSTREAM_REJECTED", "STONE_AGENDA_UNAVAILABLE"].includes(error.code)) pending.push(`Origem ${referenceDate} indisponível; parcelas não contabilizadas.`);
        else throw error;
      }
    }));
  }
  const evidence = collectFeeEvidence(request, context.workspace_id, payment, originals, pix);
  const after = await deps.readMapping(request, context.workspace_id);
  if (feeHash(after) !== feeHash(mapping)) throw new AppError({ code: "ACQUIRER_FEE_MAPPING_CHANGED", kind: "CONFLICT", safeMessage: "O vínculo mudou durante a consulta. Atualize a prévia." });
  // Sale competence must belong to the same unit as the payment-day mapping.
  const batches = evidence.batches.filter(batch => {
    try { validateFeeMapping(mapping, request, context.workspace_id, [batch.competenceDate, batch.settledOn]); return true; }
    catch (error) { if (error instanceof AppError) { pending.push("A vigência do vínculo não comprova a unidade na data da venda; grupo pendente."); return false; } throw error; }
  });
  return { request, batches, pending: [...new Set([...pending, ...evidence.pending])], mapping,
    pixSource: request.source === "pix" && pix.fileId && pix.sourceHash ? { fileId: pix.fileId, sourceHash: pix.sourceHash } : null,
    paymentFileId: payment?.fileId ?? null, originalFileIds: originals.map(file => file.fileId).sort() };
}
export type FeeEvidence = Awaited<ReturnType<typeof queryFeeEvidence>>;
