import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createAsoToken, extractAppointmentProposal, hashAsoToken, missingAsoEmailPrerequisites } from '../../../src/features/hr/aso/workflow';
import { engagementStatusFromResendEvent } from '../../../src/lib/email/resend-events';
import type { OnboardingDocument } from '../../../src/types';

const approvedDocument: OnboardingDocument = {
  id: 'identity',
  label: 'Documento de identificação',
  required: true,
  status: 'approved',
  filePath: 'hr/onboarding/id.pdf',
};

describe('fluxo do ASO', () => {
  test('gera token opaco e persiste somente o hash', () => {
    const first = createAsoToken(); const second = createAsoToken();
    assert.notEqual(first.token, second.token);
    assert.equal(first.hash, hashAsoToken(first.token));
    assert.equal(first.hash.length, 64);
    assert.equal(first.hash.includes(first.token), false);
  });

  test('extrai proposta de agendamento sem confirmá-la', () => {
    const result = extractAppointmentProposal('Agendado para 24/07/2026 às 08:30. Local: MedClinic, Avenida Gomes de Castro, 178.');
    assert.equal(result.date, '2026-07-24');
    assert.equal(result.time, '08:30');
    assert.equal(result.location, 'MedClinic, Avenida Gomes de Castro, 178');
    assert.equal(result.confidence, 1);
  });

  test('retorno incompleto permanece com confiança parcial', () => {
    const result = extractAppointmentProposal('Pode comparecer dia 24/07/2026.');
    assert.equal(result.date, '2026-07-24');
    assert.equal(result.time, null);
    assert.ok(result.confidence < 1);
  });

  test('mapeia abertura e clique como engajamento', () => {
    assert.equal(engagementStatusFromResendEvent('email.opened'), 'opened');
    assert.equal(engagementStatusFromResendEvent('email.clicked'), 'clicked');
    assert.equal(engagementStatusFromResendEvent('email.delivered'), null);
  });

  test('envio exige documentos, formulário, admissão e pagamento', () => {
    assert.deepEqual(missingAsoEmailPrerequisites({
      documents: [approvedDocument],
      expectedAdmissionDate: '2026-08-10',
      formDataConfirmed: true,
      paymentPaid: true,
    }), []);

    assert.equal(missingAsoEmailPrerequisites({
      documents: [{ ...approvedDocument, status: 'received' }],
      expectedAdmissionDate: null,
      formDataConfirmed: false,
      paymentPaid: false,
    }).length, 4);
  });

  test('ASO não entra na validação documental anterior ao envio dos e-mails', () => {
    assert.deepEqual(missingAsoEmailPrerequisites({
      documents: [
        approvedDocument,
        { id: 'aso_admission', label: 'ASO', required: true, status: 'pending', documentTypeCode: 'ASO_ADMISSION' },
      ],
      expectedAdmissionDate: '2026-08-10',
      formDataConfirmed: true,
      paymentPaid: true,
    }), []);
  });
});
