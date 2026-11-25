import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { signatureWorkflowAppError } from '../../src/features/hr/documents/signature-workflow-errors';
import { ParticipantActionUserError } from '../../src/features/hr/documents/admission-signature-actions';
import { AppError } from '../../src/lib/observability/app-error';

describe('Erros do fluxo de assinatura da admissão (rota com errorExposure sanitized)', () => {
  it('mensagem de negócio conhecida chega à tela como erro de validação', () => {
    const error = signatureWorkflowAppError(new Error('Revise o pacote completo antes de enviar para assinatura.'));
    assert.ok(error instanceof AppError);
    assert.equal(error.kind, 'VALIDATION');
    assert.equal(error.safeMessage, 'Revise o pacote completo antes de enviar para assinatura.');
  });

  it('mensagens com prefixo conhecido também passam, com limite de tamanho', () => {
    assert.equal(signatureWorkflowAppError(new Error('Gere o termo antes de enviar.'))?.safeMessage, 'Gere o termo antes de enviar.');
    assert.equal(signatureWorkflowAppError(new Error(`Gere ${'x'.repeat(400)}`)), null);
  });

  it('erro do signatário vira validação; falha técnica ou desconhecida não expõe a mensagem', () => {
    assert.equal(signatureWorkflowAppError(new ParticipantActionUserError('E-mail igual ao atual.'))?.safeMessage, 'E-mail igual ao atual.');
    assert.equal(signatureWorkflowAppError(new Error('URL do documento assinado não autorizada.')), null);
    assert.equal(signatureWorkflowAppError(new Error('connect ECONNREFUSED 10.0.0.1:443')), null);
    assert.equal(signatureWorkflowAppError('texto solto'), null);
  });

  it('AppError já tratado passa adiante sem mudança', () => {
    const original = new AppError({ code: 'ADMISSION_SIGNATURE_DOCUMENT_NOT_FOUND', kind: 'NOT_FOUND', safeMessage: 'Documento não encontrado.' });
    assert.equal(signatureWorkflowAppError(original), original);
  });
});
