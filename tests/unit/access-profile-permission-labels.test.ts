import assert from "node:assert/strict";
import test from "node:test";

import { readablePermission } from "../../src/components/access-profiles-settings";

test("permissões do perfil são apresentadas em linguagem de negócio", () => {
  assert.equal(readablePermission("dashboard.technicalSheets"), "Fichas técnicas");
  assert.equal(readablePermission("dp.collaborators.ownProfileOnly"), "Colaboradores · Somente o próprio perfil");
  assert.equal(readablePermission("stock.stockCount.requestItem"), "Contagem de estoque · Solicitar item");
  assert.equal(readablePermission("purchasing.receivePurchase"), "Receber compra");
});
