import { z } from "zod";
import { canAccessUnit } from "@/lib/unit-access";
import { AppError } from "@/lib/observability/app-error";
import type { ServerUserContext } from "@/lib/auth-server";
import { FINANCIAL_DRE_START_MONTH_KEY } from "../lib/constants";
import { financialMonthKey } from "../lib/financial-dates";
export const dreReportInputSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  mode: z.enum(["monthly", "twelve_months"]), format: z.enum(["pdf", "xlsx"]),
  kioskIds: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
}).strict().refine(value => new Set(value.kioskIds).size === value.kioskIds.length, "Unidades repetidas.");
export type DreReportInput = z.infer<typeof dreReportInputSchema>;
export function assertDreReportAccess(actor: ServerUserContext, input: DreReportInput, now = new Date()) {
  if (!actor.isDefaultAdmin && (!actor.permissions.financial?.view || !actor.permissions.financial?.dre))
    throw new AppError({ code: "DRE_REPORT_FORBIDDEN", kind: "AUTHORIZATION" });
  if (input.month < FINANCIAL_DRE_START_MONTH_KEY || input.month > financialMonthKey(now)!)
    throw new AppError({ code: "DRE_REPORT_PERIOD", kind: "VALIDATION", safeMessage: "Competência fora do intervalo disponível da DRE." });
  for (const id of input.kioskIds) if (!canAccessUnit(actor.userDoc, id, { isDefaultAdmin: actor.isDefaultAdmin }))
    throw new AppError({ code: "DRE_REPORT_UNIT_FORBIDDEN", kind: "AUTHORIZATION" });
}
