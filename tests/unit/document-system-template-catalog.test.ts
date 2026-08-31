import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";

import { SignedUniformMovementTermDocument } from "../../src/components/pdf/UniformTermDocument";
import { applyCoalaLetterheadToPdf } from "../../src/features/hr/documents/letterhead-pdf.server";
import {
  ADMISSION_SIGNATURE_TEMPLATE_ORDER,
  ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID,
  ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID,
  compareAdmissionSignatureOrder,
  isAdmissionSignatureTemplateApplicable,
} from "../../src/features/hr/documents/admission-signature-order";
import {
  isSelectableAdmissionSignatureTemplate,
  SYSTEM_DOCUMENT_TEMPLATES,
  systemDocumentTemplateById,
} from "../../src/features/hr/documents/system-template-catalog";

test("catálogo reúne base institucional, uniformes e kit admissional", () => {
  assert.equal(SYSTEM_DOCUMENT_TEMPLATES.length, 14);
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
    10,
  );
  const admissionTemplates = SYSTEM_DOCUMENT_TEMPLATES.filter((template) =>
    template.id.startsWith("system-admission-"),
  );
  assert.equal(admissionTemplates.length, 9);
  assert.ok(admissionTemplates.every((template) => template.status === "published"));
});

test("termo de ponto eletrônico não integra o catálogo operacional", () => {
  assert.equal(
    systemDocumentTemplateById("system-admission-electronic-time-tracking-awareness"),
    null,
  );
});

test("seleção admissional oferece oito modelos e mantém o encerramento automático", () => {
  const selectable = SYSTEM_DOCUMENT_TEMPLATES.filter(isSelectableAdmissionSignatureTemplate);
  assert.equal(selectable.length, 8);
  assert.equal(
    selectable.some((template) => template.id === "system-admission-bundle-closing-term"),
    false,
  );
});

test("ordem da seleção admissional é a mesma ordem canônica do pacote PDF", () => {
  const selectable = [...SYSTEM_DOCUMENT_TEMPLATES.filter(isSelectableAdmissionSignatureTemplate)]
    .sort(compareAdmissionSignatureOrder);

  assert.deepEqual(
    selectable.map((template) => template.id),
    ADMISSION_SIGNATURE_TEMPLATE_ORDER.filter((id) =>
      id !== "system-admission-bundle-closing-term"
    ),
  );

  const reversedWorkflow = [...selectable].reverse().map((template, order) => ({
    id: `workflow-${order}`,
    templateId: template.id,
    templateName: template.name,
    order,
  }));
  assert.deepEqual(
    [...reversedWorkflow].sort(compareAdmissionSignatureOrder).map((document) => document.templateId),
    selectable.map((template) => template.id),
  );
});

