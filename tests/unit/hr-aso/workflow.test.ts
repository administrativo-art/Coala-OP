import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createAsoToken,
  extractAppointmentProposal,
  hashAsoToken,
  missingAsoEmailPrerequisites,
} from '../../../src/features/hr/aso/workflow';
import { isAsoAppointmentAfterAdmission } from '../../../src/features/hr/aso/dates';
import {
  MEDCLINC_REFERRAL_COMPANY_NAME,
  renderMedclincReferralPdf,
} from '../../../src/features/hr/aso/medclinc-referral-pdf';
import { engagementStatusFromResendEvent } from '../../../src/lib/email/resend-events';

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

  test('alerta quando o exame fica depois da admissão prevista', () => {
    assert.equal(isAsoAppointmentAfterAdmission('2026-09-23', '2026-09-22'), true);
    assert.equal(isAsoAppointmentAfterAdmission('2026-09-22', '2026-09-22'), false);
    assert.equal(isAsoAppointmentAfterAdmission('2026-09-21', '2026-09-22'), false);
    assert.equal(isAsoAppointmentAfterAdmission(null, '2026-09-22'), false);
  });

  test('gera a guia do ASO como PDF válido sem depender do reconciliador do React', async () => {
    assert.equal(MEDCLINC_REFERRAL_COMPANY_NAME, 'CT Sorvetes LTDA');
    const pdf = await renderMedclincReferralPdf({
      employerCnpj: '14.276.603/0001-25',
      employeeName: 'Thaise Correia Marinho',
      employeeCpf: '058.136.883-58',
      jobFunction: 'Atendente de balcão',
      examType: 'admission',
    });
    assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 5_000);
  });

  test('mapeia abertura e clique como engajamento', () => {
    assert.equal(engagementStatusFromResendEvent('email.opened'), 'opened');
    assert.equal(engagementStatusFromResendEvent('email.clicked'), 'clicked');
    assert.equal(engagementStatusFromResendEvent('email.delivered'), null);
  });

  test('envio exige somente formulário, admissão e pagamento', () => {
    assert.deepEqual(missingAsoEmailPrerequisites({
      expectedAdmissionDate: '2026-08-10',
      formDataConfirmed: true,
      paymentPaid: true,
    }), []);

    assert.deepEqual(missingAsoEmailPrerequisites({
      expectedAdmissionDate: null,
      formDataConfirmed: false,
      paymentPaid: false,
    }), [
      'conferência dos dados do formulário',
      'data de admissão',
      'confirmação do pagamento do ASO',
    ]);
  });
});
