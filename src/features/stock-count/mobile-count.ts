import { z } from "zod";

import type { MovementType, Product, StockAuditItem } from "@/types";

/** Reasons the app offers for a shortage; the first is the default, as in the web count. */
export const MOBILE_COUNT_EXIT_REASONS = [
  { value: "SAIDA_CONSUMO", label: "Venda/Consumo" },
  { value: "Divergência na contagem do turno - decréscimo", label: "Divergência na contagem" },
  { value: "SAIDA_DESCARTE_VENCIMENTO", label: "Descarte por vencimento" },
  { value: "SAIDA_DESCARTE_AVARIA", label: "Avaria/Quebra" },
  { value: "SAIDA_DESCARTE_PERDA", label: "Extravio" },
  { value: "SAIDA_DESCARTE_OUTROS", label: "Outros" },
] as const satisfies ReadonlyArray<{ value: MovementType; label: string }>;

export type MobileCountExitReason = (typeof MOBILE_COUNT_EXIT_REASONS)[number]["value"];
const exitReasonValues = MOBILE_COUNT_EXIT_REASONS.map((reason) => reason.value) as [MobileCountExitReason, ...MobileCountExitReason[]];

const quantity = z.number().finite().min(0).max(1_000_000);
const notes = z.string().trim().max(240);
const documentId = z.string().trim().min(1).max(300).regex(/^[^/]+$/);

/** One exit with a single reason and one entry per lot: what the operator found different from the system. */
export const mobileCountEntrySchema = z.object({
  lotId: documentId,
  exitQuantity: quantity,
  exitReason: z.enum(exitReasonValues),
  exitNotes: notes,
  entryQuantity: quantity,
  entryNotes: notes,
}).strict().superRefine((entry, context) => {
  if (entry.exitQuantity > 0 && entry.exitReason === "SAIDA_DESCARTE_OUTROS" && entry.exitNotes.length < 3) {
    context.addIssue({ code: "custom", path: ["exitNotes"], message: "Descreva o motivo da saída marcada como Outros." });
  }
});

export const startMobileCountSchema = z.object({ kioskId: documentId }).strict();

export const saveMobileCountSchema = z.object({
  sessionId: documentId,
  entries: z.array(mobileCountEntrySchema).max(2000),
  /** false keeps the session open as a draft; true applies the adjustments to stock. */
  complete: z.boolean(),
}).strict();

export type MobileCountEntry = z.infer<typeof mobileCountEntrySchema>;

export function mobileCountProductName(product: Pick<Product, "baseName" | "brand" | "packageSize" | "unit">) {
  const brand = product.brand ? ` - ${product.brand}` : "";
  const size = product.packageSize && product.unit ? ` (${product.packageSize}${product.unit})` : "";
  return `${product.baseName}${brand}${size}`;
}

/** Same exclusions as the web count: archived products and uniforms are not part of a stock count. */
export function isMobileCountProduct(product: Partial<Product> | undefined) {
  return !!product && product.isArchived !== true && product.operationalDestination !== "uniform" && product.category !== "Vestimenta";
}

export function mobileCountDisplayUnit(product: Pick<Product, "defaultCountingUnit" | "packageType" | "unit">, baseUnit: string | undefined) {
  const option = product.defaultCountingUnit || "package";
  if (option === "package") return product.packageType || product.unit || "un";
  if (option === "base") return baseUnit || "un";
  return product.unit || "un";
}

/**
 * Applies what the operator typed to the items the session was started with. Lots the app did not
 * send keep the system quantity; lots the session never had are rejected, so the app cannot add stock.
 */
export function applyMobileCountEntries(sessionItems: StockAuditItem[], entries: MobileCountEntry[]) {
  const byLot = new Map<string, MobileCountEntry>();
  for (const entry of entries) {
    if (byLot.has(entry.lotId)) return { ok: false as const, error: "Lote repetido na contagem." };
    byLot.set(entry.lotId, entry);
  }
  const known = new Set(sessionItems.map((item) => item.lotId));
  if (entries.some((entry) => !known.has(entry.lotId))) return { ok: false as const, error: "A contagem contém um lote que não pertence a esta sessão." };

  const items: StockAuditItem[] = [];
  for (const item of sessionItems) {
    const entry = byLot.get(item.lotId);
    const exit = entry?.exitQuantity ?? 0;
    const added = entry?.entryQuantity ?? 0;
    const finalQuantity = Math.round((Number(item.systemQuantity) - exit + added) * 1_000_000) / 1_000_000;
    if (finalQuantity < 0) return { ok: false as const, error: `A saída de ${item.productName} é maior que a quantidade em estoque.` };
    items.push({
      ...item,
      finalQuantity,
      divergences: entry && exit > 0 ? [{ id: "mobile-exit", reason: entry.exitReason, quantity: exit, notes: entry.exitNotes }] : [],
      adjustments: entry && added > 0 ? [{ id: "mobile-entry", reason: "ENTRADA_CORRECAO", quantity: added, notes: entry.entryNotes }] : [],
    });
  }
  return { ok: true as const, items };
}

/** What the app shows for each lot; the stored divergences collapse back to one exit and one entry. */
export function toMobileCountItem(item: StockAuditItem) {
  const exit = item.divergences?.[0];
  const entry = item.adjustments?.[0];
  return {
    lotId: item.lotId,
    productName: item.productName,
    lotNumber: item.lotNumber,
    expiryDate: item.expiryDate || null,
    systemQuantity: Number(item.systemQuantity ?? 0),
    displayUnit: item.displayUnit || "un",
    exitQuantity: (item.divergences ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
    exitReason: (exitReasonValues.includes(exit?.reason as MobileCountExitReason) ? exit!.reason : "SAIDA_CONSUMO") as MobileCountExitReason,
    exitNotes: exit?.notes ?? "",
    entryQuantity: (item.adjustments ?? []).reduce((sum, row) => sum + Number(row.quantity ?? 0), 0),
    entryNotes: entry?.notes ?? "",
  };
}
