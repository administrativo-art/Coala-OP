import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthenticatedApiError } from '../../../src/lib/authenticated-api-client';
import {
  archiveEditorTemplate,
  createEditorTemplate,
  listEditorTemplates,
  openEditorTemplate,
  previewEditorTemplate,
  publishEditorTemplate,
  saveEditorTemplate,
  toEditorFailure,
  createDocumentFromTemplate,
  type EditorRequest,
  type EditorTemplateView,
} from '../../../src/features/documents/editor/ui/editor-client';
import {
  SAVE_AS_TEMPLATE_NOTICE,
  TEMPLATE_STATUS_FILTERS,
  appendTemplatePage,
  applyTemplateUpdate,
  createAttemptRegistry,
  editableStatusFor,
  getArchiveBlockReason,
  getPublishBlockReason,
  getPublishListBlockReason,
  getSaveAsTemplateBlockReason,
  getUseTemplateBlockReason,
  hasUnpublishedChanges,
  isVersionConflictCode,
  shouldReloadTemplateList,
  templateCreateAttemptKey,
  templatePublishAttemptKey,
  templateUseAttemptKey,
} from '../../../src/features/documents/editor/ui/template-logic';

const apiError = (status: number, payload: unknown) => new AuthenticatedApiError('mensagem bruta do servidor', status, payload);
const view = (overrides: Partial<EditorTemplateView> = {}): EditorTemplateView => ({
  id: 'tpl_' + 'a'.repeat(32),
  name: 'Modelo',
  description: '',
  status: 'draft',
  currentVersion: 1,
  publishedVersion: null,
  contentHash: 'h',
  contentBytes: 10,
  fieldKeys: [],
  ...overrides,
});

test('Usar modelo: só publicado, com permissão de gerar; o motivo explica o bloqueio', () => {
  assert.equal(getUseTemplateBlockReason({ status: 'published', publishedVersion: 2 }, true), null);
  assert.match(getUseTemplateBlockReason({ status: 'published', publishedVersion: 2 }, false)!, /permissão de gerar/);
  assert.match(getUseTemplateBlockReason({ status: 'draft', publishedVersion: null }, true)!, /Publique o modelo/);
  assert.match(getUseTemplateBlockReason({ status: 'archived', publishedVersion: 1 }, true)!, /arquivado/);
  // publicado sem versão publicada é um estado inconsistente: bloqueia em vez de enviar pedido incompleto
  assert.match(getUseTemplateBlockReason({ status: 'published', publishedVersion: null }, true)!, /Publique/);
});

test('Publicar: exige revisão, conteúdo, sem conflito e versão ainda não publicada', () => {
  const base = { status: 'draft', canReview: true, hasContent: true, conflict: false, alreadyPublished: false };
  assert.equal(getPublishBlockReason(base), null);
  assert.equal(getPublishBlockReason({ ...base, status: 'published' }), null);
  assert.match(getPublishBlockReason({ ...base, status: 'archived' })!, /arquivado/);
  assert.match(getPublishBlockReason({ ...base, canReview: false })!, /permissão de revisão/);
  assert.match(getPublishBlockReason({ ...base, conflict: true })!, /conflito/);
  assert.match(getPublishBlockReason({ ...base, hasContent: false })!, /conteúdo/);
  assert.match(getPublishBlockReason({ ...base, alreadyPublished: true })!, /já está publicada/);
});

test('Publicar/arquivar na lista: revisores apenas, e nada em modelo arquivado', () => {
  assert.equal(getPublishListBlockReason(view({ status: 'draft' }), true), null);
  assert.match(getPublishListBlockReason(view({ status: 'draft' }), false)!, /permissão de revisão/);
  assert.match(getPublishListBlockReason(view({ status: 'published', currentVersion: 2, publishedVersion: 2 }), true)!, /já está publicada/);
  assert.equal(getPublishListBlockReason(view({ status: 'published', currentVersion: 3, publishedVersion: 2 }), true), null);
  assert.match(getPublishListBlockReason(view({ status: 'archived' }), true)!, /arquivado/);
  assert.equal(getArchiveBlockReason({ status: 'published', canReview: true }), null);
  assert.match(getArchiveBlockReason({ status: 'draft', canReview: false })!, /permissão de revisão/);
  assert.match(getArchiveBlockReason({ status: 'archived', canReview: true })!, /já está arquivado/);
});

