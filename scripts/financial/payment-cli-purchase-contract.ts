import { z } from "zod";

import { PaymentCliError } from "./payment-cli-transport";
import { validBrazilianTaxId } from "../../src/features/financial/beneficiaries/normalization";

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
  purchaseUnitType: z.enum(["content", "logistic"]).optional(),
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
  externalOrderNumber: z.string().trim().min(1).max(80).optional(),
  destinationKioskId: id.optional(),
  receiptMode: z.literal("future_delivery"),
  paymentMethod: z.enum(["boleto", "pix"]),
  paymentCondition: z.enum(["installments", "cash"]),
  paymentDueDate: isoDate,
  installmentsCount: z.number().int().min(1).max(100).optional(),
  installmentDueDates: z.array(isoDate).max(100).optional(),
  estimatedReceiptDate: isoDate,
  accountPlanId: id,
  accountPlanName: z.string().trim().min(1).max(200),
  resultCenterId: id.optional(),
  resultCenterName: z.string().trim().min(1).max(200).optional(),
  deliveryFee: money,
  freightPaymentMode: z.enum(["included_with_goods", "separate"]).optional(),
  freightAccountPlanId: id.optional(),
  freightAccountPlanName: z.string().trim().min(1).max(200).optional(),
  freightSupplierId: id.nullable().optional(),
  freightSupplierName: z.string().trim().min(2).max(200).nullable().optional(),
  notes: z.string().trim().min(1).max(1000),
  expectedTotalCents: z.number().int().positive().max(100_000_000),
  items: z.array(purchaseItemSchema).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.paymentCondition === "installments"
    ? value.paymentMethod !== "boleto" || !value.installmentsCount || value.installmentsCount < 2 || value.installmentsCount !== value.installmentDueDates?.length
    : value.paymentMethod !== "pix" || (value.installmentsCount ?? 1) !== 1 || (value.installmentDueDates?.length ?? 0) !== 0) {
    context.addIssue({ code: "custom", path: ["installmentDueDates"], message: "A quantidade de vencimentos deve corresponder às parcelas." });
  }
  if (value.deliveryFee > 0 && (!value.freightAccountPlanId || !value.freightPaymentMode
    || value.freightPaymentMode === "separate" && !value.freightSupplierName)) {
    context.addIssue({ code: "custom", path: ["deliveryFee"], message: "Frete exige conta, forma de pagamento e favorecido." });
  }
  const totalCents = Math.round(value.items.reduce((sum, item) =>
    sum + item.quantityOrdered * item.unitPriceOrdered - (item.discountOrdered ?? 0), value.deliveryFee) * 100);
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
  supplierDocument: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{14}$/).refine(validBrazilianTaxId)),
  recipientDocument: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{14}$/).refine(validBrazilianTaxId)),
  totalCents: z.number().int().positive().max(100_000_000),
}).strict().refine((value) => value.invoiceAccessKey.slice(6, 20) === value.supplierDocument,
  { path: ["invoiceAccessKey"], message: "O emitente da chave não corresponde ao fornecedor da nota." });

export const supplierEntitySchema = z.object({
  type: z.enum(["pessoa_fisica", "pessoa_juridica"]),
  name: z.string().trim().min(2).max(200),
  fantasyName: z.string().trim().min(2).max(200).optional(),
  document: z.string().transform((value) => value.replace(/\D/g, "")).refine(validBrazilianTaxId, "CPF/CNPJ inválido."),
  address: z.object({
    street: z.string().trim().min(2).max(200),
    number: z.string().trim().min(1).max(30),
    complement: z.string().trim().max(120).optional(),
    neighborhood: z.string().trim().min(2).max(120),
    city: z.string().trim().min(2).max(120),
    state: z.string().trim().regex(/^[A-Z]{2}$/),
    zipCode: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().regex(/^\d{8}$/)),
  }).strict().optional(),
  notes: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
  if ((value.type === "pessoa_fisica" ? value.document.length !== 11 : value.document.length !== 14)
    || (value.type === "pessoa_juridica" && (!value.fantasyName || !value.address))) {
    context.addIssue({ code: "custom", path: ["document"], message: "Tipo, documento, nome fantasia ou endereço incompatível." });
  }
});

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
      protocol: input.authorizationProtocol,
      issuerCnpj: input.supplierDocument,
      authorizationProtocol: input.authorizationProtocol,
      supplierDocument: input.supplierDocument,
      recipientDocument: input.recipientDocument,
      totalCents: input.totalCents,
    },
  };
}

export function assertPurchaseSnapshot(order: Record<string, unknown>, input: PurchaseRegistration) {
  if (order.supplierId !== input.supplierId) throw new PaymentCliError("O pedido retornado pertence a outro fornecedor.");
  if (order.paymentMethod !== input.paymentMethod || order.paymentCondition !== input.paymentCondition) {
    throw new PaymentCliError("O pedido retornado não preservou a forma de pagamento.");
  }
  if (Number(order.installmentsCount) !== (input.installmentsCount ?? 1)
    || (input.paymentCondition === "installments" && JSON.stringify(order.installmentDueDates) !== JSON.stringify(input.installmentDueDates))) {
    throw new PaymentCliError("O pedido retornado não preservou os vencimentos confirmados.");
  }
  if (order.paymentDueDate !== input.paymentDueDate || order.estimatedReceiptDate !== input.estimatedReceiptDate
    || (input.externalOrderNumber && order.externalOrderNumber !== input.externalOrderNumber)
    || (input.resultCenterId && order.resultCenterId !== input.resultCenterId)
    || (input.freightPaymentMode && order.freightPaymentMode !== input.freightPaymentMode)
    || (input.freightAccountPlanId && order.freightAccountPlanId !== input.freightAccountPlanId)
    || (input.freightSupplierId && order.freightSupplierId !== input.freightSupplierId)
    || (input.freightSupplierName && order.freightSupplierName !== input.freightSupplierName)) {
    throw new PaymentCliError("O pedido retornado não preservou vencimento ou componentes financeiros.");
  }
  if (order.destinationKioskId !== input.destinationKioskId
    || Math.round(Number(order.deliveryFee ?? 0) * 100) !== Math.round(input.deliveryFee * 100)
    ) {
    throw new PaymentCliError("O pedido retornado não preservou unidade ou frete.");
  }
  if (Math.round(Number(order.totalEstimated) * 100) !== input.expectedTotalCents) {
    throw new PaymentCliError("O pedido retornado não preservou o total confirmado.");
  }
}
