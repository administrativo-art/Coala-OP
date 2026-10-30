import assert from "node:assert/strict";
import test from "node:test";

import {
  assetPerformedBySchema,
  changedPurchaseLinkedFields,
  normalizedAssetLifecycle,
  ownershipRegimeFromLegacy,
} from "../../../src/features/assets/lifecycle";

test("ativo legado sem responsável nasce projetado sob posse da empresa", () => {
  const lifecycle = normalizedAssetLifecycle({
    id: "asset-1",
    currentKioskId: "matriz",
    currentKioskName: "Matriz",
    possessionStatus: "Próprio",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(lifecycle.owner.type, "company");
  assert.equal(lifecycle.ownershipRegime, "owned");
  assert.equal(lifecycle.custody.holderType, "company");
  assert.equal(lifecycle.currentLocation.refId, "matriz");
  assert.equal(lifecycle.lifecycleImportedFromLegacy, true);
});

test("responsável legado vira posse importada sem inventar data de transferência", () => {
  const lifecycle = normalizedAssetLifecycle({
    id: "asset-2",
    currentKioskId: "matriz",
    responsibleUserId: "user-1",
    responsibleName: "Pessoa",
    createdAt: "2025-05-10T00:00:00.000Z",
  });
  assert.equal(lifecycle.custody.holderType, "employee");
  assert.equal(lifecycle.custody.holderId, "user-1");
  assert.equal(lifecycle.custody.legacyImported, true);
  assert.equal(lifecycle.custody.since, "2025-05-10T00:00:00.000Z");
});

test("ativo legado sem unidade não inventa uma unidade fictícia", () => {
  const lifecycle = normalizedAssetLifecycle({ id: "asset-3", exactLocation: "Depósito externo" });
  assert.equal(lifecycle.currentLocation.type, "external");
  assert.equal(lifecycle.currentLocation.refId, undefined);
  assert.equal(lifecycle.currentLocation.nameSnapshot, "Depósito externo");
});

test("regime legado é normalizado sem confundir propriedade e posse", () => {
  assert.equal(ownershipRegimeFromLegacy("Alugado"), "leased");
  assert.equal(ownershipRegimeFromLegacy("Comodato"), "loaned");
  assert.equal(ownershipRegimeFromLegacy("Consignado"), "third_party");
  assert.equal(ownershipRegimeFromLegacy(undefined), "unknown");
});

test("proteção de aquisição detecta apenas campos efetivamente alterados", () => {
  const current = { purchaseValue: 100, supplierName: "Fornecedor", invoiceNumber: "1" };
  assert.deepEqual(changedPurchaseLinkedFields(current, { purchaseValue: 100 }), []);
  assert.deepEqual(changedPurchaseLinkedFields(current, { purchaseValue: 101, name: "Outro" }), ["purchaseValue"]);
});

test("executor cadastrado exige identificador e terceiro admite nome livre", () => {
  assert.equal(assetPerformedBySchema.safeParse({ type: "employee", nameSnapshot: "Pessoa" }).success, false);
  assert.equal(assetPerformedBySchema.safeParse({ type: "employee", id: "employee-1", nameSnapshot: "Pessoa" }).success, true);
  assert.equal(assetPerformedBySchema.safeParse({ type: "third_party", nameSnapshot: "Transportadora" }).success, true);
});
