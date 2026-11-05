import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';

import {
  assertEditorAccess,
  createDraft,
  downloadFinalPdf,
  safeFileName,
  finalizeDocument,
  openDocument,
  renderPreview,
  resetEditorRateLimitersForTests,
  EDITOR_RATE_LIMITS,
  saveContent,
  type EditorActor,
  type EditorApiDeps,
} from '../../../src/features/documents/editor/editor-api.server';
import { createEditorEnforcer } from '../../../src/features/documents/editor/editor-route-security.server';
import {
  createEditorBodySchema,
  finalizeEditorBodySchema,
  previewEditorBodySchema,
  saveEditorBodySchema,
} from '../../../src/features/documents/editor/editor-api-schemas';
import { getEditorDocument } from '../../../src/features/documents/editor/document-store.server';
import { toErrorResponse } from '../../../src/lib/observability/api-error';
import { AppError } from '../../../src/lib/observability/app-error';
import { defineSecurityContract } from '../../../src/lib/security/route-contract';

/** Fake mínimo do Firestore Admin (mapa por caminho). NÃO prova comportamento do emulador. */
function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const mkRef = (path: string): any => ({
    id: path.split('/').pop(), path,
    async get() { const d = store.get(path); return { exists: d !== undefined, data: () => d }; },
    collection: (name: string) => ({ doc: (id: string) => mkRef(`${path}/${name}/${id}`) }),
  });
  return {
    store,
    db: {
      collection: (name: string) => ({ doc: (id = 'auto') => mkRef(`${name}/${id}`) }),
      async runTransaction<T>(fn: (tx: any) => Promise<T>) {
        const pending: Array<[string, Record<string, unknown>, string]> = [];
        const tx = {
          get: (ref: any) => ref.get(),
          set: (ref: any, d: any) => pending.push([ref.path, d, 'set']),
          create: (ref: any, d: any) => pending.push([ref.path, d, 'create']),
          update: (ref: any, d: any) => pending.push([ref.path, d, 'update']),
        };
        const result = await fn(tx);
        for (const [path, d, kind] of pending) {
          if (kind === 'create' && store.has(path)) throw new Error('ALREADY_EXISTS');
          store.set(path, kind === 'update' ? { ...store.get(path), ...d } : d);
        }
        return result;
      },
    },
  };
}

const perms = (o: { generate?: boolean; review?: boolean; sensitive?: boolean }): any => ({
  hr: { formalization: { view: false, documents: { view: false, generate: !!o.generate, review: !!o.review }, sensitiveData: { view: !!o.sensitive } } },
});
const actor = (uid: string, o: { generate?: boolean; review?: boolean; sensitive?: boolean } = { generate: true }, ws = 'w1'): EditorActor =>
  ({ decoded: { uid } as any, userDoc: { id: uid } as any, isDefaultAdmin: false, workspace_id: ws, permissions: perms(o) });

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const withField = (key: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentField', attrs: { key } }] }] });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(over: Partial<EditorApiDeps> = {}) {
  const f = fakeDb();
  const objects = new Map<string, Buffer>();
  const calls = { convert: 0, scopes: 0, resolve: 0, confirm: 0, savePdf: [] as string[], readPdf: [] as string[], deletePdf: [] as string[], sample: 0, resolvedStamp: 0 };
  const deps: EditorApiDeps = {
    store: { db: f.db as any, now: () => new Date('2026-11-05T10:00:00Z') },
    convertHtmlToPdf: async () => { calls.convert++; return { ok: true, pdf: Buffer.from('%PDF-fake') }; },
    applyLetterhead: async (b) => b,
    stampSamplePreview: async (b) => { calls.sample++; return b; },
    stampResolvedPreview: async (b) => { calls.resolvedStamp++; return b; },
    assertPersonScopes: async () => { calls.scopes++; },
    resolveRawValues: async () => { calls.resolve++; return { 'employee.name': 'Fulana de Tal' }; },
    confirmSubjectKeys: async () => { calls.confirm++; return ['hr.employees:emp1', 'main.users:u1']; },
    savePdf: async (p, b) => { calls.savePdf.push(p); objects.set(p, b); },
    deletePdf: async (p) => { calls.deletePdf.push(p); },
    readPdf: async (p) => { calls.readPdf.push(p); return objects.get(p) ?? Promise.reject(new Error('gs://bucket/segredo/caminho nao existe')); },
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
    ...over,
  };
  return { ...f, deps, calls, objects };
}
const draft = async (s: ReturnType<typeof setup>, owner = actor('author'), content: unknown = text('Olá'), n = 1) =>
  createDraft({ clientRequestId: uuid(n), title: 'Carta', content }, owner, s.deps);
