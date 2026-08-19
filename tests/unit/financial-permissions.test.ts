import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultAdminPermissions, defaultGuestPermissions } from "../../src/types/index";

describe("permissões financeiras especializadas", () => {
  it("nega por padrão todas as ações sensíveis para perfis comuns", () => {
    assert.deepEqual(defaultGuestPermissions.financial.audits, {
      view: false,
      import: false,
      edit: false,
      ignore: false,
      effectuate: false,
      manage: false,
    });
    assert.deepEqual(defaultGuestPermissions.financial.cardStatements, {
      view: false,
      import: false,
      audit: false,
      close: false,
      reconcile: false,
    });
    assert.deepEqual(defaultGuestPermissions.financial.personnelCosts, {
      view: false,
      edit: false,
      export: false,
    });
    assert.equal(defaultGuestPermissions.settings.viewAiCosts, false);
  });

  it("mantém o administrador padrão com a matriz completa", () => {
    assert.ok(Object.values(defaultAdminPermissions.financial.audits).every(Boolean));
    assert.ok(Object.values(defaultAdminPermissions.financial.cardStatements).every(Boolean));
    assert.ok(Object.values(defaultAdminPermissions.financial.personnelCosts).every(Boolean));
    assert.equal(defaultAdminPermissions.settings.viewAiCosts, true);
  });

  it("não confunde importação, fechamento e conciliação da fatura", () => {
    const permissions = structuredClone(defaultGuestPermissions);
    permissions.financial.cardStatements.view = true;
    permissions.financial.cardStatements.import = true;

    assert.equal(permissions.financial.cardStatements.audit, false);
    assert.equal(permissions.financial.cardStatements.close, false);
    assert.equal(permissions.financial.cardStatements.reconcile, false);
  });
});
