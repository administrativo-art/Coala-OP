import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentIdentifier, financialAgentMappingSchema } from "../agent/contracts";
import { resolveFinancialAgentMapping } from "../agent/mapping";
import { latestPublishedDate } from "../receivables/period-review";
import { reviewDailySales } from "./daily-review";
import { reviewDate } from "./validation";
import { suggestSalesReconciliationCases } from "./matching";
import type { DailySalesScope } from "./daily-review";
import type { PixSourceResult } from "./pix-source";

export const salesReviewRequestSchema = z.object({
  kioskId: financialAgentIdentifier, mappingId: financialAgentIdentifier,
  stoneCode: z.string().regex(/^[1-9]\d{0,19}$/), referenceDate: reviewDate,
}).strict();
export type SalesReviewRequest = z.infer<typeof salesReviewRequestSchema>;
const bindingSchema = z.object({ mapping: financialAgentMappingSchema, pdvFilialId: z.string().regex(/^\d{1,20}$/) }).strict();
export type SalesReviewBinding = z.infer<typeof bindingSchema>;

export function requireStoredPdvFilial(kiosk: unknown, workspaceId: string): string {
  const parsed = z.object({ pdvFilialId: z.string().trim().regex(/^[1-9]\d{0,19}$/), workspaceId: z.string().optional() }).safeParse(kiosk);
  if (!parsed.success || (parsed.data.workspaceId !== undefined && parsed.data.workspaceId !== workspaceId)) {
    throw new AppError({ code: "SALES_REVIEW_FILIAL_REQUIRED", kind: "EXPECTED_BUSINESS",
      safeMessage: "Cadastre a filial PDV oficial na unidade antes de comparar. Códigos de fallback não são usados nesta consulta." });
  }
  return parsed.data.pdvFilialId;
}

function validateBinding(raw: unknown, request: SalesReviewRequest, workspaceId: string) {
  const parsed = bindingSchema.safeParse(raw);
  if (!parsed.success) throw new AppError({ code: "SALES_REVIEW_BINDING_INVALID", kind: "DATA_INTEGRITY" });
  const binding = parsed.data;
  resolveFinancialAgentMapping([binding.mapping], { ...request, intent: "review_anticipations", prioritizeWithAi: false }, workspaceId);
  if (binding.mapping.id !== request.mappingId) {
    throw new AppError({ code: "SALES_REVIEW_BINDING_CHANGED", kind: "CONFLICT",
      safeMessage: "O vínculo mudou. Recarregue os vínculos antes de consultar novamente." });
  }
  return binding;
}

export async function queryDailySales(raw: unknown, context: { isDefaultAdmin: boolean; workspace_id: string }, dependencies: {
  resolveBinding: (request: SalesReviewRequest, workspaceId: string) => Promise<SalesReviewBinding>;
  readPdv: (input: { filialId: string; referenceDate: string }) => Promise<unknown>;
  readStone: (input: { stoneCode: string; referenceDate: string }) => Promise<string>;
  readPix?: (scope: DailySalesScope) => Promise<PixSourceResult>;
  now?: () => Date; signal?: AbortSignal;
}) {
  if (!context.isDefaultAdmin) throw new AppError({ code: "SALES_REVIEW_FORBIDDEN", kind: "AUTHORIZATION" });
  const parsed = salesReviewRequestSchema.safeParse(raw);
  if (!parsed.success || !financialAgentIdentifier.safeParse(context.workspace_id).success) {
    throw new AppError({ code: "SALES_REVIEW_INVALID_REQUEST", kind: "VALIDATION" });
  }
  const request = parsed.data;
  const now = dependencies.now ?? (() => new Date());
  if (request.referenceDate > latestPublishedDate(now())) {
    throw new AppError({ code: "SALES_REVIEW_NOT_PUBLISHED", kind: "VALIDATION",
      safeMessage: "Escolha uma data já publicada pela Stone: o arquivo é disponibilizado após as 05h do dia seguinte." });
  }
  dependencies.signal?.throwIfAborted();
  const binding = validateBinding(await dependencies.resolveBinding(request, context.workspace_id), request, context.workspace_id);
  dependencies.signal?.throwIfAborted();
  const [pdvCoupons, stoneXml] = await Promise.all([
    dependencies.readPdv({ filialId: binding.pdvFilialId, referenceDate: request.referenceDate }),
    dependencies.readStone({ stoneCode: request.stoneCode, referenceDate: request.referenceDate }),
  ]);
  dependencies.signal?.throwIfAborted();
  const result = reviewDailySales({ scope: { workspaceId: context.workspace_id, kioskId: request.kioskId,
    stoneCode: request.stoneCode, referenceDate: request.referenceDate }, pdvCoupons, stoneXml });
  const pix = dependencies.readPix ? await dependencies.readPix(result.scope)
    : { status: "not_configured" as const, facts: [], excludedCount: 0, fileId: null };
  if (pix.status === "available") {
    result.stoneSales.push(...pix.facts);
    result.cases = suggestSalesReconciliationCases({ pdvFacts: result.pdvFacts, stoneSales: result.stoneSales });
    result.uncomparedPdvFacts = [];
    result.limitations = result.limitations.filter(text => !text.startsWith("Pix não foi comparado:"));
    result.limitations.push(`Pix: arquivo limitado ao dia e StoneCode; ${pix.excludedCount} registro(s) não comparável(is). Não cobre cancelamentos de outros dias nem toda a conta.`);
  }
  const after = validateBinding(await dependencies.resolveBinding(request, context.workspace_id), request, context.workspace_id);
  if (JSON.stringify(after) !== JSON.stringify(binding)) {
    throw new AppError({ code: "SALES_REVIEW_BINDING_CHANGED", kind: "CONFLICT",
      safeMessage: "A unidade, filial ou vínculo Stone mudou durante a coleta. Consulte novamente." });
  }
  dependencies.signal?.throwIfAborted();
  return { ...result, pix: { status: pix.status, excludedCount: pix.excludedCount, fileId: pix.fileId }, mappingId: binding.mapping.id, accountId: binding.mapping.accountId,
    pdvFilialId: binding.pdvFilialId, collectedAt: now().toISOString(),
    limitations: [...result.limitations, "A filial PDV segue o cadastro atual da unidade. Esta consulta não comprova o histórico de mudanças dessa associação."],
  };
}
export type DailySalesResult = Awaited<ReturnType<typeof queryDailySales>>;
