import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

import { buildVacationNoticePdf } from '../../src/features/hr/vacations/vacation-notice-pdf.server';

test('gera aviso de férias válido em A4 com uma única página', async () => {
  const buffer = await buildVacationNoticePdf({
    companyLegalName: 'C T Sorvetes Ltda',
    companyCnpj: '14276603000125',
    companyAddress: 'Avenida Guajajaras, 3505, São Luís/MA',
    employeeName: 'Colaboradora de Exemplo',
    employeeCpf: '05813688358',
    employeeCtps: 'CTPS Digital · CPF 058.136.883-58',
    employeeRegistration: '0042',
    employeeRole: 'Atendente de quiosque',
    employeeAdmissionDate: '2024-05-10',
    employeeEmail: 'colaboradora@example.com',
    acquisitionPeriodStart: '2025-05-10',
    acquisitionPeriodEnd: '2026-05-09',
    concessiveDeadline: '2027-05-09',
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    returnDate: '2026-10-16',
    days: 15,
    entitledDays: 30,
    allowanceText: 'Não requerido',
    thirteenthAdvanceText: 'Não requerida',
    paymentDeadline: '2026-09-29',
    noticeLeadDays: 30,
    observations: null,
    installments: [{
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      days: 15,
      status: 'Aprovada',
    }],
  });

  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');
  const document = await PDFDocument.load(buffer);
  assert.equal(document.getPageCount(), 1);
  const [page] = document.getPages();
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);

  const resources = page.node.Resources();
  const xObjects = resources?.lookup(PDFName.of('XObject'), PDFDict);
  assert.ok(xObjects && xObjects.entries().length > 0, 'o aviso precisa incorporar o timbre oficial');
});

test('o gerador institucional aplica o timbre canônico e não imprime metadados técnicos', async () => {
  const root = process.cwd();
  const [overlay, source] = await Promise.all([
    readFile(path.join(root, 'src/features/hr/documents/assets/coala-shakes-letterhead-overlay-a4-v2.png')),
    readFile(path.join(root, 'src/features/hr/vacations/vacation-notice-pdf.server.ts'), 'utf8'),
  ]);
  assert.ok(overlay.length > 1_000);
  assert.match(source, /applyCoalaLetterheadToPdf\(content\)/);
  assert.doesNotMatch(source, /Documento \$\{input\.documentId\}/);
  assert.doesNotMatch(source, /registro de integridade e auditoria/);
  assert.doesNotMatch(source, /Código de verificação/);
});
