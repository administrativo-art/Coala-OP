import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { defineSecret, defineString } from "firebase-functions/params";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

const resendApiKey = defineSecret("RESEND_API_KEY");
const sender = defineString("MATRIX_RESTOCK_EMAIL_FROM", {
  default: "Coala Operações <operacoes@coalashakes.com>",
});
const recipient = defineString("MATRIX_RESTOCK_EMAIL_TO", {
  default: "administrativo@coalashakes.com",
});

type Row = {
  baseName: string;
  baseUnit: string;
  shortage: number;
  supplier?: string;
  productName?: string;
  orderLabel?: string;
  orderQuantity?: number;
  incomingLabel?: string;
  projectedRemaining?: number;
  issue?: string;
};

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

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function quantity(value: number, unit: string) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${unit}`;
}

function localDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function localDateTime(now: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem", dateStyle: "short", timeStyle: "short" }).format(now);
}

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return "<p>Nenhum item.</p>";
  return `<table role="table" style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 18px"><thead><tr>${headers.map(header => `<th style="text-align:left;padding:8px 6px;border-bottom:1px solid #dfe5ec;color:#667085">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td style="padding:9px 6px;border-bottom:1px solid #edf0f4;vertical-align:top">${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function renderEmail(rows: { buy: Row[]; incoming: Row[]; undefined: Row[] }, updatedAt: Date) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows.buy) {
    const key = row.supplier || "Fornecedor não identificado";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const buyHtml = [...grouped.entries()].map(([supplierName, supplierRows]) =>
    `<h3 style="font-size:14px;margin:16px 0 4px">${escapeHtml(supplierName)}</h3>${table(
      ["Insumo derivado", "Falta física", "Pedir agora"],
      supplierRows.map(row => [escapeHtml(row.productName), escapeHtml(quantity(row.shortage, row.baseUnit)), escapeHtml(`${row.orderQuantity} ${row.orderLabel}`)]),
    )}`,
  ).join("");
  const incomingHtml = table(
    ["Insumo", "Falta física", "Compra a caminho", "Projeção após receber"],
    rows.incoming.map(row => [
      escapeHtml(row.baseName), escapeHtml(quantity(row.shortage, row.baseUnit)), escapeHtml(row.incomingLabel),
      row.projectedRemaining && row.projectedRemaining > 0 ? escapeHtml(quantity(row.projectedRemaining, row.baseUnit)) : "Falta coberta",
    ]),
  );
  const undefinedHtml = table(
    ["Insumo base", "Falta física", "Pendência"],
    rows.undefined.map(row => [escapeHtml(row.baseName), escapeHtml(quantity(row.shortage, row.baseUnit)), escapeHtml(row.issue)]),
  );
  const total = rows.buy.length + rows.incoming.length + rows.undefined.length;
  return `<div style="font-family:Arial,sans-serif;color:#172033;max-width:760px;margin:auto">
    <h1 style="font-size:24px">Reposição semanal da Matriz</h1>
    <p style="color:#667085">Posição calculada em ${escapeHtml(localDateTime(updatedAt))}. O estoque disponível já desconta reservas.</p>
    <div style="background:#f5f7fb;padding:14px;border-radius:10px;margin:18px 0"><strong>${total}</strong> abaixo do mínimo · <strong>${rows.buy.length}</strong> comprar agora · <strong>${rows.incoming.length}</strong> com compra a caminho · <strong>${rows.undefined.length}</strong> sem definição</div>
    <div style="background:#eef4ff;border-left:4px solid #4774e7;padding:12px;margin:16px 0">A falta física permanece visível quando existe compra a caminho. A projeção após recebimento não altera o estoque atual.</div>
    <h2 style="font-size:17px;margin-top:26px">Comprar agora</h2>${buyHtml || "<p>Nenhuma compra adicional sugerida.</p>"}
    <h2 style="font-size:17px;margin-top:26px">Compra a caminho — aguardar entrega</h2>${incomingHtml}
    <h2 style="font-size:17px;margin-top:26px">Precisa de definição</h2>${undefinedHtml}
    <p style="font-size:12px;color:#667085;margin-top:24px">Relatório informativo. Nenhum pedido é criado automaticamente. Compras a caminho só entram quando confirmadas e destinadas explicitamente à Matriz.</p>
  </div>`;
}

