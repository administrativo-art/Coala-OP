import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthenticatedApiError } from '../../../src/lib/authenticated-api-client';
import {
  listEditorDocuments,
  saveEditorTemplate,
  toEditorFailure,
  type EditorDocumentListItem,
  type EditorRequest,
} from '../../../src/features/documents/editor/ui/editor-client';
import {
  DEFAULT_DOCUMENT_FILTER,
  DOCUMENT_LIST_FILTERS,
  appendDocumentPage,
  describeDocumentListFailure,
  documentOriginLabel,
  documentStatusLabel,
  documentStatusParam,
  documentVersionLabel,
} from '../../../src/features/documents/editor/ui/document-list-logic';
import {
  TEMPLATE_DESCRIPTION_MAX,
  buildTemplateSaveBody,
  describeDescriptionCounter,
  formatEditorDateTime,
  getTemplateMetaBlockReason,
  isTemplateMetaEditable,
  templateSaveFingerprint,
  versionAfterTemplateSave,
} from '../../../src/features/documents/editor/ui/template-logic';

const item = (id: string, overrides: Partial<EditorDocumentListItem> = {}): EditorDocumentListItem => ({
  id,
  title: `Documento ${id}`,
  status: 'draft',
  contentVersion: 1,
  updatedAt: '2026-11-05T15:30:00.000Z',
  origin: { kind: 'editor' },
  isOwn: true,
  ...overrides,
});

test('data: DD/MM/AAAA, HH:mm no fuso pedido; nulo, vazio e inválido viram travessão', () => {
  assert.equal(formatEditorDateTime('2026-11-05T15:30:00.000Z', 'America/Sao_Paulo'), '05/11/2026, 12:30');
  assert.equal(formatEditorDateTime('2026-01-02T03:04:00.000Z', 'UTC'), '02/01/2026, 03:04');
  assert.equal(formatEditorDateTime(null), '—');
  assert.equal(formatEditorDateTime(undefined), '—');
  assert.equal(formatEditorDateTime(''), '—');
  assert.equal(formatEditorDateTime('não é data'), '—');
  // ISO nunca aparece no texto
  assert.doesNotMatch(formatEditorDateTime('2026-11-05T15:30:00.000Z', 'UTC'), /\d{4}-\d{2}-\d{2}|T\d{2}:/);
});

test('descrição: contador, limite de 1000 e bloqueio de nome vazio', () => {
  assert.equal(TEMPLATE_DESCRIPTION_MAX, 1000);
  assert.deepEqual(describeDescriptionCounter(''), { text: '0/1000', over: false, nearLimit: false });
  assert.equal(describeDescriptionCounter('a'.repeat(900)).nearLimit, true);
  assert.equal(describeDescriptionCounter('a'.repeat(1000)).over, false);
  assert.equal(describeDescriptionCounter('a'.repeat(1001)).over, true);
  assert.equal(getTemplateMetaBlockReason({ name: 'Modelo', description: 'a'.repeat(1000) }), null);
  assert.match(getTemplateMetaBlockReason({ name: '   ', description: '' })!, /nome/);
  assert.match(getTemplateMetaBlockReason({ name: 'Modelo', description: 'a'.repeat(1001) })!, /1000/);
  // espaços nas pontas não contam: o servidor apara
  assert.equal(getTemplateMetaBlockReason({ name: 'Modelo', description: `  ${'a'.repeat(1000)}  ` }), null);
});

test('metadados do modelo: arquivado ou bloqueado fica somente leitura', () => {
  assert.equal(isTemplateMetaEditable({ status: 'draft', locked: false }), true);
  assert.equal(isTemplateMetaEditable({ status: 'published', locked: false }), true);
  assert.equal(isTemplateMetaEditable({ status: 'archived', locked: false }), false);
  assert.equal(isTemplateMetaEditable({ status: 'draft', locked: true }), false);
});

test('corpo do PUT: nome e descrição aparados; descrição vazia vai como vazia (limpa)', () => {
  const body = buildTemplateSaveBody({ expectedVersion: 3, clientRequestId: 'r1', content: { type: 'doc' }, name: '  Declaração ', description: '  uso geral ' });
  assert.deepEqual(body, { expectedVersion: 3, clientRequestId: 'r1', content: { type: 'doc' }, name: 'Declaração', description: 'uso geral' });
  assert.equal(buildTemplateSaveBody({ expectedVersion: 1, clientRequestId: 'r', content: {}, name: 'N', description: '   ' }).description, '');
});

