import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NextRequest } from 'next/server';

import { createDraft, listDocuments, type EditorActor, type EditorApiDeps } from '../../../src/features/documents/editor/editor-api.server';
import { listEditorDocumentsQuerySchema } from '../../../src/features/documents/editor/editor-api-schemas';
import { createEditorEnforcer } from '../../../src/features/documents/editor/editor-route-security.server';
import { listEditorDocuments } from '../../../src/features/documents/editor/document-store.server';
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
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const text = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const publicError = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as AppError; } return null; };

function setup() {
  const f = fakeDb();
  let clock = Date.parse('2026-11-05T10:00:00Z');
  const store = { db: f.db as any, now: () => new Date((clock += 1000)) };
  const deps = { store } as unknown as EditorApiDeps & { store: any };
  (deps as any).rateLimit = () => ({ allowed: true, retryAfterSeconds: 0 });
  return { ...f, deps, store, rawStore: f.store };
}
const mk = (s: ReturnType<typeof setup>, who: EditorActor, n: number, title = `Doc ${n}`) => createDraft({ clientRequestId: uuid(n), title, content: text('x') }, who, s.deps);

function enforce(who: EditorActor, url: string) {
  const contract = defineSecurityContract({
    schemaVersion: 1, id: 'documents.editor.list.test', version: 1,
    surface: { method: 'GET', path: '/api/documents/editor' as any },
    exposure: 'authenticated', identity: { kind: 'active-user' }, authorization: { kind: 'custom', strategy: 'editor-list-test' },
    resourceScope: { kind: 'workspace' }, input: { kind: 'schema', schema: 'documents.editor.list.test', unknownFields: 'reject' },
    effects: { mode: 'read', audit: 'none' }, errorExposure: 'sanitized',
  });
  const enforcer = createEditorEnforcer(contract, { action: 'list', bodySchema: listEditorDocumentsQuerySchema, source: 'query', authenticate: async () => who });
  return enforcer.enforce({
    request: new NextRequest(url, { method: 'GET' }),
    routeContext: { params: Promise.resolve({}) }, observation: { requestId: 'r' }, contract,
  });
}
const BASE = 'http://localhost/api/documents/editor';

test('permissões: sem generate nega (403) antes de qualquer leitura; generate e review passam', async () => {
  const s = setup();
  assert.equal((await publicError(enforce(actor('x', {}), BASE)))?.httpStatus, 403);
  assert.ok(await enforce(actor('x', GEN), BASE));
  assert.ok(await enforce(actor('x', REV), BASE));
  assert.equal(s.reads.length, 0);
  // review sozinho (sem generate) também nega
  assert.equal((await publicError(enforce(actor('x', { review: true }), BASE)))?.httpStatus, 403);
  assert.equal((await publicError(listDocuments({}, actor('x', {}), s.deps)))?.httpStatus, 403);
  assert.equal(s.queries.length, 0);
});

test('enforcer: query estrita (status, limit 1-25, cursor, campos estranhos, repetidos) com 400 fixo', async () => {
  const ok = await enforce(actor('x', GEN), `${BASE}?status=final&limit=25&cursor=abc_-`);
  assert.deepEqual(ok.input.body, { status: 'final', limit: 25, cursor: 'abc_-' });
  for (const q of ['status=published', 'status=archived', 'limit=26', 'limit=0', 'limit=1.5', 'foo=1', 'limit=1&limit=2', 'cursor=a/b', 'subject=x', 'workspaceId=w2']) {
    const err = await publicError(enforce(actor('x', GEN), `${BASE}?${q}`));
    assert.equal(err?.httpStatus, 400, q);
    assert.equal(err?.code, 'EDITOR_INPUT_INVALID');
  }
});

