import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountantAdmissionEmailContent } from '../../../src/features/hr/accountant/emails';
import { renderCoalaEmail } from '../../../src/lib/email/template';

test('e-mail do contador destaca dados em verde e envio da ficha em rosa', () => {
  const content = accountantAdmissionEmailContent({
    candidateName: 'Sara Ferreira Coelho',
    jobFunction: 'Atendente de balcão',
    companyName: 'CT Sorvetes LTDA',
    companyCnpj: '14.276.603/0001-25',
    admissionDate: '25/07/2026',
    attachmentLabels: ['Formulário de admissão para a contabilidade', 'ASO admissional finalizado'],
    registryUploadUrl: 'https://exemplo/ficha',
  });

  const html = renderCoalaEmail({
    message: content.message,
    highlightBlock: { text: content.detailsBlock, tone: 'green' },
    afterActionMessage: content.afterDetailsMessage,
    secondaryAction: { label: content.registryUploadLabel, url: content.registryUploadUrl },
    secondaryActionLead: content.registryUploadLead,
    secondaryActionVariant: 'highlight',
    footer: 'Este é um e-mail automático e não aceita respostas.',
  });

  assert.match(html, /Colaboradora: Sara Ferreira Coelho/);
  assert.match(html, /background:#ecfdf5/);
  assert.match(html, /background:#fff1f7/);
  assert.match(html, /Enviar ficha de registro/);
  assert.match(html, /https:\/\/exemplo\/ficha/);
});