test('Salvar como modelo exige rascunho, conteúdo, sem conflito, nome e ciência do aviso', () => {
  const base = { status: 'draft', hasContent: true, conflict: false, name: 'Declaração padrão', acknowledged: true };
  assert.equal(getSaveAsTemplateBlockReason(base), null);
  assert.match(getSaveAsTemplateBlockReason({ ...base, status: 'final' })!, /rascunho/);
  assert.match(getSaveAsTemplateBlockReason({ ...base, conflict: true })!, /conflito/);
  assert.match(getSaveAsTemplateBlockReason({ ...base, hasContent: false })!, /conteúdo/);
  assert.match(getSaveAsTemplateBlockReason({ ...base, name: '   ' })!, /nome/);
  assert.match(getSaveAsTemplateBlockReason({ ...base, acknowledged: false })!, /dados de pessoas/);
  assert.match(SAVE_AS_TEMPLATE_NOTICE, /visível a todos que podem gerar documentos/);
  assert.match(SAVE_AS_TEMPLATE_NOTICE, /nomes, CPFs ou outros dados de pessoas/);
});

test('editável: documento só em rascunho; modelo até ser arquivado (publicado também edita)', () => {
  assert.equal(editableStatusFor('document', 'draft'), 'draft');
  assert.equal(editableStatusFor('document', 'final'), 'final');
  assert.equal(editableStatusFor('template', 'draft'), 'draft');
  assert.equal(editableStatusFor('template', 'published'), 'draft');
  assert.equal(editableStatusFor('template', 'archived'), 'archived');
  assert.equal(hasUnpublishedChanges(view({ status: 'published', currentVersion: 3, publishedVersion: 2 })), true);
  assert.equal(hasUnpublishedChanges(view({ status: 'published', currentVersion: 2, publishedVersion: 2 })), false);
  assert.equal(hasUnpublishedChanges(view({ status: 'archived', currentVersion: 3, publishedVersion: 2 })), false);
});

test('chaves de tentativa: a mesma tentativa reaproveita o id; pedido diferente recebe outro', () => {
  let n = 0;
  const registry = createAttemptRegistry(() => `id-${(n += 1)}`);
  const key = templateUseAttemptKey('tpl_1', 2);
  assert.equal(registry.idFor(key), registry.idFor(key));
  assert.notEqual(registry.idFor(key), registry.idFor(templateUseAttemptKey('tpl_1', 3)));
  assert.notEqual(registry.idFor(key), registry.idFor(templateUseAttemptKey('tpl_2', 2)));
  assert.notEqual(registry.idFor(templatePublishAttemptKey('tpl_1', 2)), registry.idFor(key));
  const first = registry.idFor(key);
  registry.clear(key);
  assert.notEqual(registry.idFor(key), first);
  // Nome ou descrição diferentes (ou versão do documento) não podem reutilizar o id da tentativa anterior.
  const a = templateCreateAttemptKey('ed_1', 4, ' Nome ', 'desc');
  assert.equal(a, templateCreateAttemptKey('ed_1', 4, 'Nome', ' desc '));
  assert.notEqual(a, templateCreateAttemptKey('ed_1', 4, 'Outro', 'desc'));
  assert.notEqual(a, templateCreateAttemptKey('ed_1', 5, 'Nome', 'desc'));
  assert.notEqual(a, templateCreateAttemptKey('ed_2', 4, 'Nome', 'desc'));
});

test('filtros de status e paginação sem repetir modelos', () => {
  assert.deepEqual(TEMPLATE_STATUS_FILTERS.map((f) => f.value), ['published', 'draft', 'archived']);
  const a = view({ id: 'tpl_a' });
  const b = view({ id: 'tpl_b' });
  const c = view({ id: 'tpl_c' });
  assert.deepEqual(appendTemplatePage([a, b], [b, c]).map((i) => i.id), ['tpl_a', 'tpl_b', 'tpl_c']);
  const published = { ...a, status: 'published' as const, publishedVersion: 1 };
  assert.deepEqual(applyTemplateUpdate([a, b], published, null).map((i) => i.status), ['published', 'draft']);
  // Item que deixou de combinar com o filtro sai da lista.
  assert.deepEqual(applyTemplateUpdate([a, b], { ...a, status: 'archived' }, 'draft').map((i) => i.id), ['tpl_b']);
  assert.deepEqual(applyTemplateUpdate([a, b], published, 'published').map((i) => i.id), ['tpl_a', 'tpl_b']);
});

