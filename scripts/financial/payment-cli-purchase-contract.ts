import { z } from "zod";

import { PaymentCliError } from "./payment-cli-transport";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,170}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const money = z.number().finite().nonnegative().max(100_000_000);

const purchaseItemSchema = z.object({
  baseItemId: z.string().max(170),
  productId: z.string().max(170).nullable().optional(),
  itemName: z.string().trim().min(1).max(300),
  operationalCategoryId: z.string().max(170).nullable().optional(),
  operationalCategoryName: z.string().max(200).nullable().optional(),
  itemDestination: z.enum(["stock", "asset", "uniform"]).optional(),
  unit: z.string().trim().min(1).max(40),
  purchaseUnitType: z.enum(["content", "package"]).optional(),
  purchaseUnitLabel: z.string().trim().min(1).max(80).optional(),
  quantityOrdered: z.number().finite().positive().max(10_000_000),
  unitPriceOrdered: z.number().finite().positive().max(10_000_000),
  discountOrdered: money.optional(),
  entryType: z.enum(["stock", "asset", "uniform"]).optional(),
  itemTreatment: z.enum(["stock", "uniform", "asset", "asset_component", "service", "expense"]).optional(),
  notes: z.string().max(500).nullable().optional(),
}).strict();

export const purchaseRegistrationSchema = z.object({
  supplierId: id,
  supplierName: z.string().trim().min(2).max(200),
  destinationKioskId: id.optional(),
  receiptMode: z.literal("future_delivery"),
  paymentMethod: z.literal("boleto"),
  paymentCondition: z.literal("installments"),
  paymentDueDate: isoDate,
  installmentsCount: z.number().int().min(2).max(100),
  installmentDueDates: z.array(isoDate).min(2).max(100),
  estimatedReceiptDate: isoDate,
  accountPlanId: id,
  accountPlanName: z.string().trim().min(1).max(200),
  resultCenterId: id.optional(),
  resultCenterName: z.string().trim().min(1).max(200).optional(),
  deliveryFee: z.literal(0),
  notes: z.string().trim().min(1).max(1000),
  expectedTotalCents: z.number().int().positive().max(100_000_000),
  items: z.array(purchaseItemSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.installmentsCount !== value.installmentDueDates.length) {
    context.addIssue({ code: "custom", path: ["installmentDueDates"], message: "A quantidade de vencimentos deve corresponder às parcelas." });
  }
  const totalCents = Math.round(value.items.reduce((sum, item) =>
    sum + item.quantityOrdered * item.unitPriceOrdered - (item.discountOrdered ?? 0), 0) * 100);
  if (totalCents !== value.expectedTotalCents) {
    context.addIssue({ code: "custom", path: ["items"], message: "A soma dos itens difere do total confirmado." });
  }
});

export const purchaseFiscalSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(40),
  invoiceSeries: z.string().trim().min(1).max(20),
  invoiceAccessKey: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{44}$/)),
  issuedAt: isoDate,
  authorizationProtocol: z.string().trim().min(1).max(80),
  supplierDocument: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{14}$/)),
  recipientDocument: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{14}$/)),
  totalCents: z.number().int().positive().max(100_000_000),
}).strict();

export const supplierEntitySchema = z.object({
  type: z.literal("pessoa_juridica"),
  name: z.string().trim().min(2).max(200),
  fantasyName: z.string().trim().min(2).max(200),
  document: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{14}$/)),
  address: z.object({
    street: z.string().trim().min(2).max(200),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z.string().trim().regex(/^[A-Z]{2}$/),
    zipCode: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8}$/)),
  }).strict(),
  notes: z.string().trim().min(1).max(500).optional(),
}).strict();

export type PurchaseRegistration = z.infer<typeof purchaseRegistrationSchema>;
export type PurchaseFiscal = z.infer<typeof purchaseFiscalSchema>;

export function purchaseCreatePayload(input: PurchaseRegistration) {
  const { expectedTotalCents, ...payload } = input;
  void expectedTotalCents;
  return { ...payload, origin: "direct" as const };
}

export function purchaseFiscalPatch(input: PurchaseFiscal) {
  return {
    invoiceNumber: input.invoiceNumber,
    invoiceAccessKey: input.invoiceAccessKey,
    fiscal: {
      series: input.invoiceSeries,
      issuedAt: input.issuedAt,
      authorizationProtocol: input.authorizationProtocol,
      supplierDocument: input.supplierDocument,
      recipientDocument: input.recipientDocument,
      totalCents: input.totalCents,
    },
  };
}

export function assertPurchaseSnapshot(order: Record<string, unknown>, input: PurchaseRegistration) {
  if (order.supplierId !== input.supplierId) throw new PaymentCliError("O pedido retornado pertence a outro fornecedor.");
  if (order.paymentMethod !== "boleto" || order.paymentCondition !== "installments") {
    throw new PaymentCliError("O pedido retornado não preservou boleto parcelado.");
  }
  if (Number(order.installmentsCount) !== input.installmentsCount
    || JSON.stringify(order.installmentDueDates) !== JSON.stringify(input.installmentDueDates)) {
    throw new PaymentCliError("O pedido retornado não preservou os vencimentos confirmados.");
  }
  if (Math.round(Number(order.totalEstimated) * 100) !== input.expectedTotalCents) {
    throw new PaymentCliError("O pedido retornado não preservou o total confirmado.");
  }
}
