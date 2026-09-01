import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';

import { buildVacationNoticePdf } from '../../src/features/hr/vacations/vacation-notice-pdf.server';

test('gera aviso de férias válido em A4 com uma única página', async () => {
  const buffer = await buildVacationNoticePdf({
    documentId: 'notice-1',
    companyLegalName: 'C T Sorvetes Ltda',
    companyCnpj: '14276603000125',
    companyAddress: 'Avenida Guajajaras, 3505, São Luís/MA',
    employeeName: 'Colaboradora de Exemplo',
    employeeEmail: 'colaboradora@example.com',
    acquisitionCycle: '2025-2026',
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    returnDate: '2026-10-16',
    days: 15,
    communicationDate: '2026-09-01',
    paymentDeadline: '2026-09-29',
  });

  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF');
  const document = await PDFDocument.load(buffer);
  assert.equal(document.getPageCount(), 1);
  const [page] = document.getPages();
  assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1);
  assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
});
