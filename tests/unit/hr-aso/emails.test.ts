import assert from 'node:assert/strict';
import { test } from 'node:test';

import { candidateAsoEmailContent, clinicAsoEmailContent } from '../../../src/features/hr/aso/emails';
import { renderCoalaEmail } from '../../../src/lib/email/template';

test('e-mail da clínica usa dados dinâmicos e não repete o assunto como título', () => {
  const content = clinicAsoEmailContent({ candidateName: 'Maria Silva', jobFunction: 'Atendente', companyName: 'CT Sorvetes LTDA', companyCnpj: '14.276.603/0001-25', companyAddress: 'Rua Osíres, 24', companyContacts: 'Tiago Brasil', attachments: [{ label: 'Guia preenchida', fileName: 'guia.pdf' }] });
  assert.match(content.message, /^Prezados, boa tarde\./);
  assert.match(content.message, /• Maria Silva, Atendente;/);
  assert.equal(content.title, undefined);
  const html = renderCoalaEmail({ title: content.title, message: content.message, emphasis: content.emphasis });
  assert.doesNotMatch(html, /<h1/);
  assert.match(html, /<strong>Por gentileza/);
  assert.match(html, /coala-email-logo\.jpg/);
  const withoutFooter = renderCoalaEmail({ message: content.message, footer: null });
  assert.doesNotMatch(withoutFooter, /mensagem automática|encaminhada ao RH/i);
});

test('e-mail do candidato contém endereço, mapa e link exclusivo do ASO', () => {
  const content = candidateAsoEmailContent({ candidateName: 'Maria Silva', appointmentLabel: '24/07/2026 às 08:30', uploadUrl: 'https://exemplo/aso' });
  assert.match(content.locationBlock, /Av\. Getúlio Vargas, 43/);
  assert.match(content.locationBlock, /em frente ao SENAI/i);
  assert.match(content.text, /maps\.app\.goo\.gl/);
  assert.match(content.text, /https:\/\/exemplo\/aso/);
  assert.equal(content.title, undefined);
  assert.doesNotMatch(content.message, /Após o exame/);
  assert.equal((content.text.match(/Após o exame/g) ?? []).length, 1);
  const html = renderCoalaEmail({ message: content.message, secondaryAction: { label: 'Enviar ASO', url: 'https://exemplo/aso' }, secondaryActionLead: 'Após o exame, envie o ASO digitalizado por esse link:', secondaryActionVariant: 'highlight' });
  assert.match(html, /background:#fff1f7/);
  assert.match(html, /background:#ec4899/);
  const locationHtml = renderCoalaEmail({ message: content.message, highlightBlock: { text: content.locationBlock, tone: 'green', action: { label: 'Abrir localização', url: content.mapsUrl } } });
  assert.match(locationHtml, /background:#ecfdf5/);
  assert.match(locationHtml, /border:1px solid #86efac/);
});
