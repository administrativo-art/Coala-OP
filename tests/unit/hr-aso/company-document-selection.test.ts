import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectLatestSocialContract } from '../../../src/features/hr/aso/company-document-selection';

test('seleciona o contrato social em PDF ativo com upload mais recente', () => {
  const selected = selectLatestSocialContract([
    { id: 'old', title: 'Contrato Social', category: 'Societário', status: 'active', mimeType: 'application/pdf', storagePath: 'old.pdf', uploadedAt: '2026-01-01T10:00:00Z' },
    { id: 'new', title: 'Contrato Social - Quarta alteração', category: 'Societário', status: 'active', mimeType: 'application/pdf', storagePath: 'new.pdf', uploadedAt: '2026-07-20T10:00:00Z' },
  ]);
  assert.equal(selected?.id, 'new');
});

test('ignora documentos excluídos, inativos, sem arquivo ou que não sejam PDF', () => {
  const selected = selectLatestSocialContract([
    { id: 'deleted', title: 'Contrato Social', category: 'Societário', status: 'active', mimeType: 'application/pdf', storagePath: 'deleted.pdf', uploadedAt: '2026-07-20T10:00:00Z', deletedAt: '2026-07-20T11:00:00Z' },
    { id: 'image', title: 'Contrato Social', category: 'Societário', status: 'active', mimeType: 'image/png', storagePath: 'contract.png', uploadedAt: '2026-07-20T09:00:00Z' },
    { id: 'other', title: 'Alvará', category: 'Societário', status: 'active', mimeType: 'application/pdf', storagePath: 'other.pdf', uploadedAt: '2026-07-20T08:00:00Z' },
  ]);
  assert.equal(selected, null);
});
