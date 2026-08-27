import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultGuestPermissions, type PermissionSet } from "../../../src/types/index";
import {
  applyLegacyFormalizationFallbacks,
  hasFormalizationPermission,
} from "../../../src/lib/hr-formalization-permissions";

function permissions() {
  return structuredClone(defaultGuestPermissions) as PermissionSet;
}

describe("permissões da formalização", () => {
  it("nega por padrão e mantém administrador padrão com acesso", () => {
    const value = permissions();
    assert.equal(hasFormalizationPermission(value, "aso.view"), false);
    assert.equal(hasFormalizationPermission(value, "templates.publish"), false);
    assert.equal(hasFormalizationPermission(value, "templates.publish", true), true);
  });

  it("faz permissões operacionais implicarem apenas sua própria visualização", () => {
    const value = permissions();
    value.hr.formalization.aso.manage = true;
    assert.equal(hasFormalizationPermission(value, "aso.view"), true);
    assert.equal(hasFormalizationPermission(value, "aso.manage"), true);
    assert.equal(hasFormalizationPermission(value, "accountant.view"), false);
  });

  it("trata o acesso à integração como fluxo operacional completo", () => {
    const value = permissions();
    value.hr.formalization.view = true;
    assert.equal(hasFormalizationPermission(value, "onboarding.manage"), true);
    assert.equal(hasFormalizationPermission(value, "aso.manage"), true);
    assert.equal(hasFormalizationPermission(value, "accountant.manage"), true);
    assert.equal(hasFormalizationPermission(value, "documents.generate"), true);
    assert.equal(hasFormalizationPermission(value, "documents.review"), true);
    assert.equal(hasFormalizationPermission(value, "signatures.send"), true);
    assert.equal(hasFormalizationPermission(value, "consents.view"), true);
    assert.equal(hasFormalizationPermission(value, "sensitiveData.view"), true);
    assert.equal(hasFormalizationPermission(value, "templates.manage"), false);
    assert.equal(hasFormalizationPermission(value, "companyDocuments.manage"), false);
    assert.equal(hasFormalizationPermission(value, "consents.manage"), false);
  });

  it("aplica compatibilidade somente quando o perfil ainda não possui o novo bloco", () => {
    const value = permissions();
    value.dp.collaborators.edit = true;
    applyLegacyFormalizationFallbacks(value, { dp: { collaborators: { edit: true } } } as never);
    assert.equal(value.hr.formalization.onboarding.manage, true);
    assert.equal(value.hr.formalization.templates.publish, true);
    assert.equal(value.hr.formalization.sensitiveData.view, false);

    const explicit = permissions();
    explicit.dp.collaborators.edit = true;
    applyLegacyFormalizationFallbacks(explicit, { hr: { formalization: { view: false } } } as never);
    assert.equal(explicit.hr.formalization.onboarding.manage, false);
  });

  it("mantém o fluxo legado completo para quem já gerenciava colaboradores", () => {
    const value = permissions();
    value.dp.collaborators.edit = true;
    applyLegacyFormalizationFallbacks(value, { dp: { collaborators: { edit: true } } } as never);
    assert.equal(hasFormalizationPermission(value, "documents.generate"), true);
    assert.equal(hasFormalizationPermission(value, "sensitiveData.view"), true);
  });

  it("não transforma acesso legado somente de leitura em condução da integração", () => {
    const value = permissions();
    value.recruitment.view = true;
    applyLegacyFormalizationFallbacks(value, { recruitment: { view: true } } as never);
    assert.equal(hasFormalizationPermission(value, "view"), false);
    assert.equal(hasFormalizationPermission(value, "aso.manage"), false);
    assert.equal(hasFormalizationPermission(value, "templates.view"), true);
  });
});