const publicError = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as AppError; } return null; };

// ------------------------------------------------------------ autorização

test('assertEditorAccess: generate obrigatório; autor ou revisor; finalizar exige revisão', async () => {
  const s = setup();
  const view = await draft(s);
  const rec = await getEditorDocument(view.id, 'w1', s.deps.store);
  assert.throws(() => assertEditorAccess(actor('author', { review: true }), rec, 'view'), /permissão/);
  assert.doesNotThrow(() => assertEditorAccess(actor('author'), rec, 'edit'));
  assert.doesNotThrow(() => assertEditorAccess(actor('other', { generate: true, review: true }), rec, 'edit'));
  assert.throws(() => assertEditorAccess(actor('other'), rec, 'edit'), /permissão/);
  assert.throws(() => assertEditorAccess(actor('author'), rec, 'finalize'), /permissão/);
  assert.doesNotThrow(() => assertEditorAccess(actor('author', { generate: true, review: true }), rec, 'finalize'));
  assert.throws(() => assertEditorAccess(actor('x', { generate: true, review: true }, 'w2'), rec, 'view'));
});

function enforcerFor(s: ReturnType<typeof setup>, who: EditorActor, action: 'view' | 'edit' | 'finalize' | 'create', bodySchema: any, method = 'GET') {
  const path = action === 'create' ? '/api/documents/editor' : '/api/documents/editor/[id]';
  const contract = defineSecurityContract({
    schemaVersion: 1, id: 'documents.editor.test', version: 1, surface: { method: method as any, path: path as any },
    exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'editor-test' },
    resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'documents.editor.test', unknownFields: 'reject' },
    effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  });
  const enforcer = createEditorEnforcer(contract, { action, bodySchema, authenticate: async () => who, getDeps: async () => s.deps });
  return (id: string, body?: unknown, raw?: string) => enforcer.enforce({
    request: new NextRequest('http://localhost/api/documents/editor/x', { method, ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body) } : {}) }),
    routeContext: { params: Promise.resolve({ id }) }, observation: { requestId: 'r' }, contract,
  });
}

test('enforcer: sem generate => 403 sem ler documento; não-autor sem review => 403; autor e revisor passam', async () => {
  const s = setup();
  const { id } = await draft(s);
  assert.equal((await publicError(enforcerFor(s, actor('author', {}), 'view', null)(id)))?.httpStatus, 403);
  assert.equal((await publicError(enforcerFor(s, actor('other'), 'view', null)(id)))?.httpStatus, 403);
  assert.equal((await enforcerFor(s, actor('author'), 'view', null)(id)).resource.document?.id, id);
  assert.equal((await enforcerFor(s, actor('rev', { generate: true, review: true }), 'edit', null)(id)).resource.document?.id, id);
  assert.equal((await publicError(enforcerFor(s, actor('author'), 'finalize', null)(id)))?.httpStatus, 403);
});

test('enforcer: workspace diferente => 404; id malformado => 400', async () => {
  const s = setup();
  const { id } = await draft(s);
  const other = actor('author', { generate: true, review: true }, 'w2');
  assert.equal((await publicError(enforcerFor(s, other, 'view', null)(id)))?.httpStatus, 404);
  assert.equal((await publicError(enforcerFor(s, actor('author'), 'view', null)('../x')))?.httpStatus, 400);
});

