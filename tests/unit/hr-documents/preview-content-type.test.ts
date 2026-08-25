import assert from 'node:assert/strict';
import test from 'node:test';

import { isPreviewableDocumentContentType } from '../../../src/features/hr/documents/preview-content-type';

test('visualização do ASO aceita PDF e imagens', () => {
  assert.equal(isPreviewableDocumentContentType('application/pdf'), true);
  assert.equal(isPreviewableDocumentContentType('image/jpeg', { allowImage: true }), true);
  assert.equal(isPreviewableDocumentContentType('image/png; charset=binary', { allowImage: true }), true);
});

test('outros anexos continuam rejeitando tipos inesperados', () => {
  assert.equal(isPreviewableDocumentContentType('image/jpeg'), false);
  assert.equal(isPreviewableDocumentContentType('text/html', { allowImage: true }), false);
});
