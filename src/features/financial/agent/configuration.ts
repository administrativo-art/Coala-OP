import { z } from "zod";
import { AppError } from "@/lib/observability/app-error";
import { financialAgentIdentifier, financialAgentMappingSchema, type FinancialAgentMapping } from "./contracts";

export const mappingSaveSchema = z.object({
  id: financialAgentIdentifier,
  revision: z.number().int().min(0),
  kioskId: financialAgentIdentifier,
  accountId: financialAgentIdentifier,
  stoneCodes: z.array(z.string().regex(/^[1-9]\d{0,19}$/)).min(1).max(20)
    .refine(values => new Set(values).size === values.length),
  status: z.enum(["active", "inactive"]),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  reason: z.string().trim().min(5).max(1000),
}).strict().superRefine((value, ctx) => {
  const result = financialAgentMappingSchema.safeParse({ ...value, terminalIds: [], workspaceId: "validation" });
  if (!result.success) ctx.addIssue({ code: "custom", message: "Vigência ou vínculo inválido." });
});
export type MappingSave = z.infer<typeof mappingSaveSchema>;
export type MappingView = FinancialAgentMapping & { revision: number; kioskName: string; accountName: string };
export type CatalogOption = { id: string; name: string };
export type CatalogPage<T> = { items: T[]; nextCursor: string | null };

export function mappingsIntersect(a: FinancialAgentMapping, b: FinancialAgentMapping) {
  const historical = (m: FinancialAgentMapping) => m.status === "active" || !!m.validTo;
  const normalized = (code: string) => code.replace(/^0+/, "") || "0";
  return historical(a) && historical(b) && a.stoneCodes.some(code => b.stoneCodes.some(other => normalized(code) === normalized(other))) &&
    a.validFrom <= (b.validTo ?? "9999-12-31") && b.validFrom <= (a.validTo ?? "9999-12-31");
}
export function assertMappingSave(candidate: FinancialAgentMapping, existing: FinancialAgentMapping[], revision: number,
  currentRevision: number | null) {
  if (existing.length > 100 || (currentRevision === null && existing.length >= 100)) {
    throw new AppError({ code: "STONE_MAPPING_LIMIT", kind: "EXPECTED_BUSINESS", safeMessage: "Limite de 100 vínculos atingido." });
  }
  if ((currentRevision === null && revision !== 0) || (currentRevision !== null && currentRevision !== revision)) {
    throw new AppError({ code: "STONE_MAPPING_STALE", kind: "CONFLICT", safeMessage: "O vínculo mudou. Recarregue antes de salvar." });
  }
  if (existing.some(m => m.id !== candidate.id && mappingsIntersect(candidate, m))) {
    throw new AppError({ code: "STONE_MAPPING_OVERLAP", kind: "CONFLICT", safeMessage: "Este StoneCode já possui vínculo nessa vigência. Encerre a vigência anterior antes de cadastrar outra." });
  }
}