test('enforcer: entrada inválida/estranha => 400 sem eco do valor', async () => {
  const s = setup();
  const { id } = await draft(s);
  const run = enforcerFor(s, actor('author'), 'edit', saveEditorBodySchema, 'PUT');
  const secret = 'SEGREDO-NAO-ECOAR-123';
  const bodies: Array<[unknown?, string?]> = [
    [{ expectedContentVersion: 1, clientRequestId: uuid(2), content: text('x'), extra: secret }],
    [{ expectedContentVersion: secret, clientRequestId: uuid(2), content: text('x') }],
    [undefined, `{"expectedContentVersion":1,${secret}`],
    [undefined, 'não é json'],
  ];
  for (const [body, raw] of bodies) {
    const err = await publicError(run(id, body, raw));
    assert.equal(err?.httpStatus, 400);
    assert.ok(!JSON.stringify({ m: err?.safeMessage, c: err?.code }).includes(secret));
  }
  const big = await publicError(run(id, undefined, 'x'.repeat(600 * 1024)));
  assert.equal(big?.httpStatus, 413);
});

test('schemas: strict; preview sample sem titular, resolved exige titular', () => {
  assert.ok(!createEditorBodySchema.safeParse({ clientRequestId: uuid(1), title: 'a', x: 1 }).success);
  assert.ok(!finalizeEditorBodySchema.safeParse({ clientRequestId: 'nao-uuid', expectedContentVersion: 1 }).success);
  assert.ok(!previewEditorBodySchema.safeParse({ mode: 'sample', subject: { employeeId: 'e' } }).success);
  assert.ok(!previewEditorBodySchema.safeParse({ mode: 'resolved' }).success);
  assert.ok(previewEditorBodySchema.safeParse({ mode: 'resolved', subject: { employeeId: 'e' } }).success);
  assert.ok(!previewEditorBodySchema.safeParse({ mode: 'resolved', subject: { employeeId: 'a/b' } }).success);
});

// ------------------------------------------------------------ criar / abrir / salvar

test('criar: idempotente por clientRequestId; reuso com outro conteúdo => 409', async () => {
  const s = setup();
  const a = await draft(s);
  const b = await draft(s);
  assert.equal(a.id, b.id);
  const err = await publicError(createDraft({ clientRequestId: uuid(1), title: 'Outro' }, actor('author'), s.deps));
  assert.equal(err?.httpStatus, 409);
  assert.equal((await publicError(createDraft({ clientRequestId: uuid(9), title: 'x', content: { type: 'script' } }, actor('author'), s.deps)))?.httpStatus, 400);
});

test('abrir devolve conteúdo da versão atual sem escrever', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), text('Corpo'));
  const before = new Map(s.store);
  const opened = await openDocument(id, actor('author'), s.deps);
  assert.equal(opened.version, 1);
  assert.deepEqual(opened.content, text('Corpo'));
  assert.deepEqual([...s.store.keys()], [...before.keys()]);
  assert.ok(!('pdfStoragePath' in opened.document));
});

test('salvar: autor e revisor editam; conflito => versão atual; retry idempotente', async () => {
  const s = setup();
  const { id } = await draft(s);
  const r1 = await saveContent({ documentId: id, clientRequestId: uuid(2), expectedContentVersion: 1, content: text('v2') }, actor('author'), s.deps);
  assert.equal(r1.kind === 'saved' && r1.document.contentVersion, 2);
  const retry = await saveContent({ documentId: id, clientRequestId: uuid(2), expectedContentVersion: 1, content: text('v2') }, actor('author'), s.deps);
  assert.equal(retry.kind === 'saved' && retry.document.contentVersion, 2);
  const r3 = await saveContent({ documentId: id, clientRequestId: uuid(3), expectedContentVersion: 2, content: text('rev') }, actor('rev', { generate: true, review: true }), s.deps);
  assert.equal(r3.kind === 'saved' && r3.document.contentVersion, 3);
  const stale = await saveContent({ documentId: id, clientRequestId: uuid(4), expectedContentVersion: 1, content: text('velho') }, actor('author'), s.deps);
  assert.deepEqual(stale, { kind: 'conflict', currentVersion: 3 });
  assert.equal((await publicError(saveContent({ documentId: id, clientRequestId: uuid(5), expectedContentVersion: 3, content: { type: 'x' } }, actor('author'), s.deps)))?.httpStatus, 400);
});

// ------------------------------------------------------------ prévia

