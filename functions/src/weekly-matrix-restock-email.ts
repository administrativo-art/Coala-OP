import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import { localDate, renderEmail, renderSubject, renderText, type RestockRow, type RestockRows } from "./weekly-matrix-restock-email-render.js";

const resendApiKey = defineSecret("RESEND_API_KEY");
const sender = defineString("MATRIX_RESTOCK_EMAIL_FROM", {
  default: "Margaret Hamilton · Coala One <relatorios@coalashakes.com>",
});
/** Lista separada por vírgula. */
const recipient = defineString("MATRIX_RESTOCK_EMAIL_TO", {
  default: "administrativo@coalashakes.com,cesar@cesarthimotheo.com",
});
const recipients = () => recipient.value().split(",").map(address => address.trim()).filter(Boolean);
const repositionUrl = defineString("MATRIX_RESTOCK_REPOSITION_URL", {
  default: "https://op.coalashakes.com/dashboard/stock/reposition",
});

const factors: Record<string, Record<string, number>> = {
  Volume: { l: 1, ml: 0.001, bag: 1 },
  Massa: { kg: 1, g: 0.001, mg: 0.000001 },
  Unidade: { un: 1, pacote: 1, bag: 1, caixa: 1 },
  Embalagem: { un: 1, pacote: 1, bag: 1, caixa: 1 },
  Vestimenta: { peça: 1, un: 1 },
};

function normalizedUnit(value: unknown) {
  const unit = String(value ?? "").trim().toLowerCase();
  return unit === "unidade" ? "un" : unit;
}

export function convertValue(value: number, from: unknown, to: unknown, category: unknown) {
  const source = normalizedUnit(from);
  const target = normalizedUnit(to);
  if (source === target) return value;
  const categoryFactors = factors[String(category ?? "")];
  if (!categoryFactors?.[source] || !categoryFactors?.[target]) throw new Error("Conversão inválida");
  return value * categoryFactors[source] / categoryFactors[target];
}

function packageBaseUnits(product: Record<string, unknown>, base: Record<string, unknown>, purchaseUnitType?: string) {
  const size = Number(product.packageSize);
  let value = size > 0
    ? convertValue(size, product.unit, base.unit, product.category)
    : normalizedUnit(product.unit) === normalizedUnit(base.unit) || ["Unidade", "Embalagem", "Vestimenta"].includes(String(product.category))
      ? 1
      : 0;
  if (purchaseUnitType === "logistic") value *= Number(product.multiplo_caixa ?? 0);
  if (!Number.isFinite(value) || value <= 0) throw new Error("Embalagem sem conversão válida");
  return value;
}

