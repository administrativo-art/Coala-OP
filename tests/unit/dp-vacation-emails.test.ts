import assert from 'node:assert/strict';
import test from 'node:test';

import { vacationAccountantEmailContent } from '../../src/features/hr/vacations/emails';

test('e-mail à contabilidade solicita o recibo com tom colaborativo e dados auditáveis', () => {
  const content = vacationAccountantEmailContent({
    employeeName: 'Maria Edna Gois Ribeiro',
    employeeCpf: '000.000.000-00',
    employeeRegistration: '0042',
    acquisitionPeriodStart: '2025-05-10',
    acquisitionPeriodEnd: '2026-05-09',
    vacationStartDate: '2026-10-01',
    vacationEndDate: '2026-10-30',
    vacationDays: 30,
    returnDate: '2026-10-31',
    allowanceText: 'Não requerido',
    thirteenthAdvanceText: 'Não requerida',
    noticeSignedAt: '02/09/2026 às 09:14',
    receiptUploadUrl: 'https://vagas.coalashakes.com/ferias/contabilidade/token-seguro',
  });

  assert.equal(content.subject, 'Recibo de férias a preparar - Maria Edna Gois Ribeiro');
  assert.match(content.text, /Você poderia, por gentileza, preparar o recibo/);
  assert.match(content.text, /Período aquisitivo: 10\/05\/2025 a 09\/05\/2026/);
  assert.match(content.text, /Gozo: 01\/10\/2026 a 30\/10\/2026 · 30 dias/);
  assert.match(content.html, /Envio seguro do recibo original/);
  assert.match(content.html, /Anexar recibo original/);
  assert.match(content.html, /expira em 30 dias e não deve ser encaminhado/);
  assert.doesNotMatch(content.text, /Prepare o recibo referente/);
});
