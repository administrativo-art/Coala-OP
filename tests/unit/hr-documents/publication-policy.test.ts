import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canPublishManually, DEFAULT_DOCUMENT_PUBLICATION_POLICY, isPublishedToEmployee, resolvePublicationPolicy, shouldAutoPublish,
} from "../../../src/lib/hr/employee-document-publication";

const PUBLISHED = { status: "published" as const, at: "2026-10-20T12:00:00.000Z", by: "dp", source: "manual" as const };

describe("política de publicação aprovada (20/10/2026)", () => {
  test("pacote do fechamento publica ao assinar; contracheque avulso nunca (não vai duas vezes)", () => {
    assert.deepEqual(resolvePublicationPolicy("TIME_CLOSING_PACKAGE"), { mode: "automatic", trigger: "signed" });
    assert.equal(resolvePublicationPolicy("PAYSLIP").mode, "never");
  });
  test("restritos: pessoais, dependentes, atestado, advertência, comprovante de férias, formulários da admissão", () => {
    for (const code of ["PERSONAL_ID", "DEPENDENT_DOCUMENT", "MEDICAL_CERTIFICATE", "DISCIPLINARY_WARNING", "VACATION_PAYMENT", "ADMISSION_DATA_FORM", "ASO_REQUEST", "ASO_ADMISSION"]) {
      assert.equal(resolvePublicationPolicy(code).mode, "never", code);
    }
  });
  test("visíveis: VT, uniformes avulsos, ASOs fora da admissão, rescisão e o pagamento rescisório", () => {
    for (const code of ["TRANSPORT_REQUEST", "UNIFORM_EXCHANGE", "ASO_PERIODIC", "TERMINATION_TERM", "TERMINATION_PAYMENT", "VACATION_NOTICE", "PROBATION_EXTENSION"]) {
      assert.equal(resolvePublicationPolicy(code).mode, "automatic", code);
    }
  });
  test("tipo novo ou não identificado não publica até ganhar política; a configuração do RH prevalece", () => {
    assert.equal(resolvePublicationPolicy("TIPO_NOVO").mode, "never");
    assert.equal(resolvePublicationPolicy("UNKNOWN_DOCUMENT", { UNKNOWN_DOCUMENT: { mode: "automatic", trigger: "validated" } }).mode, "never");
    assert.equal(resolvePublicationPolicy("PAYSLIP", { PAYSLIP: { mode: "manual", trigger: "validated" } }).mode, "manual");
    assert.ok(Object.keys(DEFAULT_DOCUMENT_PUBLICATION_POLICY).length > 30);
  });
});

describe("momento e travas da publicação", () => {
  test("automática ao assinar só com a assinatura concluída", () => {
    const policy = resolvePublicationPolicy("TIME_CLOSING_PACKAGE");
    assert.equal(shouldAutoPublish(policy, "signed", { signatureRequired: true, signatureStatus: "signed" }), true);
    assert.equal(shouldAutoPublish(policy, "validated", { signatureRequired: true, signatureStatus: "pending" }), false);
    assert.equal(shouldAutoPublish(resolvePublicationPolicy("PAYSLIP"), "validated", {}), false);
  });
  test("manual: nunca para restrito, não identificado, sem titular ou com assinatura pendente", () => {
    assert.equal(canPublishManually(resolvePublicationPolicy("PAYSLIP"), { documentTypeCode: "PAYSLIP", employeeId: "u" }), false);
    assert.equal(canPublishManually(resolvePublicationPolicy("VACATION_RECEIPT"), { documentTypeCode: "VACATION_RECEIPT", employeeId: "u", signatureRequired: true, signatureStatus: "sent" }), false);
    assert.equal(canPublishManually(resolvePublicationPolicy("VACATION_RECEIPT"), { documentTypeCode: "VACATION_RECEIPT", employeeId: null }), false);
    assert.equal(canPublishManually(resolvePublicationPolicy("ASO_PERIODIC"), { documentTypeCode: "ASO_PERIODIC", employeeId: "u" }), true);
  });
  test("publicado: só com marca, tipo identificado e sem exclusão", () => {
    assert.equal(isPublishedToEmployee({ documentTypeCode: "ASO_PERIODIC", publication: PUBLISHED }), true);
    assert.equal(isPublishedToEmployee({ documentTypeCode: "ASO_PERIODIC", publication: { ...PUBLISHED, status: "withdrawn" } }), false);
    assert.equal(isPublishedToEmployee({ documentTypeCode: "ASO_PERIODIC" }), false);
  });
});
