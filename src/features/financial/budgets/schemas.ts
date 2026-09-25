import { z } from "zod";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";

export const budgetFieldsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  accountPlanIds: z.array(z.string().trim().min(1)).min(1).max(30).refine((ids) => new Set(ids).size === ids.length),
});

export const createBudgetSchema = budgetFieldsSchema.extend({
  competenceMonth: financialCompetenceMonthSchema,
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000),
});

export const updateBudgetSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).refine((value) => Object.keys(value).length > 0);

export const createBudgetRuleSchema = budgetFieldsSchema.extend({
  mode: z.enum(["fixed", "expense_average", "expense_previous", "consumption_price"]),
  fixedAmountCents: z.number().int().min(0).max(100_000_000_000).nullable(),
  averageMonths: z.number().int().min(2).max(12).default(3),
  startMonth: financialCompetenceMonthSchema,
  baseProductIds: z.array(z.string().trim().min(1)).max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Não repita o mesmo insumo.").default([]),
  stockKioskId: z.string().trim().min(1).nullable().default(null),
  closingStockDays: z.number().int().min(0).max(60).default(7),
}).superRefine((value, context) => {
  if (value.mode === "fixed" && value.fixedAmountCents === null) {
    context.addIssue({ code: "custom", path: ["fixedAmountCents"], message: "Informe o valor mensal." });
  }
  if (value.mode === "consumption_price" && (value.baseProductIds.length === 0 || !value.stockKioskId)) {
    context.addIssue({ code: "custom", path: ["baseProductIds"], message: "Selecione os insumos e o local do estoque." });
  }
  if (value.mode === "consumption_price" && value.stockKioskId !== "matriz") {
    context.addIssue({ code: "custom", path: ["stockKioskId"], message: "Nesta entrega, a projeção de insumos usa o estoque da matriz." });
  }
});

export const updateBudgetRuleSchema = z.object({ active: z.boolean() });

export const createBudgetProjectSchema = budgetFieldsSchema.extend({
  startMonth: financialCompetenceMonthSchema,
  endMonth: financialCompetenceMonthSchema,
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000),
}).refine((value) => value.endMonth >= value.startMonth, { path: ["endMonth"], message: "O fim deve vir após o início." });

export const updateBudgetProjectSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500).optional(),
}).refine((value) => Object.keys(value).length > 0);