test('falhas dos modelos viram texto público, sem repassar a mensagem do servidor', () => {
  const cases: Array<[number, string, RegExp]> = [
    [403, 'EDITOR_TEMPLATE_FORBIDDEN', /permissão/],
    [404, 'EDITOR_TEMPLATE_NOT_FOUND', /Modelo não encontrado/],
    [400, 'EDITOR_TEMPLATE_INPUT_INVALID', /nome e a descrição/],
    [422, 'EDITOR_TEMPLATE_CONTENT_INVALID', /vazio/],
    [409, 'EDITOR_TEMPLATE_ARCHIVED', /arquivado/],
    [409, 'EDITOR_TEMPLATE_NOT_PUBLISHED', /ainda não foi publicado/],
    [409, 'EDITOR_TEMPLATE_REQUEST_ID_REUSED', /Tente novamente/],
    [409, 'EDITOR_TEMPLATE_VERSION_CONFLICT', /sem perdas/],
    [409, 'EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED', /versão publicada deste modelo mudou/],
    [429, 'EDITOR_RATE_LIMITED', /Muitas solicitações/],
  ];
  for (const [status, code, pattern] of cases) {
    const failure = toEditorFailure(apiError(status, { error: { code, message: 'SEGREDO interno' } }));
    assert.equal(failure.code, code);
    assert.match(failure.message, pattern);
    assert.equal(failure.message.includes('SEGREDO'), false);
  }
  const changed = toEditorFailure(apiError(409, { error: { code: 'EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED' }, publishedVersion: 5 }));
  assert.equal(changed.publishedVersion, 5);
  const conflict = toEditorFailure(apiError(409, { error: { code: 'EDITOR_TEMPLATE_VERSION_CONFLICT' }, currentVersion: 8 }));
  assert.equal(conflict.currentVersion, 8);
  assert.equal(toEditorFailure(new Error('SEGREDO')).publishedVersion, null);
});

test('conflito de versão e recarga da lista são reconhecidos pelo código', () => {
  assert.equal(isVersionConflictCode('EDITOR_VERSION_CONFLICT'), true);
  assert.equal(isVersionConflictCode('EDITOR_TEMPLATE_VERSION_CONFLICT'), true);
  assert.equal(isVersionConflictCode('EDITOR_TEMPLATE_ARCHIVED'), false);
  assert.equal(isVersionConflictCode(null), false);
  for (const code of ['EDITOR_TEMPLATE_PUBLISHED_VERSION_CHANGED', 'EDITOR_TEMPLATE_ARCHIVED', 'EDITOR_TEMPLATE_NOT_PUBLISHED', 'EDITOR_TEMPLATE_NOT_FOUND']) {
    assert.equal(shouldReloadTemplateList({ code }), true, code);
  }
  assert.equal(shouldReloadTemplateList({ code: 'EDITOR_RATE_LIMITED' }), false);
  assert.equal(shouldReloadTemplateList({ code: null }), false);
});

test('o cliente dos modelos usa as rotas pelo cliente autenticado compartilhado', async () => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const request = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url: String(url), init });
    return {};
  }) as unknown as EditorRequest;
  const id = 'tpl_' + 'b'.repeat(32);
  await listEditorTemplates(request);
  await listEditorTemplates(request, { status: 'published', limit: 25, cursor: 'abc_-9' });
  await createEditorTemplate(request, { clientRequestId: 'r1', name: 'N', fromDocument: { documentId: 'ed_x', version: 3 } });
  await openEditorTemplate(request, id);
  await saveEditorTemplate(request, id, { expectedVersion: 1, clientRequestId: 'r2', content: {}, name: 'N' });
  await previewEditorTemplate(request, id);
  await publishEditorTemplate(request, id, { clientRequestId: 'r3', expectedVersion: 2 });
  await archiveEditorTemplate(request, id, { clientRequestId: 'r4', expectedVersion: 2 });
  await createDocumentFromTemplate(request, id, { clientRequestId: 'r5', expectedPublishedVersion: 2 });

  const summary = calls.map((c) => `${c.init.method} ${c.url}`);
  assert.deepEqual(summary, [
    'GET /api/documents/editor/templates',
    'GET /api/documents/editor/templates?status=published&limit=25&cursor=abc_-9',
    'POST /api/documents/editor/templates',
    `GET /api/documents/editor/templates/${id}`,
    `PUT /api/documents/editor/templates/${id}/content`,
    `POST /api/documents/editor/templates/${id}/preview`,
    `POST /api/documents/editor/templates/${id}/publish`,
    `POST /api/documents/editor/templates/${id}/archive`,
    `POST /api/documents/editor/templates/${id}/use`,
  ]);
  assert.deepEqual(calls[2]!.init.json, { clientRequestId: 'r1', name: 'N', fromDocument: { documentId: 'ed_x', version: 3 } });
  assert.equal(calls[5]!.init.responseType, 'blob');
  // A criação nunca envia titular nem dado de pessoa.
  for (const call of calls) assert.equal(JSON.stringify(call.init.json ?? {}).includes('subject'), false);
});
