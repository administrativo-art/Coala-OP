import { z } from "zod";

const documentId = z.string().trim().min(1).max(200).regex(/^[^/]+$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Informe uma data válida.");

export const localPurchaseItemSchema = z.object({
  description: z.string().trim().min(1).max(180),
  quantity: z.number().positive().max(100_000),
  unit: z.string().trim().min(1).max(30),
  unitPriceCents: z.number().int().nonnegative().max(100_000_000),
  totalCents: z.number().int().positive().max(100_000_000),
  baseItemId: documentId.nullable().optional(),
  // Entrada no estoque do quiosque: produto cadastrado, quantidade em embalagens e validade. Ausente = consumo direto.
  stock: z.object({
    productId: documentId,
    quantity: z.number().positive().max(100_000),
    expiryDate: isoDate.nullable(),
  }).strict().nullable().optional(),
}).strict();

export const confirmLocalPurchaseSchema = z.object({
  submissionId: z.string().uuid(),
  unitId: documentId,
  supplierName: z.string().trim().min(2).max(240),
  supplierTaxId: z.string().regex(/^\d{14}$/).nullable().optional(),
  purchaseDate: isoDate,
  totalCents: z.number().int().positive().max(100_000_000),
  fundingSource: z.enum(["cash_withdrawal", "company_payment"]),
  companyPaymentMethod: z.enum(["pix", "card_credit", "card_debit", "cash", "boleto", "term"]).nullable(),
  accountPlanId: documentId,
  resultCenterId: documentId,
  note: z.string().trim().max(500).optional(),
  items: z.array(localPurchaseItemSchema).min(1).max(100),
  // Sangria escolhida na tela inicial do app; o servidor revalida tudo no PDV.
  withdrawal: z.object({ sourceId: z.string().regex(/^[a-f0-9]{64}$/), date: isoDate }).strict().nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.withdrawal && value.fundingSource !== "cash_withdrawal") {
    context.addIssue({ code: "custom", path: ["withdrawal"], message: "Somente compra por sangria pode ser vinculada a uma sangria." });
  }
  const itemTotal = value.items.reduce((sum, item) => sum + item.totalCents, 0);
  if (itemTotal !== value.totalCents) {
    context.addIssue({ code: "custom", path: ["items"], message: "A soma dos itens deve ser igual ao total da nota." });
  }
  if (value.fundingSource === "cash_withdrawal" && value.companyPaymentMethod !== null) {
    context.addIssue({ code: "custom", path: ["companyPaymentMethod"], message: "Sangria não aceita outro meio de pagamento." });
  }
  if (value.fundingSource === "company_payment" && value.companyPaymentMethod === null) {
    context.addIssue({ code: "custom", path: ["companyPaymentMethod"], message: "Informe como a empresa pagará a compra." });
  }
});

/** Conciliar depois: liga a uma sangria uma compra registrada antes de ela aparecer no aplicativo. */
export const linkLocalPurchaseWithdrawalSchema = z.object({
  purchaseId: documentId,
  withdrawal: z.object({ sourceId: z.string().regex(/^[a-f0-9]{64}$/), date: isoDate }).strict(),
}).strict();

export type ConfirmLocalPurchaseInput = z.infer<typeof confirmLocalPurchaseSchema>;

export function localPurchaseExpenseId(workspaceId: string, submissionId: string) {
  const safeWorkspace = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `local_purchase_${safeWorkspace}_${submissionId}`;
}