export async function calculateRows(): Promise<RestockRows> {
  const db = getFirestore("coala");
  const [baseSnapshot, productSnapshot, lotSnapshot, orderSnapshot, receiptSnapshot] = await Promise.all([
    db.collection("baseProducts").get(), db.collection("products").get(), db.collection("lots").get(),
    db.collection("purchase_orders").where("status", "==", "confirmed").get(), db.collection("purchase_receipts").get(),
  ]);
  const products = new Map<string, Record<string, unknown>>(productSnapshot.docs.map(document => [document.id, { id: document.id, ...document.data() }]));
  const lots = lotSnapshot.docs.map(document => document.data());
  const orderLines = (await Promise.all(orderSnapshot.docs.map(async document => {
    const items = await document.ref.collection("items").get();
    return items.docs.map(item => ({ order: { id: document.id, ...document.data() } as Record<string, unknown>, item: item.data() }));
  }))).flat();
  const activeReceiptDocs = receiptSnapshot.docs.filter(document => {
    const value = document.data();
    return value.destinationKioskId === "matriz" && !["stocked", "stocked_with_divergence", "cancelled"].includes(value.status);
  });
  const incomingLines = (await Promise.all(activeReceiptDocs.map(async document => {
    const items = await document.ref.collection("items").get();
    return items.docs.map(item => ({ receipt: document.data() as Record<string, unknown>, item: item.data() }));
  }))).flat();
  const result: RestockRows = { buy: [], incoming: [], undefined: [] };

  for (const document of baseSnapshot.docs) {
    const base = { id: document.id, ...document.data() } as Record<string, unknown>;
    if (base.isArchived) continue;
    const minimum = Number((base.stockLevels as Record<string, Record<string, unknown>> | undefined)?.matriz?.min);
    if (!Number.isFinite(minimum)) continue;
    let stock = 0;
    let invalidStock = false;
    for (const lot of lots.filter(entry => entry.kioskId === "matriz")) {
      const product = products.get(String(lot.productId));
      if (!product || product.baseProductId !== document.id || product.isArchived) continue;
      try {
        const available = Number(lot.quantity ?? 0) - Number(lot.reservedQuantity ?? 0);
        if (available > 0) stock += available * packageBaseUnits(product, base);
      } catch { invalidStock = true; }
    }
    const shortage = Math.max(0, minimum - stock);
    if (!(shortage > 0) || invalidStock) continue;
    const baseName = String(base.name ?? base.baseName ?? document.id);
    const baseUnit = String(base.unit ?? "un");
    const current = { baseName, baseUnit, stock, minimum, shortage } satisfies Partial<RestockRow>;
    let incomingBase = 0;
    const incomingDescriptions: string[] = [];
    const incomingSuppliers = new Set<string>();
    const expectedDates: string[] = [];
    for (const line of incomingLines.filter(entry => entry.item.baseItemId === document.id)) {
      const product = products.get(String(line.item.productId));
      if (!product) continue;
      try {
        const ordered = Math.max(0, Number(line.item.quantityOrdered ?? 0) - Number(line.item.quantityReceived ?? 0));
        incomingBase += ordered * packageBaseUnits(product, base, String(line.item.purchaseUnitType ?? "content"));
        incomingDescriptions.push(`${ordered} ${line.item.purchaseUnitLabel ?? line.item.unit ?? "un"}`);
        if (line.receipt.supplierName) incomingSuppliers.add(String(line.receipt.supplierName));
        if (typeof line.receipt.expectedDate === "string" && line.receipt.expectedDate) expectedDates.push(line.receipt.expectedDate);
      } catch { /* item remains absent from coverage */ }
    }
    if (incomingBase > 0) {
      result.incoming.push({
        ...current,
        incomingLabel: incomingDescriptions.join(" + "),
        incomingSupplier: [...incomingSuppliers].join(", ") || undefined,
        expectedDate: expectedDates.sort()[0],
        projectedRemaining: Math.max(0, shortage - incomingBase),
      });
      continue;
    }
    const candidates = orderLines.filter(line => line.item.baseItemId === document.id && line.item.productId)
      .sort((left, right) => String(right.order.purchaseDate ?? right.order.confirmedAt ?? right.order.createdAt ?? "").localeCompare(String(left.order.purchaseDate ?? left.order.confirmedAt ?? left.order.createdAt ?? "")));
    const latest = candidates[0];
    const product = latest ? products.get(String(latest.item.productId)) : undefined;
    if (!latest || !product || product.isArchived) {
      result.undefined.push({ ...current, issue: "Escolher fornecedor", issueDetail: latest ? "produto da última compra arquivado" : "sem compra anterior registrada" });
      continue;
    }
    try {
      const perUnit = packageBaseUnits(product, base, String(latest.item.purchaseUnitType ?? "content"));
      const productDetail = [product.brand, product.packageSize && product.unit && `${product.packageSize} ${product.unit}`].filter(Boolean).join(" · ");
      result.buy.push({ ...current, supplier: String(latest.order.supplierName ?? latest.order.supplierId ?? "Fornecedor não identificado"), productDetail: productDetail || undefined, orderQuantity: Math.ceil(shortage / perUnit), orderLabel: String(latest.item.purchaseUnitLabel ?? product.packageType ?? product.unit ?? "un") });
    } catch {
      result.undefined.push({ ...current, issue: "Revisar embalagem", issueDetail: "a última embalagem comprada não converte para a unidade do insumo" });
    }
  }
  return result;
}

async function claimRun(runId: string) {
  const db = getFirestore("coala");
  const reference = db.collection("scheduledEmailRuns").doc(runId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.data()?.status === "sent") return false;
    transaction.set(reference, { status: "sending", startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

export const weeklyMatrixRestockEmail = onSchedule({
  schedule: "0 8 * * 1", timeZone: "America/Belem", retryCount: 2,
  timeoutSeconds: 300, memory: "512MiB", maxInstances: 1, secrets: [resendApiKey],
}, async () => {
  const now = new Date();
  const runId = `matrix-restock-${localDate(now)}`;
  if (!(await claimRun(runId))) {
    logger.info("E-mail semanal da Matriz já enviado", { runId });
    return;
  }
  const runRef = getFirestore("coala").collection("scheduledEmailRuns").doc(runId);
  try {
    const rows = await calculateRows();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey.value()}`, "Content-Type": "application/json", "User-Agent": "Coala-One/1.0" },
      body: JSON.stringify({
        from: sender.value(), to: recipients(),
        subject: renderSubject(rows, now),
        html: renderEmail(rows, now, repositionUrl.value()),
        text: renderText(rows, now, repositionUrl.value()),
        tags: [{ name: "source", value: "weekly-matrix-restock" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(`Resend respondeu HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`);
    await runRef.set({ status: "sent", sentAt: FieldValue.serverTimestamp(), providerId: payload.id, recipients: recipients(), itemCounts: { buy: rows.buy.length, incoming: rows.incoming.length, undefined: rows.undefined.length }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info("E-mail semanal da Matriz enviado", { runId, providerId: payload.id });
  } catch (error) {
    await runRef.set({ status: "failed", failedAt: Timestamp.now(), error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
});
