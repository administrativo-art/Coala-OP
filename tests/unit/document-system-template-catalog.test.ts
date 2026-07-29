import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";

import { applyCoalaLetterheadToPdf } from "../../src/features/hr/documents/letterhead-pdf.server";
import {
  SYSTEM_DOCUMENT_TEMPLATES,
  systemDocumentTemplateById,
} from "../../src/features/hr/documents/system-template-catalog";

test("catálogo reúne base institucional, uniformes e kit admissional", () => {
  assert.equal(SYSTEM_DOCUMENT_TEMPLATES.length, 15);
  assert.deepEqual(
    [...new Set(SYSTEM_DOCUMENT_TEMPLATES.map((template) => template.category))].sort(),
    ["Admissão", "Base institucional", "Contratos", "Financeiro e recibos", "Uniformes"].sort(),
  );
  assert.equal(systemDocumentTemplateById("system-letterhead-blank")?.status, "published");
  assert.equal(
    SYSTEM_DOCUMENT_TEMPLATES.filter((template) => template.renderer === "uniform").length,
    3,
  );
  assert.equal(
    SYSTEM_DOCUMENT_TEMPLATES.filter((template) => template.renderer === "admission_docx").length,
    11,
  );
});

test("timbrado é aplicado ao PDF sem alterar a quantidade de páginas", async () => {
  const source = await PDFDocument.create();
  source.addPage([595.28, 841.89]);
  source.addPage([595.28, 841.89]);
  const input = Buffer.from(await source.save());
  const output = await applyCoalaLetterheadToPdf(input);
  const rendered = await PDFDocument.load(output);
  assert.equal(rendered.getPageCount(), 2);
  assert.ok(output.length > input.length);
});

test("identificadores do catálogo são únicos e todos usam o timbrado vigente", () => {
  const ids = SYSTEM_DOCUMENT_TEMPLATES.map((template) => template.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    SYSTEM_DOCUMENT_TEMPLATES.every(
      (template) => template.letterheadVersion === "coala-letterhead-v2",
    ),
  );
});

test("gerador avulso não oferece modelos que dependem de outro módulo", () => {
  const uniformTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter(
    (template) => template.renderer === "uniform",
  );
  assert.ok(uniformTemplates.length > 0);
  assert.ok(
    uniformTemplates.every(
      (template) =>
        template.generationMode === "contextual"
        && template.sourceModule === "uniforms"
        && template.sourceModulePath === "/dashboard/stock/uniforms",
    ),
  );
  assert.equal(
    systemDocumentTemplateById("system-receipt-standard")?.generationMode,
    "direct",
  );
  assert.equal(
    systemDocumentTemplateById("system-letterhead-blank")?.generationMode,
    "reference",
  );
});

test("vale-transporte fica no pacote inicial e vira avulso em alteração posterior", () => {
  const voucherTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter((template) =>
    template.id.includes("transportation-voucher"),
  );
  assert.equal(voucherTemplates.length, 2);
  voucherTemplates.forEach((template) => {
    assert.equal(template.signatureScope, "bundle");
    assert.equal(template.postAdmissionSignatureScope, "independent");
  });
});

test("fontes admissionais preservam os hashes catalogados", async () => {
  const admissionTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter(
    (template) => template.renderer === "admission_docx",
  );
  for (const template of admissionTemplates) {
    assert.ok(template.sourcePath);
    assert.ok(template.contentHash);
    const source = await readFile(path.join(process.cwd(), template.sourcePath!));
    assert.equal(createHash("sha256").update(source).digest("hex"), template.contentHash);
  }
});

test("contrato de experiência v2 está parametrizado sem alterar partes opacas", async () => {
  const template = systemDocumentTemplateById(
    "system-admission-employment-probation-contract",
  );
  assert.equal(template?.version, 2);
  assert.equal(template?.status, "draft");
  assert.equal(template?.sourcePath?.endsWith("01-contrato-experiencia-v2.docx"), true);
  assert.equal(
    template?.fieldMapping?.contract_monthly_salary?.kind,
    "system",
  );
  assert.ok(template?.variables.includes("integration.employer_name"));
  assert.ok(template?.variables.includes("contract_final_end_long"));

  const [original, prepared] = await Promise.all([
    readFile(path.join(process.cwd(), "docs/modelos-documentos/admissionais/01-contrato-experiencia-v1.docx")),
    readFile(path.join(process.cwd(), "docs/modelos-documentos/admissionais/01-contrato-experiencia-v2.docx")),
  ]);
  const originalZip = new PizZip(original);
  const preparedZip = new PizZip(prepared);
  const names = Array.from(new Set([
    ...Object.keys(originalZip.files),
    ...Object.keys(preparedZip.files),
  ])).filter((name) => !name.endsWith("/"));
  const changed = names.filter((name) => {
    const before = originalZip.file(name)?.asUint8Array();
    const after = preparedZip.file(name)?.asUint8Array();
    return !before || !after || Buffer.compare(Buffer.from(before), Buffer.from(after)) !== 0;
  }).sort();
  assert.deepEqual(changed, ["word/document.xml", "word/footer1.xml"]);
});

test("acordo de banco de horas v2 está parametrizado sem alterar partes opacas", async () => {
  const template = systemDocumentTemplateById(
    "system-admission-hours-bank-agreement",
  );
  assert.equal(template?.version, 2);
  assert.equal(template?.status, "draft");
  assert.equal(template?.sourcePath?.endsWith("02-banco-horas-v2.docx"), true);
  assert.ok(template?.variables.includes("employee.ctps_number"));
  assert.ok(template?.variables.includes("integration.employer_name"));
  assert.equal(template?.variables.length, 6);

  const [original, prepared] = await Promise.all([
    readFile(path.join(process.cwd(), "docs/modelos-documentos/admissionais/02-banco-horas-v1.docx")),
    readFile(path.join(process.cwd(), "docs/modelos-documentos/admissionais/02-banco-horas-v2.docx")),
  ]);
  const originalZip = new PizZip(original);
  const preparedZip = new PizZip(prepared);
  const names = Array.from(new Set([
    ...Object.keys(originalZip.files),
    ...Object.keys(preparedZip.files),
  ])).filter((name) => !name.endsWith("/"));
  const changed = names.filter((name) => {
    const before = originalZip.file(name)?.asUint8Array();
    const after = preparedZip.file(name)?.asUint8Array();
    return !before || !after || Buffer.compare(Buffer.from(before), Buffer.from(after)) !== 0;
  }).sort();
  assert.deepEqual(changed, ["word/document.xml", "word/footer1.xml"]);
});