test('prévia sample não toca PII (sem escopo, resolvedor nem titular) e aplica carimbo de exemplo', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), withField('employee.name'));
  const out = await renderPreview({ documentId: id, mode: 'sample' }, actor('author'), s.deps);
  assert.equal(out.kind, 'pdf');
  assert.ok(![...s.store.keys()].some((k) => k.includes('preview_resolved')), 'sample não audita');
  assert.deepEqual([s.calls.scopes, s.calls.resolve, s.calls.confirm, s.calls.sample, s.calls.resolvedStamp], [0, 0, 0, 1, 0]);
});

test('prévia resolved: confere escopo, bloqueia campo sensível sem permissão e lista missingKeys', async () => {
  const s = setup();
  const sens = await draft(s, actor('author'), withField('employee.cpf'), 1);
  const denied = await publicError(renderPreview({ documentId: sens.id, mode: 'resolved', employeeId: 'emp1' }, actor('author'), s.deps));
  assert.equal(denied?.httpStatus, 403);
  assert.equal(s.calls.resolve, 0);

  const miss = await draft(s, actor('author'), withField('employee.city'), 2);
  const blocked = await renderPreview({ documentId: miss.id, mode: 'resolved', employeeId: 'emp1' }, actor('author'), s.deps);
  assert.deepEqual(blocked, { kind: 'missing_fields', missingKeys: ['employee.city'] });
  assert.equal(s.calls.convert, 0);
  assert.equal(s.calls.scopes, 1);

  const ok = await draft(s, actor('author'), withField('employee.name'), 3);
  const pdf = await renderPreview({ documentId: ok.id, mode: 'resolved', employeeId: 'emp1' }, actor('author'), s.deps);
  assert.equal(pdf.kind, 'pdf');
  assert.equal(s.calls.resolvedStamp, 1);

  const events = [...s.store.keys()].filter((k) => k.includes('/audit/editor-preview_resolved-v1-'));
  assert.equal(events.length, 2, 'uma auditoria por prévia que leu dados pessoais (missing_fields e pdf), nenhuma para sample/negadas');
  const ev = s.store.get(events[0])!;
  assert.equal(ev.actorId, 'author');
  assert.deepEqual(ev.subjectKeys, ['hr.employees:emp1', 'main.users:u1']);
  assert.ok(!JSON.stringify(ev).includes('Fulana'));

  const scopeFail = setup({ assertPersonScopes: async () => { throw new AppError({ code: 'DOCUMENT_PERSON_SCOPE_FORBIDDEN', kind: 'AUTHORIZATION' }); } });
  const d = await draft(scopeFail, actor('author'), withField('employee.name'));
  assert.equal((await publicError(renderPreview({ documentId: d.id, mode: 'resolved', employeeId: 'emp9' }, actor('author'), scopeFail.deps)))?.httpStatus, 403);
  assert.equal(scopeFail.calls.resolve, 0);
});

test('conversor indisponível => 503 público fixo, sem vazar causa; rascunho segue salvável', async () => {
  const leak = 'https://gotenberg.internal/secret?token=abc123';
  const s = setup({ convertHtmlToPdf: async () => ({ ok: false, reason: 'upstream_error' }) });
  const { id } = await draft(s);
  const err = await publicError(renderPreview({ documentId: id, mode: 'sample' }, actor('author'), s.deps));
  assert.equal(err?.httpStatus, 503);
  const response = toErrorResponse(new AppError({ code: 'X_Y_Z', kind: 'TRANSIENT_EXTERNAL', cause: new Error(leak) }), 'req', undefined, { source: 't', operation: 't', routeOrJob: 't', sink: { write() {} } });
  const body = JSON.stringify(await response.json());
  assert.ok(!body.includes('token') && !body.includes('gotenberg'));
  const errBody = JSON.stringify(await toErrorResponse(err!, 'req', undefined, { source: 't', operation: 't', routeOrJob: 't', sink: { write() {} } }).json());
  assert.ok(!errBody.includes('upstream_error'));
  const saved = await saveContent({ documentId: id, clientRequestId: uuid(2), expectedContentVersion: 1, content: text('ainda salva') }, actor('author'), s.deps);
  assert.equal(saved.kind, 'saved');
});

// ------------------------------------------------------------ finalizar