export async function calculateRows(): Promise<{ buy: Row[]; incoming: Row[]; undefined: Row[] }> {
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
    return items.docs.map(item => ({ receipt: document.data(), item: item.data() }));
  }))).flat();
  const result = { buy: [] as Row[], incoming: [] as Row[], undefined: [] as Row[] };

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
    let incomingBase = 0;
    const incomingDescriptions: string[] = [];
    for (const line of incomingLines.filter(entry => entry.item.baseItemId === document.id)) {
      const product = products.get(String(line.item.productId));
      if (!product) continue;
      try {
        const ordered = Math.max(0, Number(line.item.quantityOrdered ?? 0) - Number(line.item.quantityReceived ?? 0));
        incomingBase += ordered * packageBaseUnits(product, base, String(line.item.purchaseUnitType ?? "content"));
        incomingDescriptions.push(`${ordered} ${line.item.purchaseUnitLabel ?? line.item.unit ?? "un"}`);
      } catch { /* item remains absent from coverage */ }
    }
    if (incomingBase > 0) {
      result.incoming.push({ baseName, baseUnit, shortage, incomingLabel: incomingDescriptions.join(" + "), projectedRemaining: Math.max(0, shortage - incomingBase) });
      continue;
    }
    const candidates = orderLines.filter(line => line.item.baseItemId === document.id && line.item.productId)
      .sort((left, right) => String(right.order.purchaseDate ?? right.order.confirmedAt ?? right.order.createdAt ?? "").localeCompare(String(left.order.purchaseDate ?? left.order.confirmedAt ?? left.order.createdAt ?? "")));
    const latest = candidates[0];
    const product = latest ? products.get(String(latest.item.productId)) : undefined;
    if (!latest || !product || product.isArchived) {
      result.undefined.push({ baseName, baseUnit, shortage, issue: "Escolher fornecedor e embalagem" });
      continue;
    }
    try {
      const perUnit = packageBaseUnits(product, base, String(latest.item.purchaseUnitType ?? "content"));
      const productName = [product.baseName, product.brand && `— ${product.brand}`, product.packageSize && product.unit && `${product.packageSize}${product.unit}`].filter(Boolean).join(" ");
      result.buy.push({ baseName, baseUnit, shortage, supplier: String(latest.order.supplierName ?? latest.order.supplierId ?? "Fornecedor não identificado"), productName, orderQuantity: Math.ceil(shortage / perUnit), orderLabel: String(latest.item.purchaseUnitLabel ?? product.packageType ?? product.unit ?? "un") });
    } catch {
      result.undefined.push({ baseName, baseUnit, shortage, issue: "Última embalagem sem conversão válida" });
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
        from: sender.value(), to: [recipient.value()],
        subject: `Reposição da Matriz — ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Belem" }).format(now)}`,
        html: renderEmail(rows, now),
        tags: [{ name: "source", value: "weekly-matrix-restock" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !payload.id) throw new Error(`Resend respondeu HTTP ${response.status}${payload.message ? `: ${payload.message}` : ""}`);
    await runRef.set({ status: "sent", sentAt: FieldValue.serverTimestamp(), providerId: payload.id, recipient: recipient.value(), itemCounts: { buy: rows.buy.length, incoming: rows.incoming.length, undefined: rows.undefined.length }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info("E-mail semanal da Matriz enviado", { runId, providerId: payload.id });
  } catch (error) {
    await runRef.set({ status: "failed", failedAt: Timestamp.now(), error: error instanceof Error ? error.message.slice(0, 500) : "Falha desconhecida", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
});
