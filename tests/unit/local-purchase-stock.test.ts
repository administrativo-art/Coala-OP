import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mobilePurchaseExtractionPrompt } from "../../src/ai/prompts/financial/mobile-purchase-extraction";
import { confirmLocalPurchaseSchema } from "../../src/features/purchasing/local-purchase";
import {
  buildLocalPurchaseStockLine,
  isLocalPurchaseStockProduct,
  localPurchaseItemLinkId,
  localPurchaseLotCode,
  localPurchaseLotId,
} from "../../src/features/purchasing/local-purchase-stock";
import type { Product } from "../../src/types";

const milk = { baseName: "Leite integral", brand: "Marca", packageSize: 1, unit: "L", category: "Volume", baseProductId: "base-milk" } as unknown as Product;

test("the product registration decides what the app may receive into stock", () => {
  assert.equal(isLocalPurchaseStockProduct(milk), true);
  assert.equal(isLocalPurchaseStockProduct({ ...milk, operationalDestination: "stock" }), true);
  assert.equal(isLocalPurchaseStockProduct({ ...milk, operationalDestination: "uniform" }), false);
  assert.equal(isLocalPurchaseStockProduct({ ...milk, operationalDestination: "asset" }), false);
  assert.equal(isLocalPurchaseStockProduct({ ...milk, isArchived: true }), false);
  assert.equal(isLocalPurchaseStockProduct({ ...milk, baseProductId: undefined }), false);
  assert.equal(isLocalPurchaseStockProduct(undefined), false);
});

test("a stock line converts packages to base units and prices the base unit", () => {
  const built = buildLocalPurchaseStockLine({
    itemIndex: 0, productId: "milk-1l", product: milk, baseProduct: { unit: "ml" },
    quantity: 2, totalCents: 1200, expiryDate: "2026-11-01", purchaseDate: "2026-10-09",
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.line.unitPrice, 6);
  assert.equal(built.line.baseQuantity, 2000);
  assert.equal(built.line.pricePerBaseUnit, 0.006);
  assert.equal(built.line.baseItemId, "base-milk");
  assert.equal(built.line.lotCode, "CL-20261009");
  assert.equal(localPurchaseLotCode("2026-10-09"), "CL-20261009");
  assert.equal(localPurchaseLotId({ productId: "milk-1l", unitId: "unit-a", lotCode: built.line.lotCode, expiryDate: built.line.expiryDate }), "milk-1l_unit-a_CL-20261009_2026-11-01");
  assert.equal(localPurchaseLotId({ productId: "milk-1l", unitId: "unit-a", lotCode: "CL-20261009", expiryDate: null }), "milk-1l_unit-a_CL-20261009_noval");
});

test("a stock line is refused for an expired date, a non-stock product or a broken conversion", () => {
  const base = { itemIndex: 0, productId: "milk-1l", product: milk, baseProduct: { unit: "ml" }, quantity: 2, totalCents: 1200, expiryDate: null, purchaseDate: "2026-10-09" };
  assert.equal(buildLocalPurchaseStockLine({ ...base, expiryDate: "2026-10-01" }).ok, false);
  assert.equal(buildLocalPurchaseStockLine({ ...base, product: { ...milk, operationalDestination: "asset" } as Product }).ok, false);
  assert.equal(buildLocalPurchaseStockLine({ ...base, baseProduct: { unit: "kg" } }).ok, false);
});

test("the remembered item link is scoped to workspace and supplier and ignores accents and punctuation", () => {
  const first = localPurchaseItemLinkId({ workspaceId: "coala", supplierTaxId: "12.345.678/0001-99", description: "LEITE INTEG. 1L" });
  assert.equal(first, localPurchaseItemLinkId({ workspaceId: "coala", supplierTaxId: "12345678000199", description: "leite integ 1l" }));
  assert.notEqual(first, localPurchaseItemLinkId({ workspaceId: "coala", supplierTaxId: "99999999000199", description: "LEITE INTEG. 1L" }));
  assert.notEqual(first, localPurchaseItemLinkId({ workspaceId: "other", supplierTaxId: "12345678000199", description: "LEITE INTEG. 1L" }));
  assert.equal(localPurchaseItemLinkId({ workspaceId: "coala", supplierName: "Mercado São José", description: "Açúcar" }), localPurchaseItemLinkId({ workspaceId: "coala", supplierName: "mercado sao jose", description: "acucar" }));
  assert.equal(localPurchaseItemLinkId({ workspaceId: "coala", description: "Leite" }), null);
});

test("confirmation accepts a strict stock block per item", () => {
  const valid = {
    submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e", unitId: "unit-a", supplierName: "Mercado Central", supplierTaxId: null,
    purchaseDate: "2026-10-09", totalCents: 1200, fundingSource: "cash_withdrawal" as const, companyPaymentMethod: null,
    accountPlanId: "account-a", resultCenterId: "center-a",
    items: [{ description: "Leite", quantity: 2, unit: "un", unitPriceCents: 600, totalCents: 1200, stock: { productId: "milk-1l", quantity: 2, expiryDate: "2026-11-01" } }],
  };
  const withStock = (stock: unknown) => ({ ...valid, items: [{ ...valid.items[0], stock }] });
  assert.equal(confirmLocalPurchaseSchema.safeParse(valid).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse(withStock(null)).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse(withStock({ productId: "milk-1l", quantity: 2, expiryDate: null })).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse(withStock({ productId: "milk-1l", quantity: 0, expiryDate: null })).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse(withStock({ productId: "milk-1l", quantity: 2, expiryDate: "01/11/2026" })).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse(withStock({ productId: "milk-1l", quantity: 2, expiryDate: null, kioskId: "other-unit" })).success, false);
});

test("stock entry is idempotent, bound to the purchase unit, and the AI only suggests catalog products", () => {
  const entry = readFileSync("src/features/purchasing/local-purchase-stock.server.ts", "utf8");
  assert.match(entry, /if \(\(await transaction\.get\(entryRef\)\)\.exists\) return;/);
  assert.match(entry, /transaction\.create\(entryRef/);
  assert.match(entry, /kioskId: input\.unitId/);
  assert.match(entry, /doc\(`\$\{input\.purchaseId\}_\$\{line\.itemIndex\}`\)/);
  const confirm = readFileSync("src/features/purchasing/local-purchase.server.ts", "utf8");
  assert.match(confirm, /stockEntryStatus: stockLines\.length \? "pending" : "not_needed"/);
  const extraction = readFileSync("src/features/financial/inbox/mobile-purchase-extraction.server.ts", "utf8");
  assert.match(extraction, /productIds\.has\(item\.productId\) \? item\.productId : null/);
  const rendered = mobilePurchaseExtractionPrompt.render({ fundingSource: "cash_withdrawal", products: [{ id: "milk-1l", name: "Leite integral · 1 L", packageLabel: "caixa" }] });
  assert.match(rendered, /milk-1l — Leite integral · 1 L \(caixa\)/);
  assert.match(mobilePurchaseExtractionPrompt.render({ fundingSource: "cash_withdrawal" }), /nenhum produto disponível/);
});