test('finalizar com campos sem titular => bloqueado e nada gravado', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), withField('employee.name'));
  const err = await publicError(finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1 }, actor('r', { generate: true, review: true }), s.deps));
  assert.equal(err?.code, 'EDITOR_SUBJECT_REQUIRED');
  assert.deepEqual(s.calls.savePdf, []);
});

test('finalizar com campo ausente => missingKeys e nada gravado', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), withField('employee.city'));
  const out = await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1, employeeId: 'emp1' }, actor('r', { generate: true, review: true }), s.deps);
  assert.deepEqual(out, { kind: 'missing_fields', missingKeys: ['employee.city'] });
  assert.deepEqual(s.calls.savePdf, []);
});

test('finalizar avulso sem campos: grava PDF, marca final, idempotente e bloqueia edição posterior', async () => {
  const s = setup();
  const { id } = await draft(s);
  const rev = actor('r', { generate: true, review: true });
  const out = await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1 }, rev, s.deps);
  assert.ok(out.kind === 'final' && out.document.status === 'final' && out.document.pdfAvailable && !out.replayed);
  assert.equal(s.calls.savePdf.length, 1);
  assert.match(s.calls.savePdf[0], /^generated-documents\/standalone\/ed_[0-9a-f]{32}\/[0-9a-f]{64}\.pdf$/);
  const stored = s.store.get(`editorDocuments/${id}`)!;
  assert.equal(stored.status, 'final');
  assert.equal(stored.pdfGenerationStatus, 'ready');
  assert.equal(stored.pdfContentHash, s.calls.savePdf[0].split('/').pop()!.replace('.pdf', ''));
  assert.equal(stored.retentionPolicyId, 'fiscal_generation_date_pending');
  assert.ok(!('signatureScope' in stored));
  const fin = s.store.get(`editorDocuments/${id}/audit/editor-finalized-v1`)!;
  assert.equal(fin.pdfContentHash, stored.pdfContentHash);
  assert.deepEqual(fin.subjectKeys, []);
  assert.ok(s.store.has(`editorDocuments/${id}/audit/editor-finalized-v1`));
  assert.ok(!('storagePath' in stored));

  const replay = await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1 }, rev, s.deps);
  assert.ok(replay.kind === 'final' && replay.replayed);
  assert.equal(s.calls.savePdf.length, 1);
  assert.equal((await publicError(finalizeDocument({ documentId: id, clientRequestId: uuid(8), expectedContentVersion: 1 }, rev, s.deps)))?.httpStatus, 409);
  assert.equal((await publicError(saveContent({ documentId: id, clientRequestId: uuid(9), expectedContentVersion: 1, content: text('x') }, actor('author'), s.deps)))?.httpStatus, 409);
  assert.equal((await publicError(renderPreview({ documentId: id, mode: 'sample' }, actor('author'), s.deps)))?.httpStatus, 409);
});

test('finalizar com titular: escopo, vínculo confirmado e employeeId/subjectKeys gravados', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), withField('employee.name'));
  const out = await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1, employeeId: 'emp1' }, actor('r', { generate: true, review: true }), s.deps);
  assert.ok(out.kind === 'final');
  assert.equal(s.calls.scopes, 1);
  const stored = s.store.get(`editorDocuments/${id}`)!;
  assert.equal(stored.employeeId, 'emp1');
  assert.deepEqual(stored.subjectKeys, ['hr.employees:emp1', 'main.users:u1']);
  assert.deepEqual(stored.subject, { namespace: 'hr.employees', id: 'emp1' });
  assert.match(s.calls.savePdf[0], /^generated-documents\/emp1\//);
});

async function assertFinalizeBlocked(s: ReturnType<typeof setup>, id: string, content: string, code: string | null, status?: number) {
  const err = await publicError(finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1, employeeId: 'emp1' }, actor('r', { generate: true, review: true }), s.deps));
  if (code) assert.equal(err?.code, code, content);
  if (status) assert.equal(err?.httpStatus, status);
  assert.ok(err, 'finalização deve falhar');
  assert.deepEqual(s.calls.savePdf, [], 'nenhum PDF gravado');
  const stored = s.store.get(`editorDocuments/${id}`)!;
  assert.equal(stored.status, 'draft');
  assert.equal(stored.pdfGenerationStatus, 'unavailable');
  assert.ok(!stored.pdfStoragePath && !(stored.subjectKeys as string[] | undefined)?.length);
  assert.ok(![...s.store.keys()].some((k) => k.includes('/audit/editor-finalized')), 'sem auditoria de finalização');
}

