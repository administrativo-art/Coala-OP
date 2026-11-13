import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthenticatedApiError } from '../../../src/lib/authenticated-api-client';
import {
  createBlankEditorDocument,
  downloadFinalEditorPdf,
  finalizeEditorDocument,
  previewResolvedEditorDocument,
  previewSampleEditorDocument,
  saveEditorDocument,
  toEditorFailure,
  type EditorRequest,
} from '../../../src/features/documents/editor/ui/editor-client';
import {
  AUTOSAVE_DELAY_MS,
  buildPdfFileName,
  collectFieldKeys,
  describeResolvedPreviewFailure,
  filterSubjectOptions,
  finalizeAttemptKey,
  getFinalizeBaseBlockReason,
  isEditorLocked,
  getFinalizeBlockReason,
  groupVariablesBySection,
  hasMeaningfulContent,
  sensitiveFieldKeys,
  shouldAutosave,
} from '../../../src/features/documents/editor/ui/editor-logic';
import { DOCUMENT_VARIABLES } from '../../../src/features/hr/integration/document-variables';

const field = (key: string) => ({ type: 'documentField', attrs: { key } });
const doc = (...content: unknown[]) => ({ type: 'doc', content }) as never;

test('detecta conteúdo real e ignora parágrafos vazios e espaços', () => {
  assert.equal(hasMeaningfulContent(doc({ type: 'paragraph' })), false);
  assert.equal(hasMeaningfulContent(doc({ type: 'paragraph', content: [{ type: 'text', text: '   ' }] })), false);
  assert.equal(hasMeaningfulContent(doc({ type: 'paragraph', content: [{ type: 'text', text: 'Olá' }] })), true);
  assert.equal(hasMeaningfulContent(doc({ type: 'paragraph', content: [field(DOCUMENT_VARIABLES[0]!.key)] })), true);
});

test('coleta chaves de campos sem repetição, inclusive dentro de tabela e lista', () => {
  const [a, b] = [DOCUMENT_VARIABLES[0]!.key, DOCUMENT_VARIABLES[1]!.key];
  const content = doc(
    { type: 'paragraph', content: [field(b), field(a), field(a)] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [field(a)] }] }] }] },
  );
  assert.deepEqual(collectFieldKeys(content), [a, b].sort());
});

test('Finalizar: bloqueios explicam o motivo e só libera documento avulso com conteúdo e permissão', () => {
  const base = { status: 'draft', canReview: true, hasContent: true, fieldKeys: [] as string[], conflict: false };
  assert.equal(getFinalizeBlockReason(base), null);
  assert.match(getFinalizeBlockReason({ ...base, status: 'final' })!, /já foi finalizado/);
  assert.match(getFinalizeBlockReason({ ...base, canReview: false })!, /permissão de revisão/);
  assert.match(getFinalizeBlockReason({ ...base, hasContent: false })!, /conteúdo/);
  assert.match(getFinalizeBlockReason({ ...base, conflict: true })!, /conflito/);
});

test('Finalizar com campos exige titular escolhido e bloqueia titular com campos sem valor', () => {
  const base = { status: 'draft', canReview: true, hasContent: true, fieldKeys: ['employee.name'], conflict: false };
  assert.match(getFinalizeBlockReason(base)!, /Escolha o titular/);
  assert.match(getFinalizeBlockReason({ ...base, subjectEmployeeId: '' })!, /Escolha o titular/);
  assert.equal(getFinalizeBlockReason({ ...base, subjectEmployeeId: 'u1' }), null);
  assert.match(getFinalizeBlockReason({ ...base, subjectEmployeeId: 'u1', subjectHasMissingFields: true })!, /sem valor/);
  // Sem titular a etapa "Preencher e finalizar" já pode ser aberta; as demais regras continuam valendo.
  assert.equal(getFinalizeBaseBlockReason(base), null);
  assert.match(getFinalizeBaseBlockReason({ ...base, canReview: false })!, /permissão de revisão/);
  // Titular escolhido não libera documento sem conteúdo nem em conflito.
  assert.match(getFinalizeBlockReason({ ...base, hasContent: false, subjectEmployeeId: 'u1' })!, /conteúdo/);
  assert.match(getFinalizeBlockReason({ ...base, conflict: true, subjectEmployeeId: 'u1' })!, /conflito/);
});

test('seletor de titular filtra sem acento, ordena em pt-BR e a tentativa de finalizar muda com o titular', () => {
  const users = [{ id: '3', username: 'Zélia' }, { id: '1', username: 'Álvaro Souza' }, { id: '2', username: 'Bruno' }];
  assert.deepEqual(filterSubjectOptions(users, '').map((u) => u.id), ['1', '2', '3']);
  assert.deepEqual(filterSubjectOptions(users, 'alvaro').map((u) => u.id), ['1']);
  assert.deepEqual(filterSubjectOptions(users, 'zzz'), []);
  assert.notEqual(finalizeAttemptKey(2, 'u1'), finalizeAttemptKey(2, 'u2'));
  assert.notEqual(finalizeAttemptKey(2, 'u1'), finalizeAttemptKey(3, 'u1'));
  assert.equal(finalizeAttemptKey(2, 'u1'), finalizeAttemptKey(2, 'u1'));
  assert.notEqual(finalizeAttemptKey(2, null), finalizeAttemptKey(2, 'u1'));
});