test('só generate vê SOMENTE os próprios; review vê todos do workspace; filtro vai na consulta', async () => {
  const s = setup();
  await mk(s, actor('ana'), 1);
  await mk(s, actor('bia'), 2);
  await mk(s, actor('ana'), 3);
  const mine = await listDocuments({}, actor('ana', GEN), s.deps);
  assert.deepEqual(mine.items.map((i) => i.title).sort(), ['Doc 1', 'Doc 3']);
  assert.ok(mine.items.every((i) => i.isOwn));
  const last = JSON.parse(s.queries[s.queries.length - 1]);
  assert.deepEqual(last.filters, [['workspaceId', 'w1'], ['generatedBy', 'ana']]);
  const all = await listDocuments({}, actor('rev', REV), s.deps);
  assert.equal(all.items.length, 3);
  assert.deepEqual(all.items.map((i) => i.isOwn), [false, false, false]);
  assert.deepEqual(JSON.parse(s.queries[s.queries.length - 1]).filters, [['workspaceId', 'w1']]);
  assert.deepEqual(all.items.map((i) => i.title), ['Doc 3', 'Doc 2', 'Doc 1'], 'mais recentes primeiro');
  // revisor que também é autor vê isOwn nos seus
  const ana = await listDocuments({}, actor('ana', REV), s.deps);
  assert.deepEqual(ana.items.map((i) => i.isOwn), [true, false, true]);
});

test('isolamento de workspace: nem review enxerga documento de outro workspace', async () => {
  const s = setup();
  await mk(s, actor('ana', GEN, 'w1'), 1);
  await mk(s, actor('zed', GEN, 'w2'), 2);
  assert.deepEqual((await listDocuments({}, actor('rev', REV, 'w1'), s.deps)).items.map((i) => i.title), ['Doc 1']);
  assert.deepEqual((await listDocuments({}, actor('rev', REV, 'w2'), s.deps)).items.map((i) => i.title), ['Doc 2']);
  assert.equal((await listDocuments({}, actor('rev', REV, 'w3'), s.deps)).items.length, 0);
});

test('status filtra na consulta; draft e final', async () => {
  const s = setup();
  const a = await mk(s, actor('ana'), 1);
  await mk(s, actor('ana'), 2);
  // marca um como final direto no fake (o store de finalização é coberto em outro teste)
  const key = `editorDocuments/${a.id}`;
  s.rawStore.set(key, { ...s.rawStore.get(key)!, status: 'final', finalizedAt: new Date('2026-11-06T00:00:00Z') });
  const fin = await listDocuments({ status: 'final' }, actor('rev', REV), s.deps);
  assert.deepEqual(fin.items.map((i) => i.id), [a.id]);
  assert.equal(fin.items[0].finalizedAt, '2026-11-06T00:00:00.000Z');
  const dr = await listDocuments({ status: 'draft' }, actor('rev', REV), s.deps);
  assert.equal(dr.items.length, 1);
  assert.ok(!('finalizedAt' in dr.items[0]));
  assert.equal((await publicError(listDocuments({ status: 'archived' as any }, actor('rev', REV), s.deps)))?.code, 'EDITOR_INPUT_INVALID');
});

test('paginação por cursor: limit+1 leituras, sem repetir nem pular; cursor inválido => 400 fixo', async () => {
  const s = setup();
  for (let i = 1; i <= 5; i++) await mk(s, actor('ana'), i);
  s.reads.length = 0;
  const p1 = await listDocuments({ limit: 2 }, actor('rev', REV), s.deps);
  assert.equal(p1.items.length, 2);
  assert.ok(p1.nextCursor);
  assert.ok(s.reads.length <= 3, 'limit+1 leituras');
  const p2 = await listDocuments({ limit: 2, cursor: p1.nextCursor! }, actor('rev', REV), s.deps);
  const p3 = await listDocuments({ limit: 2, cursor: p2.nextCursor! }, actor('rev', REV), s.deps);
  assert.equal(p3.nextCursor, null);
  const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.title);
  assert.deepEqual(ids, ['Doc 5', 'Doc 4', 'Doc 3', 'Doc 2', 'Doc 1']);
  const huge = await listDocuments({ limit: 25 }, actor('rev', REV), s.deps);
  assert.equal(huge.items.length, 5);
  assert.match(s.queries[s.queries.length - 1], /"lim":26/);
  const bad = [
    'não-base64', Buffer.from('x').toString('base64url'), Buffer.from(JSON.stringify([9e15, 'ed_' + 'a'.repeat(32)])).toString('base64url'),
    Buffer.from(JSON.stringify([1, 'tpl_' + 'a'.repeat(32)])).toString('base64url'), Buffer.from(JSON.stringify([1.5, 'ed_' + 'a'.repeat(32)])).toString('base64url'),
    Buffer.from(JSON.stringify({ a: 1 })).toString('base64url'),
  ];
  for (const cursor of bad) {
    const err = await publicError(listDocuments({ cursor }, actor('rev', REV), s.deps));
    assert.equal(err?.httpStatus, 400, cursor);
    assert.equal(err?.code, 'EDITOR_INPUT_INVALID');
    assert.ok(!JSON.stringify(err?.safeMessage).includes(cursor));
  }
  assert.equal(await listEditorDocuments({ workspaceId: 'w1', limit: 0 }, s.store).catch((e) => e.code), 'invalid_input');
});

