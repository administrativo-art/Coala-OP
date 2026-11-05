import assert from 'node:assert/strict';
import test from 'node:test';

import { collectEditorFieldKeys, parseEditorContent } from '../../../src/features/documents/editor/content-schema';
import { createEditorDraft, type EditorStoreDeps } from '../../../src/features/documents/editor/document-store.server';
import { EDITOR_TEMPLATES_COLLECTION, parseEditorOrigin } from '../../../src/features/documents/editor/document-store.types';
import {
  archiveEditorTemplateBodySchema,
  createEditorTemplateBodySchema,
  editorTemplateIdSchema,
  publishEditorTemplateBodySchema,
  saveEditorTemplateBodySchema,
  useEditorTemplateBodySchema,
} from '../../../src/features/documents/editor/editor-api-schemas';

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const tplA = `tpl_${'0'.repeat(32)}`;
const tplB = `tpl_${'1'.repeat(32)}`;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const mkRef = (path: string): any => ({
    id: path.split('/').pop(), path,
    async get() { const d = store.get(path); return { exists: d !== undefined, data: () => d }; },
    collection: (name: string) => ({ doc: (id: string) => mkRef(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id = 'auto') => mkRef(`${name}/${id}`) }),
    async runTransaction<T>(fn: (tx: any) => Promise<T>) {
      const pending: Array<[string, Record<string, unknown>]> = [];
      const tx = { get: (r: any) => r.get(), set: (r: any, d: any) => pending.push([r.path, d]), create: (r: any, d: any) => pending.push([r.path, d]), update: (r: any, d: any) => pending.push([r.path, d]) };
      const result = await fn(tx);
      for (const [p, d] of pending) store.set(p, d);
      return result;
    },
  };
  const deps: EditorStoreDeps = { db: db as any, now: () => new Date('2026-11-05T10:00:00Z') };
  return { store, deps };
}
const base = { workspaceId: 'w1', actorId: 'a1', clientRequestId: 'req1', title: 'Carta', content: doc('x') };
const tplOrigin = (templateId = tplA, templateContentHash = hashA, templateVersion = 2) => ({ kind: 'editor_template' as const, templateId, templateVersion, templateContentHash });
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { code: string }).code; } return null; };

test('coleção do modelo é literal editorTemplates', () => {
  assert.equal(EDITOR_TEMPLATES_COLLECTION, 'editorTemplates');
});

test('schemas do modelo: strict, limites e id tpl_', () => {
  assert.ok(editorTemplateIdSchema.safeParse(tplA).success);
  assert.ok(!editorTemplateIdSchema.safeParse('ed_' + '0'.repeat(32)).success);
  assert.ok(!editorTemplateIdSchema.safeParse(tplA.toUpperCase()).success);
  assert.ok(!editorTemplateIdSchema.safeParse(tplA + '0').success);

  assert.ok(createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: 'M' }).success);
  assert.ok(createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: ' M ', description: 'd', content: doc('a') }).success);
  assert.ok(!createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: '   ' }).success);
  assert.ok(!createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: 'x'.repeat(201) }).success);
  assert.ok(!createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: 'M', description: 'x'.repeat(1001) }).success);
  assert.ok(!createEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, name: 'M', workspaceId: 'w' }).success);
  assert.ok(!createEditorTemplateBodySchema.safeParse({ clientRequestId: 'x', name: 'M' }).success);

  assert.ok(saveEditorTemplateBodySchema.safeParse({ expectedVersion: 1, clientRequestId: uuid, content: doc('a') }).success);
  assert.ok(saveEditorTemplateBodySchema.safeParse({ expectedVersion: 1, clientRequestId: uuid, content: doc('a'), name: 'N' }).success);
  assert.ok(!saveEditorTemplateBodySchema.safeParse({ expectedVersion: 0, clientRequestId: uuid, content: doc('a') }).success);
  assert.ok(!saveEditorTemplateBodySchema.safeParse({ expectedVersion: 1, clientRequestId: uuid }).success);

  for (const s of [publishEditorTemplateBodySchema, archiveEditorTemplateBodySchema]) {
    assert.ok(s.safeParse({ clientRequestId: uuid, expectedVersion: 3 }).success);
    assert.ok(!s.safeParse({ clientRequestId: uuid }).success);
    assert.ok(!s.safeParse({ clientRequestId: uuid, expectedVersion: 3, extra: 1 }).success);
  }
  assert.ok(useEditorTemplateBodySchema.safeParse({ clientRequestId: uuid }).success);
  assert.ok(useEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, expectedPublishedVersion: 2 }).success);
  assert.ok(!useEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, subject: {} }).success);
  assert.ok(!useEditorTemplateBodySchema.safeParse({ clientRequestId: uuid, expectedPublishedVersion: 1.5 }).success);
});