test('finalizar: escopo de pessoa negado => erro público de escopo, nada gravado e continua rascunho', async () => {
  const s = setup({ assertPersonScopes: async () => { throw new AppError({ code: 'DOCUMENT_PERSON_SCOPE_FORBIDDEN', kind: 'AUTHORIZATION' }); } });
  const { id } = await draft(s, actor('author'), withField('employee.name'));
  await assertFinalizeBlocked(s, id, 'escopo', 'DOCUMENT_PERSON_SCOPE_FORBIDDEN', 403);
  assert.equal(s.calls.resolve, 0);
});

test('finalizar: titular não confirmado => EDITOR_SUBJECT_UNCONFIRMED e nada gravado', async () => {
  const s = setup({ confirmSubjectKeys: async () => { throw new Error('vinculo ambiguo interno'); } });
  const { id } = await draft(s, actor('author'), withField('employee.name'));
  await assertFinalizeBlocked(s, id, 'confirmação', 'EDITOR_SUBJECT_UNCONFIRMED');
});

test('finalizar: campo sensível sem sensitiveData.view => negado e nada gravado', async () => {
  const s = setup();
  const { id } = await draft(s, actor('author'), withField('employee.cpf'));
  await assertFinalizeBlocked(s, id, 'sensível', 'EDITOR_SENSITIVE_FIELD_FORBIDDEN', 403);
  assert.equal(s.calls.resolve, 0);
  assert.equal(s.calls.scopes, 0);
});

test('finalizar: versão desatualizada => conflito; falha de Storage => 503 e continua rascunho', async () => {
  const s = setup();
  const { id } = await draft(s);
  const rev = actor('r', { generate: true, review: true });
  assert.deepEqual(await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 5 }, rev, s.deps), { kind: 'conflict', currentVersion: 1 });

  const bad = setup({ savePdf: async () => { throw new Error('https://storage.googleapis.com/x?token=SECRETO'); } });
  const d = await draft(bad);
  const err = await publicError(finalizeDocument({ documentId: d.id, clientRequestId: uuid(7), expectedContentVersion: 1 }, rev, bad.deps));
  assert.equal(err?.httpStatus, 503);
  assert.ok(!JSON.stringify({ m: err?.safeMessage, c: err?.code, md: err?.metadata }).includes('SECRETO'));
  const stored = bad.store.get(`editorDocuments/${d.id}`)!;
  assert.equal(stored.status, 'draft');
  assert.equal(stored.pdfGenerationStatus, 'unavailable');
  assert.ok(!stored.pdfStoragePath);
});

test('finalizar: commit falha após upload => remove o objeto novo sem mascarar a falha original', async () => {
  const s = setup();
  const { id } = await draft(s);
  const rev = actor('r', { generate: true, review: true });
  const realTx = s.deps.store.db.runTransaction.bind(s.deps.store.db);
  let failNext = true;
  (s.deps.store.db as any).runTransaction = async (fn: any) => {
    if (failNext && s.calls.savePdf.length > 0) { failNext = false; throw new Error('firestore UNAVAILABLE token=SEGREDO'); }
    return realTx(fn);
  };
  const err = await finalizeDocument({ documentId: id, clientRequestId: uuid(7), expectedContentVersion: 1 }, rev, s.deps).catch((e) => e);
  assert.match(String(err.message), /UNAVAILABLE/, 'a falha original sobe (camada central sanitiza)');
  assert.deepEqual(s.calls.deletePdf, s.calls.savePdf);
  assert.equal(s.store.get(`editorDocuments/${id}`)!.status, 'draft');
});

