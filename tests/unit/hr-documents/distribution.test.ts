import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { getDocumentTypeConfig } from "../../../src/lib/hr/employee-document-catalog";
import {
  resolveDocumentProcess,
  resolveDocumentDestination,
  buildLogicalKey,
  resolveDuplicateAndVersion,
} from "../../../src/lib/hr/employee-document-distribution";
import { resolveEmployeeDocumentFolderPath } from "../../../src/lib/hr/employee-document-options";

describe("resolveDocumentProcess", () => {
  test("férias: período aquisitivo + parcela", () => {
    const p = resolveDocumentProcess("VACATION_INSTALLMENT", {
      acquisitionPeriodStart: "2025-08-01",
      acquisitionPeriodEnd: "2026-07-31",
      installmentNumber: 1,
    });
    assert.equal(p.caseId, "vacation-period-2025-2026");
    assert.equal(p.subcaseId, "installment-01");
    assert.deepEqual(p.pathSegments, ["Período aquisitivo 2025-2026", "Parcela 01"]);
  });

  test("remuneração: ano/mês por competência", () => {
    const p = resolveDocumentProcess("MONTHLY_REFERENCE", { referenceMonth: "2026-07" });
    assert.deepEqual(p.pathSegments, ["2026", "Julho"]);
    assert.equal(p.tokens.referenceMonthLabel, "Julho de 2026");
  });

  test("afastamento: intervalo de datas", () => {
    const p = resolveDocumentProcess("LEAVE", { startDate: "2026-07-10", endDate: "2026-07-12" });
    assert.deepEqual(p.pathSegments, ["Afastamento 10/07/2026 a 12/07/2026"]);
  });

  test("não cria processo artificial sem metadado confiável", () => {
    assert.deepEqual(resolveDocumentProcess("MONTHLY_REFERENCE", {}).pathSegments, []);
    assert.deepEqual(resolveDocumentProcess("VACATION_INSTALLMENT", {}).pathSegments, []);
    assert.deepEqual(resolveDocumentProcess("LEAVE", {}).pathSegments, []);
  });
});

describe("taxonomia híbrida de pastas", () => {
  test("identificação usa agrupamento fixo por natureza", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "personal",
      documentTypeCode: "ADDRESS_PROOF",
      documentTypeLabel: "Comprovante de residência",
      destinationTrail: ["Identificação", "Comprovante de residência"],
    }), ["Documentos pessoais"]);
  });

  test("CTPS e PIS ficam em documentos pessoais", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "personal",
      documentTypeCode: "WORK_CARD",
      documentTypeLabel: "Carteira de trabalho",
    }), ["Documentos pessoais"]);
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "personal",
      documentTypeCode: "PIS_PASEP",
      documentTypeLabel: "PIS/PASEP",
    }), ["Documentos pessoais"]);
  });

  test("contratos ficam diretamente na pasta Contrato de Admissão", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "admission",
      documentTypeCode: "PROBATION_CONTRACT",
      documentTypeLabel: "Contrato de experiência",
    }), ["Contrato"]);
  });

  test("recibos e pagamentos de férias compartilham a mesma pasta", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "vacations",
      documentTypeCode: "VACATION_RECEIPT",
      documentTypeLabel: "Recibo de férias",
    }), ["Recibos e pagamentos"]);
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "vacations",
      documentTypeCode: "VACATION_PAYMENT",
      documentTypeLabel: "Pagamento de férias",
    }), ["Recibos e pagamentos"]);
  });

  test("escala e hora extra legadas são consolidadas no espelho de ponto", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({ category: "work_schedule", documentTypeLabel: "Escala de trabalho" }), ["Espelhos de ponto"]);
    assert.deepEqual(resolveEmployeeDocumentFolderPath({ category: "work_schedule", documentTypeLabel: "Horas extras" }), ["Espelhos de ponto"]);
  });

  test("remuneração organiza processo antes da natureza", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "remuneration",
      documentTypeCode: "PAYSLIP",
      documentTypeLabel: "Contracheque",
      destinationTrail: ["Remuneração", "2026", "Julho", "Contracheque"],
    }), ["2026", "Julho", "Contracheques"]);
  });

  test("férias preserva período e parcela antes do tipo", () => {
    assert.deepEqual(resolveEmployeeDocumentFolderPath({
      category: "vacations",
      documentTypeCode: "VACATION_NOTICE",
      documentTypeLabel: "Aviso de férias",
      destinationTrail: ["Férias", "Período aquisitivo 2025-2026", "Parcela 01", "Aviso de férias"],
    }), ["Período aquisitivo 2025-2026", "Parcela 01", "Avisos"]);
  });
});

