import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { createDraft, type EditorActor, type EditorApiDeps } from '../../../src/features/documents/editor/editor-api.server';
import { editorDocumentIdSchema, createEditorTemplateBodySchema, listEditorTemplatesQuerySchema } from '../../../src/features/documents/editor/editor-api-schemas';
import { getEditorContentVersion } from '../../../src/features/documents/editor/document-store.server';
import {
  archiveTemplate,
  assertTemplateAccess,
  createTemplate,
  listTemplates,
  openTemplate,
  publishTemplate,
  renderTemplatePreview,
  saveTemplateContent,
  toPublicTemplateError,
  useTemplate,
  type TemplateAction,
  type TemplateApiDeps,
} from '../../../src/features/documents/editor/template-api.server';
import { EditorTemplateError } from '../../../src/features/documents/editor/document-store.types';
import { createTemplateEnforcer } from '../../../src/features/documents/editor/template-route-security.server';
import { AppError } from '../../../src/lib/observability/app-error';
import { defineSecurityContract } from '../../../src/lib/security/route-contract';

/** Fake mínimo do Firestore Admin com consultas simples (where ==, orderBy, startAfter, limit). NÃO prova o emulador. */
function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const reads: string[] = [];
  const queries: string[] = [];
  const mkRef = (path: string): any => ({
    id: path.split('/').pop(), path,
    async get() { reads.push(path); const d = store.get(path); return { exists: d !== undefined, data: () => d }; },
    collection: (name: string) => ({ doc: (id: string) => mkRef(`${path}/${name}/${id}`) }),
  });
  const ms = (v: any) => (v instanceof Date ? v.getTime() : v);
  const mkQuery = (name: string, filters: Array<[string, unknown]> = [], order: Array<[string, string]> = [], after: unknown[] | null = null, lim = Infinity): any => ({
    where: (f: string, _op: string, v: unknown) => mkQuery(name, [...filters, [f, v]], order, after, lim),
    orderBy: (f: string, d = 'asc') => mkQuery(name, filters, [...order, [f, d]], after, lim),
    startAfter: (...v: unknown[]) => mkQuery(name, filters, order, v, lim),
    limit: (n: number) => mkQuery(name, filters, order, after, n),
    async get() {
      queries.push(JSON.stringify({ name, filters, order, lim }));
      let docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${name}/`) && p.split('/').length === 2)
        .map(([p, d]) => ({ id: p.split('/')[1], d }))
        .filter(({ d }) => filters.every(([f, v]) => d[f] === v));
      const key = (x: { id: string; d: any }, f: string) => (f === '__name__' ? x.id : ms(x.d[f]));
      docs.sort((a, b) => {
        for (const [f, dir] of order) { const ka = key(a, f), kb = key(b, f); if (ka !== kb) return (ka < kb ? -1 : 1) * (dir === 'desc' ? -1 : 1); }
        return 0;
      });
      if (after) {
        docs = docs.filter((x) => {
          for (let i = 0; i < order.length; i++) {
            const [f, dir] = order[i]; const k = key(x, f), a = ms(after[i]);
            if (k !== a) return dir === 'desc' ? k < a : k > a;
          }
          return false;
        });
      }
      docs = docs.slice(0, lim);
      reads.push(...docs.map((x) => `${name}/${x.id}`));
      return { docs: docs.map((x) => ({ id: x.id, data: () => x.d })) };
    },
  });
  const db = {
    collection: (name: string) => ({ doc: (id = 'auto') => mkRef(`${name}/${id}`), where: (f: string, op: string, v: unknown) => mkQuery(name).where(f, op, v) }),
    async runTransaction<T>(fn: (tx: any) => Promise<T>) {
      const pending: Array<[string, Record<string, unknown>, 'set' | 'create' | 'update']> = [];
      let wrote = false;
      const tx = {
        get: (ref: any) => { assert.equal(wrote, false, 'leitura depois de escrita na transação'); return ref.get(); },
        set: (ref: any, d: any) => { wrote = true; pending.push([ref.path, d, 'set']); },
        create: (ref: any, d: any) => { wrote = true; pending.push([ref.path, d, 'create']); },
        update: (ref: any, d: any) => { wrote = true; pending.push([ref.path, d, 'update']); },
      };
      const result = await fn(tx);
      const seen = new Set<string>();
      for (const [path, , kind] of pending) {
        if (kind === 'create' && (store.has(path) || seen.has(path))) throw new Error('ALREADY_EXISTS');
        seen.add(path);
      }
      for (const [path, d, kind] of pending) { store.set(path, kind === 'update' ? { ...store.get(path), ...d } : d); writes.push(path); }
      return result;
    },
  };
  return { db, store, writes, reads, queries };
}


const perms = (o: { generate?: boolean; review?: boolean }): any => ({
  hr: { formalization: { view: false, documents: { view: false, generate: !!o.generate, review: !!o.review }, sensitiveData: { view: false } } },
});
const actor = (uid: string, o: { generate?: boolean; review?: boolean } = { generate: true }, ws = 'w1'): EditorActor =>
  ({ decoded: { uid } as any, userDoc: { id: uid } as any, isDefaultAdmin: false, workspace_id: ws, permissions: perms(o) });
const GEN = { generate: true };
const REV = { generate: true, review: true };

const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup(over: Partial<TemplateApiDeps> = {}) {
  const f = fakeDb();
  const calls = { convert: 0, sample: 0, resolvedStamp: 0, scopes: 0, resolve: 0, confirm: 0, savePdf: 0, html: [] as string[] };
  const deps: TemplateApiDeps = {
    store: { db: f.db as any, now: () => new Date('2026-11-05T10:00:00Z') } as any,
    convertHtmlToPdf: async (html) => { calls.convert++; calls.html.push(html); return { ok: true, pdf: Buffer.from('%PDF-fake') }; },
    applyLetterhead: async (b) => b,
    stampSamplePreview: async (b) => { calls.sample++; return b; },
    stampResolvedPreview: async (b) => { calls.resolvedStamp++; return b; },
    assertPersonScopes: async () => { calls.scopes++; },
    resolveRawValues: async () => { calls.resolve++; return {}; },
    confirmSubjectKeys: async () => { calls.confirm++; return []; },
    savePdf: async () => { calls.savePdf++; },
    deletePdf: async () => {},
    readPdf: async () => Buffer.from('%PDF'),
    rateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
    ...over,
  };
  return { ...f, deps, calls };
}
type S = ReturnType<typeof setup>;
const publicError = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as AppError; } return null; };
const mk = (s: S, who = actor('u1'), n = 1, content: unknown = text('Olá')) =>
  createTemplate({ clientRequestId: uuid(n), name: 'Modelo', content }, who, s.deps);
const published = async (s: S, n = 1, content: unknown = text('Texto')) => {
  const t = await mk(s, actor('u1', REV), n, content);
  await publishTemplate({ templateId: t.id, clientRequestId: uuid(100 + n), expectedVersion: 1 }, actor('u1', REV), s.deps);
  return t;
};

// ------------------------------------------------------------ permissões

const ACTIONS: TemplateAction[] = ['list', 'open', 'create', 'save', 'preview', 'use', 'publish', 'archive'];

test('assertTemplateAccess: sem generate nega tudo; generate sem review nega publicar/arquivar; review permite', () => {
  for (const a of ACTIONS) assert.throws(() => assertTemplateAccess(actor('x', {}), a), /permissão/, a);
  for (const a of ACTIONS) assert.throws(() => assertTemplateAccess(actor('x', { review: true }), a), /permissão/, `review sem generate: ${a}`);
  for (const a of ACTIONS) {
    if (a === 'publish' || a === 'archive') assert.throws(() => assertTemplateAccess(actor('x', GEN), a), /permissão/, a);
    else assert.doesNotThrow(() => assertTemplateAccess(actor('x', GEN), a), a);
    assert.doesNotThrow(() => assertTemplateAccess(actor('x', REV), a), a);
  }
  assert.doesNotThrow(() => assertTemplateAccess({ ...actor('x', {}), isDefaultAdmin: true }, 'publish'));
});

function enforce(who: EditorActor, action: TemplateAction, schema: any, opts: { method?: string; url?: string; id?: string | undefined; body?: unknown; raw?: string } = {}) {
  const method = opts.method ?? 'POST';
  const contract = defineSecurityContract({
    schemaVersion: 1, id: 'documents.editor.templates.test', version: 1,
    surface: { method: method as any, path: '/api/documents/editor/templates' as any },
    exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'editor-template-test' },
    resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'documents.editor.templates.test', unknownFields: 'reject' },
    effects: { mode: 'write', audit: 'server-authoritative' }, errorExposure: 'sanitized',
  });
  const enforcer = createTemplateEnforcer(contract, { action, schema, source: action === 'list' ? 'query' : 'body', authenticate: async () => who });
  const hasBody = opts.body !== undefined || opts.raw !== undefined;
  return enforcer.enforce({
    request: new NextRequest(opts.url ?? 'http://localhost/api/documents/editor/templates', { method, ...(hasBody ? { body: opts.raw ?? JSON.stringify(opts.body) } : {}) }),
    routeContext: { params: Promise.resolve({ tid: opts.id }) }, observation: { requestId: 'r' }, contract,
  });
}
const TID = 'tpl_' + 'a'.repeat(32);

test('enforcer: matriz de permissões antes de qualquer leitura', async () => {
  const s = setup();
  for (const a of ['open', 'preview'] as const) {
    assert.equal((await publicError(enforce(actor('x', {}), a, null, { id: TID })))?.httpStatus, 403, a);
    assert.equal((await enforce(actor('x', GEN), a, null, { id: TID })).input.templateId, TID);
  }
  const lifecycle = { clientRequestId: uuid(2), expectedVersion: 1 };
  const { publishEditorTemplateBodySchema } = await import('../../../src/features/documents/editor/editor-api-schemas');
  for (const a of ['publish', 'archive'] as const) {
    assert.equal((await publicError(enforce(actor('x', {}), a, publishEditorTemplateBodySchema, { id: TID, body: lifecycle })))?.httpStatus, 403, a);
    assert.equal((await publicError(enforce(actor('x', GEN), a, publishEditorTemplateBodySchema, { id: TID, body: lifecycle })))?.httpStatus, 403, a);
    assert.ok(await enforce(actor('x', REV), a, publishEditorTemplateBodySchema, { id: TID, body: lifecycle }));
  }
  assert.equal((await publicError(enforce(actor('x', {}), 'create', createEditorTemplateBodySchema, { body: { clientRequestId: uuid(1), name: 'x' } })))?.httpStatus, 403);
  assert.ok(await enforce(actor('x', GEN), 'create', createEditorTemplateBodySchema, { body: { clientRequestId: uuid(1), name: 'x' } }));
  assert.equal(s.reads.length, 0, 'o enforcer não lê o Firestore');
});

test('enforcer: id de modelo inválido (incluindo id de documento e ausente) => 400 igual', async () => {
  for (const id of ['../x', 'templates', 'ed_' + 'a'.repeat(32), 'tpl_' + 'A'.repeat(32), 'tpl_abc', undefined]) {
    const err = await publicError(enforce(actor('x', GEN), 'open', null, { id }));
    assert.equal(err?.httpStatus, 400, String(id));
    assert.equal(err?.code, 'EDITOR_TEMPLATE_INPUT_INVALID');
  }
});

test('enforcer: corpo estranho, inválido e grande => 400/413 sem eco do valor', async () => {
  const secret = 'SEGREDO-NAO-ECOAR-123';
  const bad: Array<[unknown?, string?]> = [
    [{ clientRequestId: uuid(1), name: 'x', extra: secret }],
    [{ clientRequestId: uuid(1), name: 'x', content: text('a'), fromDocument: { documentId: 'ed_' + 'a'.repeat(32), version: 1 } }],
    [{ clientRequestId: uuid(1), name: 'x', fromDocument: { documentId: secret, version: 1 } }],
    [undefined, `{"name":${secret}`],
  ];
  for (const [body, raw] of bad) {
    const err = await publicError(enforce(actor('x', GEN), 'create', createEditorTemplateBodySchema, { body, raw }));
    assert.equal(err?.httpStatus, 400);
    assert.ok(!JSON.stringify({ m: err?.safeMessage, c: err?.code }).includes(secret));
  }
  assert.equal((await publicError(enforce(actor('x', GEN), 'create', createEditorTemplateBodySchema, { raw: 'x'.repeat(600 * 1024) })))?.httpStatus, 413);
});

test('enforcer: query da listagem (status, limit 1-25, cursor, campos estranhos, repetidos)', async () => {
  const ok = await enforce(actor('x', GEN), 'list', listEditorTemplatesQuerySchema, { method: 'GET', url: 'http://localhost/api/documents/editor/templates?status=published&limit=25&cursor=abc_-' });
  assert.deepEqual(ok.input.body, { status: 'published', limit: 25, cursor: 'abc_-' });
  for (const q of ['limit=26', 'limit=0', 'limit=1.5', 'limit=x', 'status=final', 'foo=1', 'limit=1&limit=2', 'cursor=a/b']) {
    const err = await publicError(enforce(actor('x', GEN), 'list', listEditorTemplatesQuerySchema, { method: 'GET', url: `http://localhost/api/documents/editor/templates?${q}` }));
    assert.equal(err?.httpStatus, 400, q);
  }
  assert.equal((await publicError(enforce(actor('x', {}), 'list', listEditorTemplatesQuerySchema, { method: 'GET' })))?.httpStatus, 403);
});

// ------------------------------------------------------------ fluxo e isolamento

test('qualquer detentor de generate lista, abre, cria, salva; modelo é do workspace, não do autor', async () => {
  const s = setup();
  const t = await mk(s, actor('author', GEN));
  const other = actor('colega', GEN);
  assert.equal((await listTemplates({}, other, s.deps)).items.length, 1);
  const opened = await openTemplate(t.id, other, s.deps);
  assert.deepEqual(opened.content, text('Olá'));
  assert.equal(opened.version, 1);
  const saved = await saveTemplateContent({ templateId: t.id, clientRequestId: uuid(2), expectedVersion: 1, content: text('Novo') }, other, s.deps);
  assert.equal(saved.kind, 'saved');
  assert.equal((saved as any).template.currentVersion, 2);
  assert.ok(!('createdBy' in (saved as any).template), 'visão pública não expõe uid de ator');
});

test('salvar versão em modelo publicado não move a versão publicada; só publicar move', async () => {
  const s = setup();
  const t = await published(s);
  const saved: any = await saveTemplateContent({ templateId: t.id, clientRequestId: uuid(3), expectedVersion: 1, content: text('v2') }, actor('x', GEN), s.deps);
  assert.equal(saved.template.currentVersion, 2);
  assert.equal(saved.template.publishedVersion, 1);
  const used: any = await useTemplate({ templateId: t.id, clientRequestId: uuid(4) }, actor('x', GEN), s.deps);
  const v = await getEditorContentVersion(used.document.id, 'w1', s.deps.store as any);
  assert.deepEqual(v.content, text('Texto'), 'usa a versão publicada, não a corrente');
  const pub: any = await publishTemplate({ templateId: t.id, clientRequestId: uuid(5), expectedVersion: 2 }, actor('x', REV), s.deps);
  assert.equal(pub.template.publishedVersion, 2);
});

test('conflito de versão vira resultado com versão atual (save/publish/archive)', async () => {
  const s = setup();
  const t = await mk(s);
  assert.deepEqual(await saveTemplateContent({ templateId: t.id, clientRequestId: uuid(2), expectedVersion: 7, content: text('x') }, actor('x', GEN), s.deps), { kind: 'conflict', currentVersion: 1 });
  assert.deepEqual(await publishTemplate({ templateId: t.id, clientRequestId: uuid(3), expectedVersion: 7 }, actor('x', REV), s.deps), { kind: 'conflict', currentVersion: 1 });
  assert.deepEqual(await archiveTemplate({ templateId: t.id, clientRequestId: uuid(4), expectedVersion: 7 }, actor('x', REV), s.deps), { kind: 'conflict', currentVersion: 1 });
});

test('usar: modelo arquivado, não publicado e versão publicada divergente', async () => {
  const s = setup();
  const draftT = await mk(s);
  const e1 = await publicError(useTemplate({ templateId: draftT.id, clientRequestId: uuid(10) }, actor('x', GEN), s.deps));
  assert.equal(e1?.code, 'EDITOR_TEMPLATE_NOT_PUBLISHED');
  assert.equal(e1?.httpStatus, 409);
  const pubT = await published(s, 2);
  const mismatch = await useTemplate({ templateId: pubT.id, clientRequestId: uuid(11), expectedPublishedVersion: 9 }, actor('x', GEN), s.deps);
  assert.deepEqual(mismatch, { kind: 'published_version_changed', publishedVersion: 1 });
  const ok: any = await useTemplate({ templateId: pubT.id, clientRequestId: uuid(12), expectedPublishedVersion: 1 }, actor('x', GEN), s.deps);
  assert.equal(ok.kind, 'created');
  assert.equal(ok.document.status, 'draft');
  assert.equal(ok.document.subject, null);
  assert.ok(!('pdfStoragePath' in ok.document));
  await archiveTemplate({ templateId: pubT.id, clientRequestId: uuid(13), expectedVersion: 1 }, actor('x', REV), s.deps);
  const e2 = await publicError(useTemplate({ templateId: pubT.id, clientRequestId: uuid(14) }, actor('x', GEN), s.deps));
  assert.equal(e2?.code, 'EDITOR_TEMPLATE_ARCHIVED');
  const e3 = await publicError(saveTemplateContent({ templateId: pubT.id, clientRequestId: uuid(15), expectedVersion: 1, content: text('x') }, actor('x', GEN), s.deps));
  assert.equal(e3?.code, 'EDITOR_TEMPLATE_ARCHIVED');
  const e4 = await publicError(publishTemplate({ templateId: pubT.id, clientRequestId: uuid(16), expectedVersion: 1 }, actor('x', REV), s.deps));
  assert.equal(e4?.code, 'EDITOR_TEMPLATE_ARCHIVED');
});

test('isolamento de workspace: modelo de outro workspace é 404 idêntico ao inexistente', async () => {
  const s = setup();
  const t = await published(s);
  const foreign = actor('x', REV, 'w2');
  const missing = 'tpl_' + 'b'.repeat(32);
  const ops: Array<(id: string) => Promise<unknown>> = [
    (id) => openTemplate(id, foreign, s.deps),
    (id) => renderTemplatePreview(id, foreign, s.deps),
    (id) => useTemplate({ templateId: id, clientRequestId: uuid(20) }, foreign, s.deps),
    (id) => saveTemplateContent({ templateId: id, clientRequestId: uuid(21), expectedVersion: 1, content: text('x') }, foreign, s.deps),
    (id) => publishTemplate({ templateId: id, clientRequestId: uuid(22), expectedVersion: 1 }, foreign, s.deps),
    (id) => archiveTemplate({ templateId: id, clientRequestId: uuid(23), expectedVersion: 1 }, foreign, s.deps),
  ];
  for (const op of ops) {
    const a = await publicError(op(t.id));
    const b = await publicError(op(missing));
    assert.equal(a?.httpStatus, 404);
    assert.equal(a?.code, 'EDITOR_TEMPLATE_NOT_FOUND');
    assert.deepEqual([a?.code, a?.safeMessage, a?.httpStatus], [b?.code, b?.safeMessage, b?.httpStatus]);
  }
  assert.deepEqual((await listTemplates({}, foreign, s.deps)).items, []);
  assert.equal((await listTemplates({}, actor('x', GEN), s.deps)).items.length, 1);
  assert.ok(!s.store.get(`editorTemplates/${t.id}`)?.archivedAt, 'nada foi alterado pelo workspace estranho');
});

test('erros públicos são fixos e não vazam mensagem interna, id ou detalhes', () => {
  const codes = ['invalid_input', 'invalid_content', 'not_found', 'version_conflict', 'template_archived', 'template_not_published', 'published_version_mismatch', 'idempotency_mismatch'] as const;
  const seen = new Set<string>();
  for (const code of codes) {
    const out = toPublicTemplateError(new EditorTemplateError(code, `INTERNO tpl_${'c'.repeat(32)} segredo`, { currentVersion: 9, publishedVersion: 8 })) as AppError;
    assert.ok(out instanceof AppError);
    assert.match(out.code, /^EDITOR_TEMPLATE_/);
    assert.ok(!out.safeMessage.includes('INTERNO') && !out.safeMessage.includes('tpl_'));
    assert.ok(!JSON.stringify(out.metadata ?? {}).includes('segredo'));
    seen.add(out.code);
  }
  assert.equal(seen.size, codes.length, 'cada código interno tem código público próprio');
  const unexpected = new Error('falha interna do Firestore');
  assert.equal(toPublicTemplateError(unexpected), unexpected, 'falha inesperada sobe intacta para a camada central');
});

test('idempotência: criar com o mesmo clientRequestId repete; com outro conteúdo => 409 próprio', async () => {
  const s = setup();
  const a = await mk(s);
  const b = await mk(s);
  assert.equal(a.id, b.id);
  const err = await publicError(createTemplate({ clientRequestId: uuid(1), name: 'Outro' }, actor('u1'), s.deps));
  assert.equal(err?.code, 'EDITOR_TEMPLATE_REQUEST_ID_REUSED');
  assert.equal((await publicError(createTemplate({ clientRequestId: uuid(9), name: 'x', content: { type: 'script' } }, actor('u1'), s.deps)))?.code, 'EDITOR_TEMPLATE_CONTENT_INVALID');
});

// ------------------------------------------------------------ fromDocument

test('fromDocument: exige acesso ao documento (generate + autor OU review); copia o texto; sem titular', async () => {
  const s = setup();
  const docView = await createDraft({ clientRequestId: uuid(30), title: 'Carta', content: text('Texto do documento') }, actor('author', GEN), s.deps as EditorApiDeps);
  const from = { documentId: docView.id, version: 1 };
  // Colega sem review: não pode abrir o documento, logo não pode copiá-lo.
  const denied = await publicError(createTemplate({ clientRequestId: uuid(31), name: 'M', fromDocument: from }, actor('colega', GEN), s.deps));
  assert.equal(denied?.code, 'EDITOR_DOCUMENT_FORBIDDEN');
  assert.equal(denied?.httpStatus, 403);
  assert.ok(![...s.store.keys()].some((k) => k.startsWith('editorTemplates/')), 'nenhum modelo foi criado');
  // Sem generate nem chega ao documento.
  assert.equal((await publicError(createTemplate({ clientRequestId: uuid(31), name: 'M', fromDocument: from }, actor('author', {}), s.deps)))?.code, 'EDITOR_DOCUMENT_FORBIDDEN');
  // Outro workspace: documento inexistente.
  const foreign = await publicError(createTemplate({ clientRequestId: uuid(31), name: 'M', fromDocument: from }, actor('rev', REV, 'w2'), s.deps));
  assert.equal(foreign?.code, 'EDITOR_DOCUMENT_NOT_FOUND');
  assert.equal(foreign?.httpStatus, 404);
  // Documento inexistente.
  assert.equal((await publicError(createTemplate({ clientRequestId: uuid(31), name: 'M', fromDocument: { documentId: 'ed_' + 'f'.repeat(32), version: 1 } }, actor('author', GEN), s.deps)))?.code, 'EDITOR_DOCUMENT_NOT_FOUND');
  // Autor e revisor copiam.
  const byAuthor = await createTemplate({ clientRequestId: uuid(32), name: 'M', fromDocument: from }, actor('author', GEN), s.deps);
  const byReviewer = await createTemplate({ clientRequestId: uuid(33), name: 'M2', fromDocument: from }, actor('rev', REV), s.deps);
  for (const t of [byAuthor, byReviewer]) {
    assert.deepEqual((await openTemplate(t.id, actor('rev', REV), s.deps)).content, text('Texto do documento'));
  }
  const raw = JSON.stringify([...s.store.entries()].filter(([k]) => k.startsWith('editorTemplates/')));
  assert.ok(!/subject|employeeId|titular/i.test(raw), 'modelo não guarda titular');
  // Versão inexistente do documento.
  assert.equal((await publicError(createTemplate({ clientRequestId: uuid(34), name: 'M', fromDocument: { documentId: docView.id, version: 5 } }, actor('author', GEN), s.deps)))?.code, 'EDITOR_TEMPLATE_NOT_FOUND');
});

// ------------------------------------------------------------ rate limit

test('rate limit: criar/usar no escopo create; prévia no escopo pdf; 429 fixo', async () => {
  const scopes: string[] = [];
  const s = setup({ rateLimit: (scope, uid) => { scopes.push(`${scope}:${uid}`); return { allowed: false, retryAfterSeconds: 7 }; } });
  const calls = [
    createTemplate({ clientRequestId: uuid(1), name: 'x' }, actor('u1'), s.deps),
    useTemplate({ templateId: TID, clientRequestId: uuid(2) }, actor('u1'), s.deps),
    renderTemplatePreview(TID, actor('u1'), s.deps),
  ];
  for (const c of calls) {
    const err = await publicError(c);
    assert.equal(err?.httpStatus, 429);
    assert.equal(err?.code, 'EDITOR_RATE_LIMITED');
  }
  assert.deepEqual(scopes, ['create:u1', 'create:u1', 'pdf:u1']);
  assert.equal(s.writes.length, 0);
  assert.equal(s.calls.convert, 0);
});

// ------------------------------------------------------------ prévia

test('prévia: só exemplo, sem titular/escopo/resolvedor, carimbo de amostra, sem escrita', async () => {
  const s = setup();
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prezado ' }, { type: 'documentField', attrs: { key: 'employee.name' } }] }] };
  const t = await mk(s, actor('u1', GEN), 1, content);
  const writesBefore = s.writes.length;
  const pdf = await renderTemplatePreview(t.id, actor('colega', GEN), s.deps);
  assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
  assert.equal(s.calls.sample, 1);
  assert.equal(s.calls.resolvedStamp, 0);
  assert.deepEqual([s.calls.scopes, s.calls.resolve, s.calls.confirm, s.calls.savePdf], [0, 0, 0, 0]);
  assert.equal(s.writes.length, writesBefore, 'prévia não grava nada (nem auditoria nem PDF)');
  assert.ok(s.calls.html[0].includes('Prezado'));
  assert.ok(!s.calls.html[0].includes('Fulana de Tal'), 'valor real de titular nunca entra na prévia');
});

test('prévia: falha do conversor vira erro público fixo', async () => {
  const s = setup({ convertHtmlToPdf: async () => ({ ok: false, reason: 'timeout' }) as any });
  const t = await mk(s);
  const err = await publicError(renderTemplatePreview(t.id, actor('x', GEN), s.deps));
  assert.equal(err?.code, 'EDITOR_PDF_UNAVAILABLE');
  assert.equal(err?.httpStatus, 503);
});

// ------------------------------------------------------------ listar/abrir sem efeitos

test('listar e abrir não escrevem; paginação por cursor; limite máximo 25', async () => {
  const s = setup();
  for (let i = 1; i <= 3; i++) {
    const t = await createTemplate({ clientRequestId: uuid(i), name: `M${i}`, content: text(String(i)) }, actor('u1'), { ...s.deps, store: { ...(s.deps.store as any), now: () => new Date(2026, 10, 5, 10, i) } });
    void t;
  }
  const writes = s.writes.length;
  const p1 = await listTemplates({ limit: 2 }, actor('x', GEN), s.deps);
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  const p2 = await listTemplates({ limit: 2, cursor: p1.nextCursor! }, actor('x', GEN), s.deps);
  assert.equal(p2.items.length, 1);
  assert.equal(p2.nextCursor, null);
  assert.equal((await listTemplates({ status: 'published' }, actor('x', GEN), s.deps)).items.length, 0);
  await openTemplate(p1.items[0].id, actor('x', GEN), s.deps);
  assert.equal(s.writes.length, writes, 'GET não escreve');
  assert.ok(s.queries.every((q) => JSON.parse(q).lim <= 26));
  assert.equal((await publicError(listTemplates({ cursor: 'lixo' }, actor('x', GEN), s.deps)))?.code, 'EDITOR_TEMPLATE_INPUT_INVALID');
});

// ------------------------------------------------------------ rotas

const ROUTES: Array<[string, string, string]> = [
  ['src/app/api/documents/editor/templates/route.ts', 'GET', '/api/documents/editor/templates'],
  ['src/app/api/documents/editor/templates/route.ts', 'POST', '/api/documents/editor/templates'],
  ['src/app/api/documents/editor/templates/[tid]/route.ts', 'GET', '/api/documents/editor/templates/[tid]'],
  ['src/app/api/documents/editor/templates/[tid]/content/route.ts', 'PUT', '/api/documents/editor/templates/[tid]/content'],
  ['src/app/api/documents/editor/templates/[tid]/preview/route.ts', 'POST', '/api/documents/editor/templates/[tid]/preview'],
  ['src/app/api/documents/editor/templates/[tid]/publish/route.ts', 'POST', '/api/documents/editor/templates/[tid]/publish'],
  ['src/app/api/documents/editor/templates/[tid]/archive/route.ts', 'POST', '/api/documents/editor/templates/[tid]/archive'],
  ['src/app/api/documents/editor/templates/[tid]/use/route.ts', 'POST', '/api/documents/editor/templates/[tid]/use'],
];

test('rotas: cada método sai por secureRoute com contrato/enforcer, runtime nodejs e sem error.message', () => {
  for (const [file, method, path] of ROUTES) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, new RegExp(`export const ${method} = secureRoute\\(`), `${file} ${method}`);
    assert.ok(src.includes(`path: "${path}"`), `${file} caminho`);
    assert.match(src, /export const dynamic = "force-dynamic"/);
    assert.match(src, /errorExposure: "sanitized"/);
    assert.match(src, /Cache-Control/);
    assert.ok(!/error\.message|\.stack|\.cause/.test(src), file);
    assert.ok(!/(^|\n)export (async )?function (GET|POST|PUT|PATCH|DELETE)/.test(src), file);
  }
  for (const [file] of ROUTES) {
    const needsReview = file.endsWith('/publish/route.ts') || file.endsWith('/archive/route.ts');
    assert.equal(readFileSync(file, 'utf8').includes('editor-template-generate-and-review'), needsReview, file);
  }
});