test('finalizar: falha ao apagar o órfão não substitui a falha original; objeto referenciado nunca é apagado', async () => {
  const failing = setup({ deletePdf: async () => { throw new Error('delete falhou'); } });
  const a = await draft(failing);
  const realTx = failing.deps.store.db.runTransaction.bind(failing.deps.store.db);
  let once = true;
  (failing.deps.store.db as any).runTransaction = async (fn: any) => {
    if (once && failing.calls.savePdf.length > 0) { once = false; throw new Error('original'); }
    return realTx(fn);
  };
  const err = await finalizeDocument({ documentId: a.id, clientRequestId: uuid(7), expectedContentVersion: 1 }, actor('r', { generate: true, review: true }), failing.deps).catch((e) => e);
  assert.equal(err.message, 'original');

  // Concorrência: o commit "falhou", mas o documento já está final apontando para o MESMO objeto => não apaga.
  const s = setup();
  const b = await draft(s);
  const rev = actor('r', { generate: true, review: true });
  await finalizeDocument({ documentId: b.id, clientRequestId: uuid(7), expectedContentVersion: 1 }, rev, s.deps);
  const path = s.calls.savePdf[0];
  const stored = s.store.get(`editorDocuments/${b.id}`)!;
  // Força uma nova tentativa do pipeline com o documento ainda `draft` na leitura inicial, mas já
  // final no momento da releitura do descarte: o conversor devolve os mesmos bytes (mesmo caminho).
  s.store.set(`editorDocuments/${b.id}`, { ...stored, status: 'draft', finalizeRequestId: null });
  const sTx = s.deps.store.db.runTransaction.bind(s.deps.store.db);
  (s.deps.store.db as any).runTransaction = async (fn: any) => {
    s.store.set(`editorDocuments/${b.id}`, stored); // documento efetivado por outra finalização
    (s.deps.store.db as any).runTransaction = sTx;
    throw new Error('ambíguo');
  };
  const err2 = await finalizeDocument({ documentId: b.id, clientRequestId: uuid(8), expectedContentVersion: 1 }, rev, s.deps).catch((e) => e);
  assert.equal(err2.message, 'ambíguo');
  assert.equal(s.calls.savePdf.length, 2);
  assert.equal(s.calls.savePdf[1], path, 'mesmo caminho do upload anterior');
  assert.deepEqual(s.calls.deletePdf, [], 'objeto referenciado pelo documento nunca é apagado');

  // Caminho diferente do referenciado => apaga o próprio objeto.
  const d = setup();
  const c = await draft(d);
  const dStored = d.store.get(`editorDocuments/${c.id}`)!;
  const dTx = d.deps.store.db.runTransaction.bind(d.deps.store.db);
  (d.deps.store.db as any).runTransaction = async () => {
    d.store.set(`editorDocuments/${c.id}`, { ...dStored, pdfStoragePath: 'generated-documents/standalone/outro.pdf' });
    (d.deps.store.db as any).runTransaction = dTx;
    throw new Error('falha');
  };
  await finalizeDocument({ documentId: c.id, clientRequestId: uuid(9), expectedContentVersion: 1 }, rev, d.deps).catch(() => null);
  assert.deepEqual(d.calls.deletePdf, d.calls.savePdf);
});

// ------------------------------------------------------------ contrato das rotas

test('rotas do editor: cada método via secureRoute, sem exceção registrada nem rota legada tocada', () => {
  const routes: Array<[string, string]> = [
    ['src/app/api/documents/editor/route.ts', 'POST'],
    ['src/app/api/documents/editor/[id]/route.ts', 'GET'],
    ['src/app/api/documents/editor/[id]/content/route.ts', 'PUT'],
    ['src/app/api/documents/editor/[id]/preview/route.ts', 'POST'],
    ['src/app/api/documents/editor/[id]/finalize/route.ts', 'POST'],
    ['src/app/api/documents/editor/[id]/file/route.ts', 'GET'],
  ];
  for (const [file, method] of routes) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, new RegExp(`export const ${method} = secureRoute\\(`), file);
    assert.doesNotMatch(src, /error\.message|\.stack|cause\.message/, file);
  }
  assert.ok(!readFileSync('config/security-contract-exceptions.json', 'utf8').includes('documents/editor'));
});

// ------------------------------------------------------------ download do PDF final

async function finalDoc(s: ReturnType<typeof setup>, title = 'Carta') {
  const view = await createDraft({ clientRequestId: uuid(31), title, content: text('Olá') }, actor('author'), s.deps);
  await finalizeDocument({ documentId: view.id, clientRequestId: uuid(32), expectedContentVersion: 1 }, actor('r', { generate: true, review: true }), s.deps);
  return view.id;
}