test('tentativa: a impressão digital muda com nome, descrição, versão e conteúdo', () => {
  const base = { content: { a: 1 }, name: 'N', description: 'D', version: 1 };
  const same = templateSaveFingerprint({ ...base, name: ' N ', description: ' D ' });
  assert.equal(templateSaveFingerprint(base), same);
  assert.notEqual(templateSaveFingerprint({ ...base, description: 'E' }), same);
  assert.notEqual(templateSaveFingerprint({ ...base, name: 'M' }), same);
  assert.notEqual(templateSaveFingerprint({ ...base, version: 2 }), same);
  assert.notEqual(templateSaveFingerprint({ ...base, content: { a: 2 } }), same);
});

test('versão após salvar vem do servidor: só metadados não avançam', () => {
  assert.deepEqual(versionAfterTemplateSave(2, { currentVersion: 2 }), { version: 2, advanced: false });
  assert.deepEqual(versionAfterTemplateSave(2, { currentVersion: 3 }), { version: 3, advanced: true });
});

test('saveEditorTemplate envia description no PUT /content', async () => {
  const calls: Array<{ url: string; init: unknown }> = [];
  const request = (async (url: string, init: unknown) => {
    calls.push({ url, init });
    return { template: {} };
  }) as unknown as EditorRequest;
  await saveEditorTemplate(request, 'tpl_x', { expectedVersion: 1, clientRequestId: 'r', content: {}, name: 'N', description: 'D' });
  assert.match(calls[0].url, /\/templates\/tpl_x\/content$/);
  const init = calls[0].init as { method: string; json: Record<string, unknown> };
  assert.equal(init.method, 'PUT');
  assert.equal(init.json.description, 'D');
});

test('filtros da listagem: Todos não envia status; Rascunhos e Finalizados enviam', () => {
  assert.equal(DEFAULT_DOCUMENT_FILTER, 'all');
  assert.deepEqual(DOCUMENT_LIST_FILTERS.map((f) => f.label), ['Todos', 'Rascunhos', 'Finalizados']);
  assert.equal(documentStatusParam('all'), undefined);
  assert.equal(documentStatusParam('draft'), 'draft');
  assert.equal(documentStatusParam('final'), 'final');
});

test('listEditorDocuments monta a consulta com status, limite e cursor', async () => {
  const urls: string[] = [];
  const request = (async (url: string) => {
    urls.push(url);
    return { items: [], nextCursor: null };
  }) as unknown as EditorRequest;
  await listEditorDocuments(request, {});
  await listEditorDocuments(request, { status: 'final', limit: 25, cursor: 'abc_-9' });
  await listEditorDocuments(request, { status: 'draft', cursor: null });
  assert.equal(urls[0], '/api/documents/editor');
  assert.equal(urls[1], '/api/documents/editor?status=final&limit=25&cursor=abc_-9');
  assert.equal(urls[2], '/api/documents/editor?status=draft');
});

test('paginação: acrescenta a página sem repetir itens', () => {
  const merged = appendDocumentPage([item('a'), item('b')], [item('b'), item('c')]);
  assert.deepEqual(merged.map((i) => i.id), ['a', 'b', 'c']);
});

test('linha: origem, situação e versão em texto público', () => {
  assert.equal(documentOriginLabel({ kind: 'editor' }), 'Em branco');
  assert.equal(documentOriginLabel({ kind: 'editor_template', templateId: 'tpl_x', templateVersion: 2 }), 'Do modelo');
  assert.equal(documentOriginLabel(null), 'Origem não informada');
  assert.equal(documentStatusLabel('draft'), 'Rascunho');
  assert.equal(documentStatusLabel('final'), 'Finalizado');
  assert.equal(documentVersionLabel({ contentVersion: 4 }), 'Versão 4');
});

test('falhas da listagem: 403 vira sem permissão; demais usam texto público, nunca a mensagem do servidor', () => {
  const forbidden = describeDocumentListFailure(toEditorFailure(new AuthenticatedApiError('segredo interno', 403, { error: { code: 'EDITOR_DOCUMENT_FORBIDDEN' } })));
  assert.equal(forbidden.kind, 'forbidden');
  assert.doesNotMatch(forbidden.message, /segredo/);
  const rate = describeDocumentListFailure(toEditorFailure(new AuthenticatedApiError('segredo interno', 429, {})));
  assert.equal(rate.kind, 'error');
  assert.doesNotMatch(rate.message, /segredo/);
  const server = describeDocumentListFailure(toEditorFailure(new AuthenticatedApiError('stack trace', 500, { message: 'stack trace' })));
  assert.equal(server.kind, 'error');
  assert.doesNotMatch(server.message, /stack/);
  const network = describeDocumentListFailure(toEditorFailure(new Error('ECONNRESET')));
  assert.equal(network.kind, 'error');
  assert.doesNotMatch(network.message, /ECONNRESET/);
});