test('visão pública: sem uid de ator, titular, chaves, funcionário, caminho; origem resumida', async () => {
  const s = setup();
  const d = await mk(s, actor('ana'), 1, 'Sigilo');
  const key = `editorDocuments/${d.id}`;
  s.rawStore.set(key, {
    ...s.rawStore.get(key)!,
    subject: { namespace: 'hr.employees', id: 'EMP-SECRETO' }, subjectKeys: ['hr.employees:EMP-SECRETO'], employeeId: 'EMP-SECRETO',
    pdfStoragePath: 'secret/path.pdf', pdfContentHash: 'h',
    origin: { kind: 'editor_template', templateId: 'tpl_' + 'b'.repeat(32), templateVersion: 3, templateContentHash: 'c'.repeat(64) },
  });
  const page = await listDocuments({}, actor('rev', REV), s.deps);
  const item = page.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['contentVersion', 'id', 'isOwn', 'origin', 'status', 'title', 'updatedAt']);
  assert.deepEqual(item.origin, { kind: 'editor_template', templateId: 'tpl_' + 'b'.repeat(32), templateVersion: 3 });
  const json = JSON.stringify(page);
  for (const forbidden of ['ana', 'EMP-SECRETO', 'subject', 'secret/path', 'generatedBy', 'createdBy', 'pdfStoragePath', 'templateContentHash', 'hasFields']) {
    assert.ok(!json.includes(forbidden), forbidden);
  }
  const blank = (await listDocuments({}, actor('ana', GEN), s.deps)).items[0];
  assert.equal(blank.updatedAt, '2026-11-05T10:00:01.000Z');
});

test('GET da listagem não tem efeito colateral: nenhuma escrita, leituras <= limit+1', async () => {
  const s = setup();
  for (let i = 1; i <= 3; i++) await mk(s, actor('ana'), i);
  const w = s.writes.length;
  s.reads.length = 0;
  await listDocuments({ limit: 25 }, actor('rev', REV), s.deps);
  await listDocuments({ status: 'draft' }, actor('ana', GEN), s.deps);
  assert.equal(s.writes.length, w);
  assert.ok(s.reads.length <= 6);
});

test('rota GET: secureRoute, contrato de leitura sem exceção registrada, sem polling/listener/get() de coleção', () => {
  const src = readFileSync('src/app/api/documents/editor/route.ts', 'utf8');
  assert.match(src, /export const GET = secureRoute\(/);
  assert.match(src, /path: "\/api\/documents\/editor"/);
  assert.match(src, /effects: \{ mode: "read", audit: "none" \}/);
  assert.doesNotMatch(src, /error\.message|\.stack|\.cause/);
  const store = readFileSync('src/features/documents/editor/document-store.server.ts', 'utf8');
  assert.doesNotMatch(store, /onSnapshot|setInterval/);
  assert.ok(!readFileSync('config/security-contract-exceptions.json', 'utf8').includes('documents/editor'));
  assert.ok(!readFileSync('src/features/documents/editor/document-store.server.ts', 'utf8').includes('generatedDocuments'));
});

test('índices: os 4 compostos de editorDocuments existem no banco coala', () => {
  const idx = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes.filter((i: any) => i.collectionGroup === 'editorDocuments');
  const sig = idx.map((i: any) => i.fields.map((f: any) => `${f.fieldPath}:${f.order[0]}`).join(','));
  assert.deepEqual(sig.sort(), [
    'workspaceId:A,generatedBy:A,status:A,updatedAt:D',
    'workspaceId:A,generatedBy:A,updatedAt:D',
    'workspaceId:A,status:A,updatedAt:D',
    'workspaceId:A,updatedAt:D',
  ].sort());
  assert.ok(idx.every((i: any) => i.queryScope === 'COLLECTION'));
});
