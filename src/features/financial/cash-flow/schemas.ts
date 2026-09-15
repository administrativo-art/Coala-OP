import { z } from "zod";

const civilDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/);
const identifier = z.string().trim().min(1).max(180).refine((value) => !value.includes("/"));

export const cashFlowProjectionQuerySchema = z.object({
  asOf: civilDate,
  days: z.coerce.number().int().min(1).max(91).default(91),
  scope: z.enum(["consolidated", "account", "unit"]).default("consolidated"),
  scopeId: identifier.optional(),
}).superRefine((value, context) => {
  if (value.scope !== "consolidated" && !value.scopeId) {
    context.addIssue({ code: "custom", path: ["scopeId"], message: "Informe a conta ou unidade da visão." });
  }
  if (value.scope === "consolidated" && value.scopeId) {
    context.addIssue({ code: "custom", path: ["scopeId"], message: "A visão consolidada não recebe um identificador." });
  }
});