test('segmento estático templates não colide com [id]: id de documento exige ed_<32 hex> e a rota do documento segue intacta', () => {
  assert.ok(!editorDocumentIdSchema.safeParse('templates').success);
  assert.ok(editorDocumentIdSchema.safeParse('ed_' + '0'.repeat(32)).success);
  assert.ok(existsSync('src/app/api/documents/editor/[id]/route.ts'));
  assert.ok(existsSync('src/app/api/documents/editor/templates/route.ts'));
  // Next dá precedência ao segmento estático; o [id] continua sob o mesmo diretório, sem [tid] ao lado dele.
  assert.ok(!existsSync('src/app/api/documents/editor/[tid]'));
  const docRoute = readFileSync('src/app/api/documents/editor/[id]/route.ts', 'utf8');
  assert.match(docRoute, /export const GET = secureRoute/);
  assert.match(docRoute, /path: "\/api\/documents\/editor\/\[id\]"/);
});

test('visão do modelo expõe updatedAt (ISO) e nenhum uid de ator; PUT aceita description (strict, 0-1000)', async () => {
  const s = setup();
  const t = await mk(s, actor('author-uid-secreto', GEN));
  assert.equal(t.updatedAt, '2026-11-05T10:00:00.000Z');
  assert.ok(!JSON.stringify(t).includes('author-uid-secreto'));
  const { saveEditorTemplateBodySchema } = await import('../../../src/features/documents/editor/editor-api-schemas');
  const base = { expectedVersion: 1, clientRequestId: uuid(1), content: text('x') };
  assert.ok(saveEditorTemplateBodySchema.safeParse({ ...base, description: '' }).success);
  assert.ok(saveEditorTemplateBodySchema.safeParse({ ...base, name: 'n', description: 'd'.repeat(1000) }).success);
  assert.ok(!saveEditorTemplateBodySchema.safeParse({ ...base, description: 'd'.repeat(1001) }).success);
  assert.ok(!saveEditorTemplateBodySchema.safeParse({ ...base, descricao: 'x' }).success);
  const saved: any = await saveTemplateContent({ templateId: t.id, clientRequestId: uuid(2), expectedVersion: 1, content: text('Olá'), description: 'Desc' }, actor('x', GEN), s.deps);
  assert.deepEqual([saved.template.currentVersion, saved.template.description], [1, 'Desc']);
  assert.equal(await publicError(saveTemplateContent({ templateId: t.id, clientRequestId: uuid(2), expectedVersion: 1, content: text('Olá'), description: 'Outra' }, actor('x', GEN), s.deps)).then((e) => e?.code), 'EDITOR_TEMPLATE_REQUEST_ID_REUSED');
});
