import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resendAttachments } from '../../src/lib/email/resend-payload';

test('serializa PDFs e imagens CID no formato aceito pela API do Resend', () => {
  assert.deepEqual(resendAttachments([
    { filename: 'solicitacao.pdf', content: 'pdf-base64', contentType: 'application/pdf' },
    { filename: 'logo.jpg', content: 'image-base64', contentType: 'image/jpeg', contentId: 'coala-email-logo' },
  ]), [
    { filename: 'solicitacao.pdf', content: 'pdf-base64', content_type: 'application/pdf' },
    { filename: 'logo.jpg', content: 'image-base64', content_type: 'image/jpeg', content_id: 'coala-email-logo' },
  ]);
});