test('download: autor e revisor recebem o PDF final; auditoria sem conteúdo nem caminho', async () => {
  const s = setup();
  const id = await finalDoc(s);
  const own = await enforcerFor(s, actor('author'), 'download' as any, null)(id);
  const out = await downloadFinalPdf(id, actor('author'), s.deps);
  assert.ok(own.resource.document);
  assert.equal(out.pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(out.fileName, 'Carta.pdf');
  const rev = await enforcerFor(s, actor('rev', { generate: true, review: true }), 'download' as any, null)(id);
  assert.ok(rev.resource.document);
  const events = [...s.store.entries()].filter(([k]) => k.includes('/audit/editor-pdf_downloaded-v1-'));
  assert.equal(events.length, 1);
  assert.equal(events[0][1].type, 'editor.pdf_downloaded');
  assert.equal(events[0][1].actorId, 'author');
  assert.ok(events[0][1].pdfContentHash);
  assert.ok(!JSON.stringify(events[0][1]).includes('generated-documents'));
});

test('download: não-autor sem review => 403; outro workspace => 404; sem generate => 403', async () => {
  const s = setup();
  const id = await finalDoc(s);
  assert.equal((await publicError(enforcerFor(s, actor('other'), 'download' as any, null)(id)))?.httpStatus, 403);
  assert.equal((await publicError(enforcerFor(s, actor('author', {}), 'download' as any, null)(id)))?.httpStatus, 403);
  assert.equal((await publicError(enforcerFor(s, actor('author', { generate: true, review: true }, 'w2'), 'download' as any, null)(id)))?.httpStatus, 404);
  assert.equal((await publicError(downloadFinalPdf(id, actor('author', { generate: true, review: true }, 'w2'), s.deps)))?.httpStatus, 404);
  assert.equal(s.calls.readPdf.length, 0);
});

test('download: rascunho => 409; sem PDF pronto => 404; sem leitura do Storage', async () => {
  const s = setup();
  const view = await draft(s);
  const err = await publicError(downloadFinalPdf(view.id, actor('author'), s.deps));
  assert.equal(err?.httpStatus, 409);
  const t = setup();
  const fid = await finalDoc(t);
  t.store.set(`editorDocuments/${fid}`, { ...t.store.get(`editorDocuments/${fid}`)!, pdfGenerationStatus: 'unavailable' });
  assert.equal((await publicError(downloadFinalPdf(fid, actor('author'), t.deps)))?.httpStatus, 404);
  assert.equal(s.calls.readPdf.length + t.calls.readPdf.length, 0);
});

test('download: falha do Storage ou PDF inválido => 503 fixo sem caminho, URL ou mensagem; sem auditoria', async () => {
  const s = setup();
  const id = await finalDoc(s);
  const path = s.calls.savePdf[0];
  s.objects.delete(path);
  const e1 = await publicError(downloadFinalPdf(id, actor('author'), s.deps));
  s.objects.set(path, Buffer.from('<html>nao e pdf</html>'));
  const e2 = await publicError(downloadFinalPdf(id, actor('author'), s.deps));
  for (const e of [e1, e2]) {
    assert.equal(e?.httpStatus, 503);
    const body = JSON.stringify(await toErrorResponse(e!, 'req', undefined, { source: 't', operation: 't', routeOrJob: 't', sink: { write() {} } }).json());
    assert.ok(body.includes('EDITOR_STORAGE_UNAVAILABLE'));
    assert.ok(!/generated-documents|gs:\/\/|segredo|caminho/.test(`${e?.message}${body}`));
  }
  assert.equal([...s.store.keys()].filter((k) => k.includes('pdf_downloaded')).length, 0);
});

test('download: nome de arquivo derivado do título é ASCII seguro, mesmo com título malicioso', () => {
  for (const title of ['a"; filename="x.exe', 'Carta\r\nSet-Cookie: x=1', '../../etc/passwd', 'Contrato ção ✓', '\u0000\u202e', '', 'x'.repeat(500)]) {
    const name = safeFileName(title);
    assert.match(name, /^[a-zA-Z0-9_-]{1,80}\.pdf$/, title);
  }
});
