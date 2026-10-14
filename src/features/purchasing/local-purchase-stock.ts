import { createHash } from "node:crypto";

import { calculatePricePerBaseUnit, getContentPurchaseUnitLabel } from "@/lib/purchasing-units";
import type { BaseProduct, Product } from "@/types";

/** Stock product the app may receive: the registration, not the operator, decides what enters stock. */
export type LocalPurchaseProduct = { id: string; name: string; packageLabel: string };

export type LocalPurchaseStockLine = {
  itemIndex: number;
  productId: string;
  productName: string;
  baseItemId: string;
  /** Packages of the stock product, the unit lots are counted in. */
  quantity: number;
  expiryDate: string | null;
  lotCode: string;
  unitPrice: number;
  pricePerBaseUnit: number;
  baseQuantity: number;
};

export function localPurchaseProductName(product: Pick<Product, "baseName" | "brand" | "packageSize" | "unit">) {
  return [product.baseName, product.brand, product.packageSize ? `${product.packageSize} ${product.unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" · ");
}

/** Only products registered for stock are received here; uniforms and assets keep their own flows in the web system. */
export function isLocalPurchaseStockProduct(product: Partial<Product> | undefined) {
  return !!product && product.isArchived !== true && (product.operationalDestination ?? "stock") === "stock"
    && !!product.baseProductId && Number(product.packageSize) > 0;
}

export function toLocalPurchaseProduct(id: string, product: Product): LocalPurchaseProduct {
  return { id, name: localPurchaseProductName(product), packageLabel: getContentPurchaseUnitLabel(product) };
}

/** One lot per purchase day; the expiry date completes the lot identity, as in a regular receipt. */
export function localPurchaseLotCode(purchaseDate: string) {
  return `CL-${purchaseDate.replace(/-/g, "")}`;
}

export function localPurchaseLotId(input: { productId: string; unitId: string; lotCode: string; expiryDate: string | null }) {
  return `${input.productId}_${input.unitId}_${input.lotCode}_${input.expiryDate ?? "noval"}`;
}

export function buildLocalPurchaseStockLine(input: {
  itemIndex: number;
  productId: string;
  product: Product;
  baseProduct: Pick<BaseProduct, "unit">;
  quantity: number;
  totalCents: number;
  expiryDate: string | null;
  purchaseDate: string;
}): { ok: true; line: LocalPurchaseStockLine } | { ok: false; error: string } {
  if (!isLocalPurchaseStockProduct(input.product)) return { ok: false, error: "O produto escolhido não recebe entrada de estoque pelo aplicativo." };
  if (input.expiryDate && input.expiryDate < input.purchaseDate) return { ok: false, error: "A validade informada é anterior à data da compra." };
  const unitPrice = input.totalCents / 100 / input.quantity;
  const converted = calculatePricePerBaseUnit(unitPrice, input.product, input.baseProduct, "content");
  if (!converted.ok) return converted;
  return { ok: true, line: {
    itemIndex: input.itemIndex,
    productId: input.productId,
    productName: localPurchaseProductName(input.product),
    baseItemId: input.product.baseProductId!,
    quantity: input.quantity,
    expiryDate: input.expiryDate,
    lotCode: localPurchaseLotCode(input.purchaseDate),
    unitPrice,
    pricePerBaseUnit: converted.pricePerBaseUnit,
    baseQuantity: input.quantity * converted.baseUnitsPerPurchaseUnit,
  } };
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Key of the remembered link "this supplier writes this description for that product". */
export function localPurchaseItemLinkId(input: { workspaceId: string; supplierTaxId?: string | null; supplierName?: string | null; description: string }) {
  const supplier = input.supplierTaxId?.replace(/\D/g, "") || normalizeText(input.supplierName ?? "");
  const description = normalizeText(input.description);
  if (!supplier || !description) return null;
  return createHash("sha256").update(`${input.workspaceId}|${supplier}|${description}`).digest("hex");
}
