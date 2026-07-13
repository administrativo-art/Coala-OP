import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  resolveDocumentAccessPolicy,
  canAccessDocument,
  subjectFromPermissions,
  type DocumentAccessSubject,
} from "../../../src/lib/hr/employee-document-access";

// Sujeitos de referência.
const basicViewer: DocumentAccessSubject = {
  isDefaultAdmin: false, canManageUsers: false, rhRole: "employee",
  canViewSalary: false, collaboratorsView: true, collaboratorsEdit: false, isOwner: false,
};
const financeViewer: DocumentAccessSubject = { ...basicViewer, canViewSalary: true };
const elevatedHr: DocumentAccessSubject = { ...basicViewer, collaboratorsEdit: true };
const admin: DocumentAccessSubject = { ...basicViewer, isDefaultAdmin: true };
const owner: DocumentAccessSubject = { ...basicViewer, collaboratorsView: false, rhRole: undefined, isOwner: true };

describe("resolveDocumentAccessPolicy", () => {
  test("prioriza o código do tipo documental", () => {
    assert.equal(resolveDocumentAccessPolicy({ documentTypeCode: "PAYSLIP" }), "HR_FINANCE");
    assert.equal(resolveDocumentAccessPolicy({ documentTypeCode: "ASO_PERIODIC" }), "OCCUPATIONAL_HEALTH");
    assert.equal(resolveDocumentAccessPolicy({ documentTypeCode: "VACATION_NOTICE" }), "HR_OPERATIONAL");
  });

  test("cai para o nível legado quando não há código", () => {
    assert.equal(resolveDocumentAccessPolicy({ accessLevel: "confidential" }), "HR_RESTRICTED");
    assert.equal(resolveDocumentAccessPolicy({ accessLevel: "unrestricted" }), "HR_OPERATIONAL");
  });

  test("default seguro é RESTRITO", () => {
    assert.equal(resolveDocumentAccessPolicy({}), "HR_RESTRICTED");
  });
});

describe("enforcement — contracheque (HR_FINANCE)", () => {
  const doc = { documentTypeCode: "PAYSLIP" };
  test("usuário só com dp.view NÃO acessa", () => {
    assert.equal(canAccessDocument(doc, basicViewer).allowed, false);
  });
  test("financeiro acessa", () => {
    assert.equal(canAccessDocument(doc, financeViewer).allowed, true);
  });
  test("o próprio colaborador acessa o seu contracheque", () => {
    assert.equal(canAccessDocument(doc, owner).allowed, true);
  });
  test("admin acessa", () => {
    assert.equal(canAccessDocument(doc, admin).allowed, true);
  });
});

describe("enforcement — atestado/ASO (OCCUPATIONAL_HEALTH)", () => {
  const doc = { documentTypeCode: "ASO_PERIODIC" };
  test("dp.view básico NÃO acessa dado de saúde", () => {
    assert.equal(canAccessDocument(doc, basicViewer).allowed, false);
  });
  test("financeiro NÃO acessa atestado/ASO", () => {
    assert.equal(canAccessDocument(doc, financeViewer).allowed, false);
  });
  test("o próprio colaborador NÃO acessa (RH restrito)", () => {
    assert.equal(canAccessDocument(doc, owner).allowed, false);
  });
  test("RH elevado acessa", () => {
    assert.equal(canAccessDocument(doc, elevatedHr).allowed, true);
  });
});

describe("enforcement — aviso de férias (HR_OPERATIONAL)", () => {
  const doc = { documentTypeCode: "VACATION_NOTICE" };
  test("dp.view básico acessa", () => {
    assert.equal(canAccessDocument(doc, basicViewer).allowed, true);
  });
  test("perfil somente titular não acessa documento operacional de terceiro", () => {
    assert.equal(canAccessDocument(doc, { ...basicViewer, ownProfileOnly: true, isOwner: false }).allowed, false);
  });
  test("perfil somente titular acessa documento operacional próprio", () => {
    assert.equal(canAccessDocument(doc, { ...basicViewer, ownProfileOnly: true, isOwner: true }).allowed, true);
  });
});

describe("subjectFromPermissions", () => {
  test("mapeia PermissionSet para o sujeito", () => {
    const s = subjectFromPermissions(
      { settings: { manageUsers: false }, dp: { rh_role: "manager", rh: { can_view_salary: true }, collaborators: { view: true, edit: false } } },
      { isDefaultAdmin: false, isOwner: false },
    );
    assert.equal(s.rhRole, "manager");
    assert.equal(s.canViewSalary, true);
    assert.equal(s.collaboratorsView, true);
    // manager já é RH elevado → acessa documento restrito
    assert.equal(canAccessDocument({ documentTypeCode: "MEDICAL_CERTIFICATE" }, s).allowed, true);
  });
  test("mapeia ownProfileOnly do PermissionSet", () => {
    const s = subjectFromPermissions(
      { settings: { manageUsers: false }, dp: { collaborators: { view: true, edit: false, ownProfileOnly: true } } },
      { isDefaultAdmin: false, isOwner: false },
    );
    assert.equal(s.ownProfileOnly, true);
    assert.equal(canAccessDocument({ documentTypeCode: "VACATION_NOTICE" }, s).allowed, false);
  });
});
