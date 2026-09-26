import { z } from "zod";
import { financialCompetenceMonthSchema } from "@/features/financial/lib/expense-accounting-contract";

export const budgetIdSchema = z.string().trim().min(1).max(180).refine((id) => !id.includes("/") && !["__proto__", "constructor", "prototype"].includes(id));
const amountSchema = z.number().int().min(0).max(100_000_000_000);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((day) => {
  const date = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}, "Informe uma data válida.");
const personFields = z.object({
  id: budgetIdSchema,
  employeeId: budgetIdSchema,
  accountPlanId: budgetIdSchema,
  amountCents: amountSchema,
});
export const budgetPersonInputSchema = personFields.extend({
  expectedPurchaseDate: dateSchema,
  estimateSource: z.enum(["manual", "fixed"]).default("manual"),
});
export const budgetRulePersonInputSchema = personFields.extend({
  purchaseDay: z.number().int().min(1).max(31),
  purchaseMonthOffset: z.union([z.literal(-1), z.literal(0)]),
});
function checkComposition(value: { accountPlanIds: string[]; composition?: z.infer<typeof personFields>[]; resultCenterId?: string | null }, context: z.RefinementCtx) {
  if (!value.composition) return;
  if (!value.resultCenterId) context.addIssue({ code: "custom", path: ["resultCenterId"], message: "Composição exige um centro identificado." });
  const ids = new Set<string>();
  const people = new Set<string>();
  for (const line of value.composition) {
    const key = JSON.stringify([line.employeeId, line.accountPlanId]);
    if (ids.has(line.id) || people.has(key)) context.addIssue({ code: "custom", path: ["composition"], message: "Não repita linha ou pessoa/conta no mesmo centro." });
    if (!value.accountPlanIds.includes(line.accountPlanId)) context.addIssue({ code: "custom", path: ["composition"], message: "A conta da pessoa deve pertencer ao orçamento." });
    ids.add(line.id); people.add(key);
  }
}

export const budgetFieldsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  accountPlanIds: z.array(budgetIdSchema).min(1).max(30).refine((ids) => new Set(ids).size === ids.length),
});

export const createBudgetSchema = budgetFieldsSchema.extend({
  competenceMonth: financialCompetenceMonthSchema,
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000),
  resultCenterId: budgetIdSchema.nullable().optional(),
  composition: z.array(budgetPersonInputSchema).min(1).max(100).optional(),
}).superRefine((value, context) => {
  checkComposition(value, context);
  if (value.composition && value.composition.reduce((sum, line) => sum + line.amountCents, 0) !== value.budgetedAmountCents) {
    context.addIssue({ code: "custom", path: ["budgetedAmountCents"], message: "O total deve ser a soma da composição." });
  }
});

export const updateBudgetSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  budgetedAmountCents: z.number().int().min(0).max(100_000_000_000).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().min(5).max(500).optional(),
  composition: z.array(budgetPersonInputSchema).min(1).max(100).optional(),
}).refine((value) => Object.keys(value).length > 0).superRefine((value, context) => {
  if (value.composition) checkComposition({ composition: value.composition,
    resultCenterId: "validated-against-stored-budget", accountPlanIds: value.composition.map((line) => line.accountPlanId) }, context);
});

export const createBudgetRuleSchema = budgetFieldsSchema.extend({
  mode: z.enum(["fixed", "expense_average", "expense_previous", "consumption_price"]),
  fixedAmountCents: z.number().int().min(0).max(100_000_000_000).nullable(),
  averageMonths: z.number().int().min(2).max(12).default(3),
  startMonth: financialCompetenceMonthSchema,
  endMonth: financialCompetenceMonthSchema.nullable().optional(),
  generationLeadMonths: z.union([z.literal(0), z.literal(1)]).optional(),
  resultCenterId: budgetIdSchema.nullable().optional(),
  composition: z.array(budgetRulePersonInputSchema).min(1).max(100).optional(),
  baseProductIds: z.array(z.string().trim().min(1)).max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Não repita o mesmo insumo.").default([]),
  stockKioskId: z.string().trim().min(1).nullable().default(null),
  closingStockDays: z.number().int().min(0).max(60).default(7),
}).superRefine((value, context) => {
  checkComposition(value, context);
  if (value.endMonth && value.endMonth < value.startMonth) context.addIssue({ code: "custom", path: ["endMonth"], message: "O fim deve vir após o início." });
  if (value.composition && (value.mode !== "fixed" || value.fixedAmountCents !== value.composition.reduce((sum, line) => sum + line.amountCents, 0))) {
    context.addIssue({ code: "custom", path: ["composition"], message: "Composição automática exige modo fixo e total igual à soma das pessoas." });
  }
  if (value.resultCenterId && value.mode === "consumption_price") context.addIssue({ code: "custom", path: ["mode"], message: "Consumo/estoque por centro ainda não é suportado." });
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

export const budgetCoverageSchema = z.object({
  lineId: budgetIdSchema,
  state: z.enum(["partial", "final", "not_required"]),
  documentIds: z.array(budgetIdSchema).max(20).refine((ids) => new Set(ids).size === ids.length),
  documentFingerprints: z.record(budgetIdSchema, z.string().regex(/^[a-f0-9]{64}$/)).refine((value) => Object.keys(value).length <= 20),
  residualAmountCents: amountSchema.optional(),
  reason: z.string().trim().min(5).max(500),
  confirmed: z.literal(true),
}).superRefine((value, context) => {
  if ((value.state === "not_required") !== (value.documentIds.length === 0)) {
    context.addIssue({ code: "custom", path: ["documentIds"], message: "Cobertura exige documentos; dispensa exige ausência de documentos." });
  }
  if (Object.keys(value.documentFingerprints).length !== value.documentIds.length || value.documentIds.some((id) => !value.documentFingerprints[id])) {
    context.addIssue({ code: "custom", path: ["documentFingerprints"], message: "Atualize a conferência dos documentos." });
  }
  if (value.state !== "partial" && value.residualAmountCents !== undefined && value.residualAmountCents !== 0) {
    context.addIssue({ code: "custom", path: ["residualAmountCents"], message: "Cobertura final tem expectativa zero." });
  }
});

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