test("seleção admissional oferece somente a modalidade vigente de vale-transporte", () => {
  const selectable = SYSTEM_DOCUMENT_TEMPLATES.filter(isSelectableAdmissionSignatureTemplate);
  const forRequest = selectable.filter((template) =>
    isAdmissionSignatureTemplateApplicable(template, "yes")
  );
  const forWaiver = selectable.filter((template) =>
    isAdmissionSignatureTemplateApplicable(template, "no")
  );
  const withoutDecision = selectable.filter((template) =>
    isAdmissionSignatureTemplateApplicable(template, null)
  );

  assert.equal(forRequest.length, 7);
  assert.equal(forRequest.some((template) =>
    template.id === ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID
  ), true);
  assert.equal(forRequest.some((template) =>
    template.id === ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID
  ), false);
  assert.equal(forWaiver.length, 7);
  assert.equal(forWaiver.some((template) =>
    template.id === ADMISSION_TRANSPORT_VOUCHER_REQUEST_TEMPLATE_ID
  ), false);
  assert.equal(forWaiver.some((template) =>
    template.id === ADMISSION_TRANSPORT_VOUCHER_WAIVER_TEMPLATE_ID
  ), true);
  assert.equal(withoutDecision.length, 6);
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

test("prévia fictícia de uniforme gera PDF válido sem pós-processamento", async () => {
  const document = React.createElement(SignedUniformMovementTermDocument, {
      type: "return",
      protocol: "DEMO",
      collaboratorName: "Nome do colaborador",
      collaboratorDocument: "***.***.***-**",
      registeredByName: "Responsável/RH",
      occurredAt: "30/07/2026",
      outgoingItems: [],
      incomingItems: [{
        productName: "Camiseta polo",
        quantity: 1,
        condition: "usado",
        stockDisposition: "retorna_estoque",
      }],
      preview: true,
    }) as Parameters<typeof renderToBuffer>[0];
  const output = Buffer.from(await renderToBuffer(document));
  const rendered = await PDFDocument.load(output);
  assert.equal(rendered.getPageCount(), 1);
  assert.equal(output.subarray(0, 4).toString(), "%PDF");
});

test("prévias versionadas dos três modelos de uniforme são PDFs A4 válidos", async () => {
  for (const type of ["delivery", "exchange", "return"]) {
    const output = await readFile(path.join(
      process.cwd(),
      "public/document-previews/uniforms",
      `uniform-${type}-preview.pdf`,
    ));
    const rendered = await PDFDocument.load(output);
    assert.equal(rendered.getPageCount(), 1);
    const { width, height } = rendered.getPage(0).getSize();
    assert.ok(Math.abs(width - 595.28) < 0.1);
    assert.ok(Math.abs(height - 841.89) < 0.1);
  }
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

test("contrato de experiência v4 usa razão social e layout de assinatura vigentes", async () => {
  const template = systemDocumentTemplateById(
    "system-admission-employment-probation-contract",
  );
  assert.equal(template?.version, 4);
  assert.equal(template?.status, "published");
  assert.equal(template?.sourcePath?.endsWith("01-contrato-experiencia-v4.docx"), true);
  const salaryBinding = template?.fieldMapping?.contract_monthly_salary;
  assert.equal(salaryBinding?.kind, "system");
  if (salaryBinding?.kind === "system") {
    assert.equal(salaryBinding.formatter, "currency_br_with_words");
  }
  assert.ok(template?.variables.includes("integration.employer_name"));
  assert.ok(template?.variables.includes("contract_final_end_long"));
  assert.ok(template?.variables.includes("contract_first_period_days"));
  assert.ok(template?.variables.includes("contract_second_period_days"));
  assert.ok(template?.variables.includes("employee.address"));
  assert.ok(template?.variables.includes("contract_employee_cpf"));
  assert.equal(template?.variables.includes("employee.pis"), false);
  assert.equal(template?.variables.includes("employee.ctps_number"), false);
  assert.equal(template?.variables.includes("employee.ctps_series"), false);
  assert.equal(template?.fieldMapping?.contract_job_cbo?.kind, "system");
  assert.equal(template?.fieldMapping?.contract_work_scale, undefined);
  assert.equal(template?.fieldMapping?.contract_work_hours, undefined);
  assert.equal(template?.fieldMapping?.contract_workplace_address, undefined);
  assert.equal(template?.fieldMapping?.contract_cct_registry, undefined);
  assert.equal(template?.fieldMapping?.contract_cct_validity, undefined);
  assert.equal(template?.fieldMapping?.contract_union_employees, undefined);
  assert.equal(template?.fieldMapping?.contract_union_employers, undefined);
  assert.equal(template?.variables.length, 16);

  const prepared = await readFile(
    path.join(process.cwd(), "docs/modelos-documentos/admissionais/01-contrato-experiencia-v4.docx"),
  );
  const preparedZip = new PizZip(prepared);
  const documentXml = preparedZip.file("word/document.xml")?.asText() ?? "";
  assert.equal(documentXml.includes("PIS/NIT"), false);
  assert.equal(documentXml.includes("{{contract_monthly_salary_words}}"), false);
  assert.equal(documentXml.includes("{{contract_cct_registry}}"), false);
  assert.equal(documentXml.includes("{{contract_work_hours}}"), false);
  assert.equal(documentXml.includes("{{contract_workplace_address}}"), false);
  assert.ok(documentXml.includes("{{contract_monthly_salary}}"));
  assert.ok(documentXml.includes("{{contract_first_period_days}} dias"));
  assert.ok(documentXml.includes("{{contract_second_period_days}} dias"));
  assert.equal(documentXml.includes("vigorará por 45"), false);
  assert.equal(documentXml.includes("por igual período"), false);
  assert.ok(documentXml.includes("JORNADA DE TRABALHO"));
  assert.ok(documentXml.includes("CONFIDENCIALIDADE E PROPRIEDADE INTELECTUAL"));
  assert.ok(documentXml.includes("Termo de Confidencialidade que"));
  assert.ok(documentXml.includes("artigos 88 a 93 da Lei nº 9.279/1996"));
  assert.ok(documentXml.includes('<w:jc w:val="right"/>'));
  assert.equal((documentXml.match(/<w:spacing w:before="1000"\/>/g) ?? []).length, 2);
  for (const token of [
    "{{integration.employer_name}}",
    "{{contract_employer_cnpj}}",
    "{{integration.employer_address}}",
    "{{employee.name}}",
    "{{contract_employee_cpf}}",
    "{{employee.address}}",
  ]) {
    assert.ok(
      documentXml.includes(
        `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${token}</w:t></w:r>`,
      ),
    );
  }
});

test("acordo de banco de horas v2 está parametrizado sem alterar partes opacas", async () => {
  const template = systemDocumentTemplateById(
    "system-admission-hours-bank-agreement",
  );
  assert.equal(template?.version, 2);
  assert.equal(template?.status, "published");
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
