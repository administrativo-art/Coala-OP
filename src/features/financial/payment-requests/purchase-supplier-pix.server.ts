import { createHash } from "node:crypto";
import { dbAdmin } from "@/lib/firebase-admin";
import { normalizeBrazilianDocument, validBrazilianTaxId } from "../beneficiaries/normalization";
import { supplierPixConflict } from "./supplier-pix-confirmation.server";

export type PurchasePixIndication = {
  purchaseOrderId: string;
  supplierEntityId: string;
  supplierTaxId: string;
  beneficiaryEntityId: string;
  unitId: string;
  amountCents: number;
  invoiceAccessKey: string;
  orderFingerprint: string;
  reason: string;
  evidence: string;
  confirmedBy: string;
  confirmedAt: string;
};

export type PurchasePixIndicationInput = {
  confirmed: true;
  reason: string;
  evidence: string;
  invoiceAccessKey: string;
};

export type PurchasePixSourceSnapshot = {
  purchaseOrderId: string;
  supplierEntityId: string;
  supplierTaxId: string;
  unitId: string;
  amountCents: number;
  orderFingerprint: string;
};

function cents(value: unknown) { return Math.round(Number(value) * 100); }

function purchaseGoodsCents(order: FirebaseFirestore.DocumentData) {
  return cents(order.totalEstimated)
    - (order.freightPaymentMode === "separate" ? cents(order.deliveryFee ?? 0) : 0)
    - (order.serviceFeePaymentMode === "separate" ? cents(order.serviceFee ?? 0) : 0);
}

function hasPurchaseInvoice(order: FirebaseFirestore.DocumentData) {
  return Boolean(order.invoiceAccessKey || order.invoiceNumber || order.fiscal?.issuerCnpj
    || order.fiscal?.supplierDocument || order.fiscal?.totalCents != null);
}

