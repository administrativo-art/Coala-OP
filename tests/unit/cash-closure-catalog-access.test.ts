import assert from "node:assert/strict";
import test from "node:test";

import { canBrowseCashClosureCatalog } from "../../src/features/financial/cash-closures/catalog-access";
import { defaultGuestPermissions } from "../../src/types";

function context() {
  const permissions = structuredClone(defaultGuestPermissions);
  permissions.financial.view = true;
  return {
    isDefaultAdmin: false,
    permissions,
    userDoc: {
      unitAccessScope: "selected" as const,
      unitAccessUnitIds: ["quiosque-a"],
    },
  };
}

test("catálogo de unidades e competências exige o acesso-base ao Financeiro", () => {
  const denied = context();
  denied.permissions.financial.view = false;

  assert.equal(canBrowseCashClosureCatalog(denied), false);
  assert.equal(canBrowseCashClosureCatalog(context()), true);
});

test("catálogo respeita o escopo de unidades sem exigir acesso ao calendário", () => {
  const allowed = context();
  allowed.permissions.financial.cashClosures.view = false;

  assert.equal(canBrowseCashClosureCatalog(allowed, "quiosque-a"), true);
  assert.equal(canBrowseCashClosureCatalog(allowed, "quiosque-b"), false);
});

test("administrador padrão preserva acesso global ao catálogo", () => {
  const admin = context();
  admin.isDefaultAdmin = true;
  admin.permissions.financial.view = false;

  assert.equal(canBrowseCashClosureCatalog(admin, "qualquer-unidade"), true);
});
