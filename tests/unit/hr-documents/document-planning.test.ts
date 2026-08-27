import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildEmployeeDocumentPlan } from "../../../src/lib/hr/employee-document-planning";

describe("buildEmployeeDocumentPlan — sem PII no caminho físico", () => {
  const plan = buildEmployeeDocumentPlan({
    employeeId: "AbC123xyZ789Uid",
    employeeName: "Maria Joana Barbosa Pereira",
    category: "remuneration",
    documentType: "Contracheque",
    originalName: "contracheque julho.pdf",
    documentId: "550e8400-e29b-41d4-a716-446655440000",
    mimeType: "application/pdf",
  });

  test("storagePath usa apenas identificadores técnicos", () => {
    assert.equal(
      plan.storagePath,
      "hr/employee-documents/AbC123xyZ789Uid/documents/550e8400-e29b-41d4-a716-446655440000/original.pdf",
    );
  });

  test("nome completo do colaborador NÃO aparece no path", () => {
    assert.ok(!/maria|joana|barbosa|pereira/i.test(plan.storagePath));
    assert.ok(!/maria|joana|barbosa|pereira/i.test(plan.storageSubfolder));
  });

  test("nome de download não contém o nome do colaborador", () => {
    assert.ok(!/maria|joana|barbosa|pereira/i.test(plan.fileName));
    assert.ok(plan.fileName.endsWith(".pdf"));
  });

  test("trilha de exibição permanece legível (não é caminho físico)", () => {
    assert.deepEqual(plan.destinationTrail, ["Documentos do colaborador", "Remuneração", "Contracheque"]);
  });
});