test('falhas da prévia com dados reais viram texto público, com rótulos dos campos sem valor', () => {
  const key = DOCUMENT_VARIABLES[0]!.key;
  const missing = toEditorFailure(apiError(422, { error: { code: 'EDITOR_MISSING_FIELDS', message: 'SEGREDO interno' }, missingKeys: [key] }));
  const text = describeResolvedPreviewFailure(missing);
  assert.ok(text.includes(`Campos sem valor: ${DOCUMENT_VARIABLES[0]!.label}.`));
  assert.equal(text.includes('SEGREDO'), false);
  const cases: Array<[number, string, RegExp]> = [
    [403, 'EDITOR_SENSITIVE_FIELD_FORBIDDEN', /dados sensíveis/],
    [409, 'EDITOR_SUBJECT_UNCONFIRMED', /confirmar o titular/],
    [429, 'EDITOR_RATE_LIMITED', /Muitas solicitações/],
    [503, 'EDITOR_PDF_BUSY', /muitas conversões/i],
  ];
  for (const [status, code, pattern] of cases) {
    const message = describeResolvedPreviewFailure(toEditorFailure(apiError(status, { error: { code, message: 'SEGREDO interno' } })));
    assert.match(message, pattern);
    assert.equal(message.includes('SEGREDO'), false);
  }
});

test('autosave só com rascunho alterado, sem conflito e pelo menos 30 s', () => {
  assert.ok(AUTOSAVE_DELAY_MS >= 30_000);
  const ok = { status: 'draft', saveState: 'dirty' as const, conflict: false, canEdit: true };
  assert.equal(shouldAutosave(ok), true);
  assert.equal(shouldAutosave({ ...ok, saveState: 'saved' }), false);
  assert.equal(shouldAutosave({ ...ok, saveState: 'saving' }), false);
  assert.equal(shouldAutosave({ ...ok, saveState: 'error' }), false);
  assert.equal(shouldAutosave({ ...ok, conflict: true }), false);
  assert.equal(shouldAutosave({ ...ok, status: 'final' }), false);
  assert.equal(shouldAutosave({ ...ok, canEdit: false }), false);
});

test('painel de campos agrupa por seção, busca sem acento e destaca sensíveis', () => {
  const all = groupVariablesBySection(DOCUMENT_VARIABLES, '');
  assert.equal(all.reduce((n, s) => n + s.items.length, 0), DOCUMENT_VARIABLES.length);
  assert.equal(new Set(all.map((s) => s.section)).size, all.length);
  const sample = DOCUMENT_VARIABLES.find((v) => /[áéíóúãõç]/i.test(v.label))!;
  const plain = sample.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const found = groupVariablesBySection(DOCUMENT_VARIABLES, plain).flatMap((s) => s.items);
  assert.ok(found.some((v) => v.key === sample.key));
  assert.deepEqual(groupVariablesBySection(DOCUMENT_VARIABLES, 'zzzz-inexistente'), []);
  const sensitive = DOCUMENT_VARIABLES.find((v) => v.sensitive);
  if (sensitive) assert.deepEqual(sensitiveFieldKeys([sensitive.key, 'x']), [sensitive.key]);
});

const apiError = (status: number, payload: unknown) => new AuthenticatedApiError('mensagem bruta do servidor', status, payload);

test('erros viram texto público e nunca repassam a mensagem bruta', () => {
  const cases: Array<[unknown, RegExp]> = [
    [apiError(503, { error: { code: 'EDITOR_PDF_UNAVAILABLE', message: 'SEGREDO interno' } }), /indisponível/],
    [apiError(503, { error: { code: 'EDITOR_PDF_BUSY', message: 'SEGREDO interno' } }), /muitas conversões/i],
    [apiError(429, { error: { code: 'EDITOR_RATE_LIMITED', message: 'SEGREDO interno' } }), /Muitas solicitações/],
    [apiError(429, 'texto cru'), /Muitas solicitações/],
    [apiError(403, { error: 'SEGREDO interno' }), /permissão/],
    [apiError(500, { error: { code: 'UNEXPECTED_ERROR', message: 'SEGREDO interno' } }), /Tente novamente/],
    [new TypeError('Failed to fetch SEGREDO'), /conexão/],
  ];
  for (const [error, pattern] of cases) {
    const failure = toEditorFailure(error);
    assert.match(failure.message, pattern);
    assert.equal(failure.message.includes('SEGREDO'), false);
    assert.equal(failure.message.includes('mensagem bruta'), false);
  }
});