export function purchasePixOrderFingerprint(order: FirebaseFirestore.DocumentData, supplierTaxId: string) {
  return createHash("sha256").update(JSON.stringify({
    status: order.status, supplierId: order.supplierId,
    destinationKioskId: order.destinationKioskId,
    supplierTaxId, issuerCnpj: normalizeBrazilianDocument(order.fiscal?.issuerCnpj ?? order.fiscal?.supplierDocument),
    invoiceAccessKey: order.invoiceAccessKey ?? "",
    invoiceNumber: order.invoiceNumber ?? order.fiscal?.number ?? "",
    invoiceSeries: order.fiscal?.series ?? "",
    invoiceProtocol: order.fiscal?.protocol ?? order.fiscal?.authorizationProtocol ?? "",
    invoiceTotalCents: Number(order.fiscal?.totalCents),
    documentUrl: typeof order.documentUrl === "string" ? order.documentUrl : null,
    danfeDocuments: Array.isArray(order.fiscalDocuments) ? order.fiscalDocuments
      .filter((entry: FirebaseFirestore.DocumentData | null) => entry?.role === "danfe")
      .map((entry: FirebaseFirestore.DocumentData) => ({
        path: entry.path ?? null, sha256: entry.sha256 ?? null, url: entry.url ?? null,
      }))
      .sort((a: object, b: object) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : [],
    totalEstimatedCents: cents(order.totalEstimated),
    deliveryFeeCents: cents(order.deliveryFee ?? 0),
    serviceFeeCents: cents(order.serviceFee ?? 0),
    freightPaymentMode: order.freightPaymentMode ?? "",
    serviceFeePaymentMode: order.serviceFeePaymentMode ?? "",
    linkedExpenseId: order.linkedExpenseId ?? "",
  })).digest("hex");
}

export async function loadPurchasePixSource(orderId: string) {
  const orderSnap = await dbAdmin.collection("purchase_orders").doc(orderId).get();
  const order = orderSnap.data();
  if (!order || order.status !== "confirmed" || !order.supplierId || !order.destinationKioskId) {
    supplierPixConflict("A compra precisa estar confirmada e vinculada a fornecedor e unidade.");
  }
  const entity = await dbAdmin.collection("entities").doc(order.supplierId).get();
  const supplierTaxId = normalizeBrazilianDocument(entity.get("document"));
  if (!entity.exists || entity.get("status") === "inactive" || !validBrazilianTaxId(supplierTaxId)
    || ((order.fiscal?.issuerCnpj || order.fiscal?.supplierDocument)
      && normalizeBrazilianDocument(order.fiscal.issuerCnpj ?? order.fiscal.supplierDocument) !== supplierTaxId)
    || (order.invoiceAccessKey && (!/^\d{44}$/.test(order.invoiceAccessKey)
      || order.invoiceAccessKey.slice(6, 20) !== supplierTaxId))) {
    supplierPixConflict("O fornecedor cadastrado diverge do emitente fiscal da compra.");
  }
  if (hasPurchaseInvoice(order) && Number(order.fiscal?.totalCents) !== purchaseGoodsCents(order)) {
    supplierPixConflict("O valor da nota fiscal diverge da mercadoria da compra.");
  }
  return { order, supplierTaxId, fingerprint: purchasePixOrderFingerprint(order, supplierTaxId) };
}

export function purchasePixSourceSnapshot(orderId: string, source: Awaited<ReturnType<typeof loadPurchasePixSource>>,
  amountCents: number): PurchasePixSourceSnapshot {
  return { purchaseOrderId: orderId, supplierEntityId: source.order.supplierId,
    supplierTaxId: source.supplierTaxId, unitId: source.order.destinationKioskId,
    amountCents, orderFingerprint: source.fingerprint };
}

export function assertPurchasePixSource(expenseId: string, expense: FirebaseFirestore.DocumentData | undefined,
  snapshot: PurchasePixSourceSnapshot, source: Awaited<ReturnType<typeof loadPurchasePixSource>>) {
  const { order } = source;
  const expectedCents = purchaseGoodsCents(order);
  if (!expense || expense.originModule !== "purchasing" || expense.purchaseOrderId !== snapshot.purchaseOrderId
    || !["goods", "combined"].includes(expense.purchaseExpenseRole)
    || order.linkedExpenseId !== expenseId
    || order.supplierId !== snapshot.supplierEntityId || source.supplierTaxId !== snapshot.supplierTaxId
    || order.destinationKioskId !== snapshot.unitId || expense.unitId !== snapshot.unitId
    || expense.supplierId !== snapshot.supplierEntityId
    || normalizeBrazilianDocument(expense.billingIdentity?.supplierTaxId) !== snapshot.supplierTaxId
    || cents(expense.totalValue) !== snapshot.amountCents || expectedCents !== snapshot.amountCents
    || (hasPurchaseInvoice(order) && Number(order.fiscal?.totalCents) !== expectedCents)
    || source.fingerprint !== snapshot.orderFingerprint) {
    supplierPixConflict("O pedido, fornecedor fiscal, despesa, valor ou unidade mudou após o preparo.");
  }
}

export function assertPurchasePixIndication(
  expenseId: string,
  expense: FirebaseFirestore.DocumentData | undefined,
  indication: PurchasePixIndication,
  source: Awaited<ReturnType<typeof loadPurchasePixSource>>,
) {
  const { order, supplierTaxId, fingerprint } = source;
  assertPurchasePixSource(expenseId, expense, indication, source);
  if (!expense || expense.originModule !== "purchasing" || expense.purchaseOrderId !== indication.purchaseOrderId
    || expense.purchaseExpenseRole !== "goods"
    || order.linkedExpenseId !== expenseId
    || order.supplierId !== indication.supplierEntityId || supplierTaxId !== indication.supplierTaxId
    || order.destinationKioskId !== indication.unitId || expense.unitId !== indication.unitId
    || expense.supplierId !== indication.supplierEntityId
    || normalizeBrazilianDocument(expense.billingIdentity?.supplierTaxId) !== supplierTaxId
    || cents(expense.totalValue) !== indication.amountCents
    || cents(order.totalEstimated) - (order.freightPaymentMode === "separate" ? cents(order.deliveryFee ?? 0) : 0)
      - (order.serviceFeePaymentMode === "separate" ? cents(order.serviceFee ?? 0) : 0) !== indication.amountCents
    || order.invoiceAccessKey !== indication.invoiceAccessKey
    || Number(order.fiscal?.totalCents) !== indication.amountCents
    || indication.orderFingerprint !== fingerprint
    || expense.purchasePixIndication?.orderFingerprint !== indication.orderFingerprint
    || expense.purchasePixIndication?.beneficiaryEntityId !== indication.beneficiaryEntityId
    || expense.purchasePixIndication?.confirmedAt !== indication.confirmedAt) {
    supplierPixConflict("A compra, nota, despesa, unidade ou indicação do favorecido mudou. Prepare novamente.");
  }
}