test('fieldKeys: únicas, ordenadas, em tabelas e listas; vazio sem campos', () => {
  const f = (key: string) => ({ type: 'documentField', attrs: { key } });
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [f('employee.name'), { type: 'text', text: ' ' }, f('employee.cpf'), f('employee.name')] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [f('employee.cpf')] }] }] },
    ],
  };
  const parsed = parseEditorContent(content);
  assert.ok(parsed.ok);
  assert.deepEqual(collectEditorFieldKeys(parsed.content), ['employee.cpf', 'employee.name']);
  const plain = parseEditorContent(doc('s'));
  assert.ok(plain.ok);
  assert.deepEqual(collectEditorFieldKeys(plain.content), []);
});

test('origin: aceita legado e modelo, rejeita o restante', () => {
  assert.deepEqual(parseEditorOrigin({ kind: 'editor', from: 'blank' }), { kind: 'editor', from: 'blank' });
  assert.deepEqual(parseEditorOrigin(tplOrigin()), tplOrigin());
  for (const bad of [null, 'x', {}, { kind: 'editor' }, { kind: 'editor', from: 'blank', x: 1 }, { ...tplOrigin(), extra: 1 },
    tplOrigin('ed_abc'), tplOrigin(tplA, 'zz'), tplOrigin(tplA, hashA, 0), tplOrigin(tplA, hashA, 1.5), { kind: 'other' }]) {
    assert.equal(parseEditorOrigin(bad), null);
  }
});

test('createEditorDraft: sem origin grava legado; com modelo grava origin e rejeita origin inválido', async () => {
  const a = fakeDb();
  const rec = await createEditorDraft(base, a.deps);
  assert.deepEqual(a.store.get(`editorDocuments/${rec.id}`)!.origin, { kind: 'editor', from: 'blank' });

  const b = fakeDb();
  const rec2 = await createEditorDraft({ ...base, origin: tplOrigin() }, b.deps);
  assert.deepEqual(b.store.get(`editorDocuments/${rec2.id}`)!.origin, tplOrigin());
  assert.equal(b.store.get(`editorDocuments/${rec2.id}`)!.subject, null);

  assert.equal(await code(createEditorDraft({ ...base, origin: { kind: 'editor_template', templateId: 'x' } as any }, fakeDb().deps)), 'invalid_input');
});

test('idempotência: mesmo pedido com modelo repete; outro modelo/hash/versão ou sem modelo => idempotency_mismatch', async () => {
  const { deps } = fakeDb();
  const first = await createEditorDraft({ ...base, origin: tplOrigin() }, deps);
  const replay = await createEditorDraft({ ...base, origin: tplOrigin() }, deps);
  assert.equal(replay.id, first.id);
  assert.equal(await code(createEditorDraft({ ...base, origin: tplOrigin(tplB) }, deps)), 'idempotency_mismatch');
  assert.equal(await code(createEditorDraft({ ...base, origin: tplOrigin(tplA, hashB) }, deps)), 'idempotency_mismatch');
  assert.equal(await code(createEditorDraft({ ...base, origin: tplOrigin(tplA, hashA, 3) }, deps)), 'idempotency_mismatch');
  assert.equal(await code(createEditorDraft(base, deps)), 'idempotency_mismatch');
});

test('hash legado inalterado: documento existente sem origin de modelo repete com o mesmo pedido', async () => {
  const { deps } = fakeDb();
  const first = await createEditorDraft(base, deps);
  const replay = await createEditorDraft({ ...base, origin: { kind: 'editor', from: 'blank' } }, deps);
  assert.equal(replay.id, first.id);
});
