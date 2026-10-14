import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cancelRepositionRequestSchema,
  createRepositionRequestSchema,
} from "../../src/features/reposition-requests/lib/security";

const validItem = {
  baseProductId: "base-1",
  productName: "Leite",
  unit: "ml",
  currentStock: 100,
  minimumStock: 500,
  requestedQuantity: 400,
};

test("criação aceita somente unidade e itens operacionais allowlisted", () => {
  assert.equal(createRepositionRequestSchema.safeParse({ kioskId: "unit-a", items: [validItem] }).success, true);
  for (const protectedField of ["status", "kioskName", "requestedBy", "createdAt", "updatedAt", "activityId"]) {
    assert.equal(createRepositionRequestSchema.safeParse({ kioskId: "unit-a", items: [validItem], [protectedField]: "forged" }).success, false);
  }
});

test("PATCH público permite apenas cancelar e rejeita mass assignment", () => {
  assert.deepEqual(cancelRepositionRequestSchema.parse({ status: "Cancelada" }), { status: "Cancelada" });
  assert.equal(cancelRepositionRequestSchema.safeParse({ status: "Atendida" }).success, false);
  assert.equal(cancelRepositionRequestSchema.safeParse({ status: "Cancelada", kioskId: "unit-b" }).success, false);
});

test("rotas vinculam consulta, mutação e upload ao escopo do recurso", async () => {
  const root = new URL("../../", import.meta.url);
  const [collectionRoute, itemRoute, uploadRoute] = await Promise.all([
    readFile(new URL("src/app/api/stock/reposition-requests/route.ts", root), "utf8"),
    readFile(new URL("src/app/api/stock/reposition-requests/[requestId]/route.ts", root), "utf8"),
    readFile(new URL("src/app/api/uploads/operations/route.ts", root), "utf8"),
  ]);
  assert.match(collectionRoute, /where\("kioskId", "in", unitIds\)/);
  assert.match(collectionRoute, /canAccessUnit\(actor\.userDoc, resource\.id/);
  assert.match(itemRoute, /current\.status !== "Pendente"/);
  assert.match(itemRoute, /runTransaction/);
  assert.match(uploadRoute, /workspaceId !== WORKSPACE_ID/);
  assert.match(uploadRoute, /canAccessUnit\(context\.userDoc, destinationKioskId/);
});