test('conflito de versão preserva currentVersion e campos ausentes viram rótulos do catálogo', () => {
  const conflict = toEditorFailure(apiError(409, { error: { code: 'EDITOR_VERSION_CONFLICT' }, currentVersion: 7 }));
  assert.equal(conflict.code, 'EDITOR_VERSION_CONFLICT');
  assert.equal(conflict.currentVersion, 7);
  assert.match(conflict.message, /sem perdas/);
  const key = DOCUMENT_VARIABLES[0]!.key;
  const missing = toEditorFailure(apiError(422, { error: { code: 'EDITOR_MISSING_FIELDS' }, missingKeys: [key, 'nao.existe'] }));
  assert.deepEqual(missing.missingLabels, [DOCUMENT_VARIABLES[0]!.label, 'Campo desconhecido']);
});

test('o cliente usa as rotas do editor pelo cliente autenticado compartilhado', async () => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const request = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url: String(url), init });
    return {};
  }) as unknown as EditorRequest;
  await createBlankEditorDocument(request, { clientRequestId: 'r1', title: 'T' });
  await saveEditorDocument(request, 'ed_abc', { expectedContentVersion: 1, clientRequestId: 'r2', content: {}, title: 'T' });
  await previewSampleEditorDocument(request, 'ed_abc');
  await finalizeEditorDocument(request, 'ed_abc', { clientRequestId: 'r3', expectedContentVersion: 2 });
  await previewResolvedEditorDocument(request, 'ed_abc', { employeeId: 'u1' });
  await finalizeEditorDocument(request, 'ed_abc', { clientRequestId: 'r4', expectedContentVersion: 2, subject: { employeeId: 'u1' } });
  assert.deepEqual(calls.map((c) => [c.init.method, c.url]), [
    ['POST', '/api/documents/editor'],
    ['PUT', '/api/documents/editor/ed_abc/content'],
    ['POST', '/api/documents/editor/ed_abc/preview'],
    ['POST', '/api/documents/editor/ed_abc/finalize'],
    ['POST', '/api/documents/editor/ed_abc/preview'],
    ['POST', '/api/documents/editor/ed_abc/finalize'],
  ]);
  assert.deepEqual(calls[2]!.init.json, { mode: 'sample' });
  assert.equal(calls[2]!.init.responseType, 'blob');
  assert.deepEqual(calls[3]!.init.json, { clientRequestId: 'r3', expectedContentVersion: 2 });
  assert.deepEqual(calls[4]!.init.json, { mode: 'resolved', subject: { employeeId: 'u1' } });
  assert.equal(calls[4]!.init.responseType, 'blob');
  assert.deepEqual(calls[5]!.init.json, { clientRequestId: 'r4', expectedContentVersion: 2, subject: { employeeId: 'u1' } });
});

test('o editor fica bloqueado durante prévia e finalização e volta a editar quando a operação termina em falha', () => {
  const base = { status: 'draft', contentError: false, previewBusy: false, finalizing: false };
  assert.equal(isEditorLocked(base), false);
  assert.equal(isEditorLocked({ ...base, finalizing: true }), true);
  assert.equal(isEditorLocked({ ...base, previewBusy: true }), true);
  assert.equal(isEditorLocked({ ...base, status: 'final' }), true);
  assert.equal(isEditorLocked({ ...base, contentError: true }), true);
});

test('o nome do PDF baixado é ASCII seguro', () => {
  assert.equal(buildPdfFileName('Declaração de Vínculo'), 'Declaracao-de-Vinculo.pdf');
  assert.equal(buildPdfFileName('../../etc/passwd"'), 'etc-passwd.pdf');
  assert.equal(buildPdfFileName('   '), 'documento.pdf');
});

test('download do PDF final usa GET blob e os novos códigos viram texto público', async () => {
  const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
  const request = (async (url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    return new Blob(['%PDF']);
  }) as never;
  await downloadFinalEditorPdf(request, 'ed_x');
  assert.equal(calls[0]!.url, '/api/documents/editor/ed_x/file');
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal(calls[0]!.init.responseType, 'blob');
  const cases: Array<[number, string, RegExp]> = [
    [409, 'EDITOR_DOCUMENT_NOT_FINAL', /ainda não foi finalizado/],
    [404, 'EDITOR_PDF_NOT_AVAILABLE', /não está disponível/],
    [503, 'EDITOR_STORAGE_UNAVAILABLE', /armazenamento/],
    [429, 'EDITOR_RATE_LIMITED', /Muitas solicitações/],
  ];
  for (const [status, code, pattern] of cases) {
    const failure = toEditorFailure(apiError(status, { error: { code, message: 'SEGREDO interno' } }));
    assert.match(failure.message, pattern);
    assert.equal(failure.message.includes('SEGREDO'), false);
  }
});