describe("resolveDocumentDestination + nomenclatura (exemplos do plano)", () => {
  test("contracheque", () => {
    const config = getDocumentTypeConfig("PAYSLIP");
    const d = resolveDocumentDestination({ config, employeeCode: "COL-00124", fields: { referenceMonth: "2026-07" }, version: 1 });
    assert.equal(d.downloadName, "COL-00124__CONTRACHEQUE__2026-07__v01");
    assert.equal(d.displayName, "Contracheque — Julho de 2026");
    assert.deepEqual(d.pathSegments, ["Remuneração", "2026", "Julho", "Contracheque"]);
    assert.equal(d.accessPolicyId, "HR_FINANCE");
  });

  test("aviso de férias", () => {
    const config = getDocumentTypeConfig("VACATION_NOTICE");
    const d = resolveDocumentDestination({
      config,
      employeeCode: "COL-00124",
      fields: { acquisitionPeriodStart: "2025-08-01", acquisitionPeriodEnd: "2026-07-31", installmentNumber: 1, issueDate: "2026-07-30" },
      version: 1,
    });
    assert.equal(d.downloadName, "COL-00124__AVISO-FERIAS__PA-2025-2026__P01__2026-07-30__v01");
    assert.deepEqual(d.pathSegments, ["Férias", "Período aquisitivo 2025-2026", "Parcela 01", "Aviso de férias"]);
  });
});

describe("resolveDuplicateAndVersion", () => {
  const base = { employeeId: "emp1", code: "PAYSLIP", strategy: "VERSION" as const, keys: ["referenceMonth"], fields: { referenceMonth: "2026-07" } };

  test("sem existentes → NEW_DOCUMENT v1", () => {
    const r = resolveDuplicateAndVersion({ ...base, contentHash: "h1", existing: [] });
    assert.equal(r.resolution, "NEW_DOCUMENT");
    assert.equal(r.version, 1);
  });

  test("hash igual → EXACT_DUPLICATE", () => {
    const r = resolveDuplicateAndVersion({ ...base, contentHash: "h1", existing: [{ id: "d0", contentHash: "h1", version: 1 }] });
    assert.equal(r.resolution, "EXACT_DUPLICATE");
    assert.equal(r.existingDocumentId, "d0");
  });

  test("mesma chave lógica + VERSION → NEW_VERSION v2", () => {
    const logicalKey = buildLogicalKey("emp1", "PAYSLIP", ["referenceMonth"], { referenceMonth: "2026-07" });
    const r = resolveDuplicateAndVersion({ ...base, contentHash: "h2", existing: [{ id: "d1", contentHash: "h1", logicalKey, version: 1 }] });
    assert.equal(r.resolution, "NEW_VERSION");
    assert.equal(r.version, 2);
    assert.equal(r.existingDocumentId, "d1");
  });

  test("mesma chave lógica + WARN → POSSIBLE_DUPLICATE", () => {
    const logicalKey = buildLogicalKey("emp1", "ASO_PERIODIC", ["examDate"], { examDate: "2026-07-01" });
    const r = resolveDuplicateAndVersion({
      employeeId: "emp1", code: "ASO_PERIODIC", strategy: "WARN", keys: ["examDate"], fields: { examDate: "2026-07-01" },
      contentHash: "hX", existing: [{ id: "a1", contentHash: "hOld", logicalKey, version: 1 }],
    });
    assert.equal(r.resolution, "POSSIBLE_DUPLICATE");
  });
});

describe("getDocumentTypeConfig (Fase 4 — fonte única)", () => {
  test("mescla base + acesso + enriquecimento", () => {
    const c = getDocumentTypeConfig("PAYSLIP");
    assert.equal(c.accessPolicyId, "HR_FINANCE");
    assert.equal(c.processCategory, "MONTHLY_REFERENCE");
    assert.equal(c.duplicateStrategy, "VERSION");
  });
  test("código desconhecido cai para UNKNOWN_DOCUMENT", () => {
    const c = getDocumentTypeConfig("NAO_EXISTE");
    assert.equal(c.code, "UNKNOWN_DOCUMENT");
  });
  test("formulário da contabilidade é arquivado no processo de admissão", () => {
    const c = getDocumentTypeConfig("ADMISSION_DATA_FORM");
    const destination = resolveDocumentDestination({
      config: c,
      employeeCode: "COL-00124",
      fields: { admissionDate: "2026-08-26" },
      version: 1,
    });
    assert.equal(c.category, "admission");
    assert.equal(c.duplicateStrategy, "VERSION");
    assert.deepEqual(destination.pathSegments, ["Admissão", "Admissão 26/08/2026", "Formulário de admissão para contabilidade"]);
  });
});
