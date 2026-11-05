import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createEditorDraft,
  editorDocumentId,
  getEditorContentVersion,
  getEditorDocument,
  saveEditorContent,
  finalizeEditorDocument,
  recordEditorPreviewResolved,
  EDITOR_DOCUMENTS_COLLECTION,
  EditorStoreError,
  type EditorStoreDeps,
} from '../../../src/features/documents/editor/document-store.server';
import { PERSON_SOURCES, sourceById } from '../../../src/features/privacy/person-inventory';

/** Fake mínimo do Firestore Admin (mapa por caminho). NÃO prova comportamento do emulador. */
function fakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const writes: string[] = [];
  const mkRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    async get() { const d = store.get(path); return { exists: d !== undefined, data: () => d }; },
    collection: (name: string) => ({ doc: (id: string) => mkRef(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id = 'auto') => mkRef(`${name}/${id}`) }),
    async runTransaction<T>(fn: (tx: any) => Promise<T>) {
      const pending: Array<[string, Record<string, unknown>, 'set' | 'create' | 'update']> = [];
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
        writes.push(path);
      }
      return result;
    },
  };
  return { db, store, writes };
}

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const base = { workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'req1', title: 'Carta' };
const setup = () => { const f = fakeDb(); const deps: EditorStoreDeps = { db: f.db as any, now: () => new Date('2026-11-05T10:00:00Z') }; return { ...f, deps }; };
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as EditorStoreError).code; } return null; };

test('cria rascunho: principal sem JSON, versão 1 imutável, auditoria e campos exigidos', async () => {
  const { deps, store, writes } = setup();
  const rec = await createEditorDraft({ ...base, content: doc('Olá') }, deps);
  const main = store.get(`editorDocuments/${rec.id}`)!;
  assert.equal(main.contentFormat, 'tiptap-json');
  assert.equal(main.contentVersion, 1);
  assert.equal(main.status, 'draft');
  assert.deepEqual(main.origin, { kind: 'editor', from: 'blank' });
  assert.equal(main.pipelineVersion, 'coala-editor-pipeline-v1');
  assert.equal(main.letterheadProfileId, 'coala-letterhead-v2');
  assert.equal(main.retentionPolicyId, 'fiscal_generation_date_pending');
  assert.equal(main.workspaceId, 'w1');
  assert.ok(!('content' in main), 'principal não guarda o JSON');
  assert.ok(!('storagePath' in main), 'sem storagePath');
  assert.equal(store.has(`editorDocuments/${rec.id}/contentVersions/1`), true);
  assert.equal(store.has(`editorDocuments/${rec.id}/audit/editor-created-v1`), true);
  assert.equal(writes.length, 3);
});

test('ator separado do titular; titular opcional e nunca derivado de texto', async () => {
  const { deps, store } = setup();
  const avulso = await createEditorDraft({ ...base, content: doc('CPF 123.456.789-09 João') }, deps);
  const a = store.get(`editorDocuments/${avulso.id}`)!;
  assert.equal(a.subject, null);
  assert.deepEqual(a.subjectKeys, []);
  assert.equal(a.generatedBy, 'actor1');
  const com = await createEditorDraft({ ...base, clientRequestId: 'req2', subject: { namespace: 'hr.employees', id: 'emp9' } }, deps);
  const c = store.get(`editorDocuments/${com.id}`)!;
  assert.deepEqual(c.subjectKeys, ['hr.employees:emp9']);
  assert.equal(c.generatedBy, 'actor1');
  assert.notEqual(c.generatedBy, (c.subject as any).id);
  assert.ok(!('partyKeys' in c) && !('archiveStatus' in c) && !('signatureScope' in c), 'sem campos do legado');
  assert.equal(await code(createEditorDraft({ ...base, clientRequestId: 'r3', subject: { namespace: 'x' as any, id: 'a' } }, deps)), 'invalid_input');
});

test('workspaceId obrigatório e isolamento entre workspaces', async () => {
  const { deps } = setup();
  assert.equal(await code(createEditorDraft({ ...base, workspaceId: '' }, deps)), 'invalid_input');
  const rec = await createEditorDraft(base, deps);
  assert.equal(await code(getEditorDocument(rec.id, 'outro', deps)), 'not_found');
  assert.equal(await code(saveEditorContent({ ...base, workspaceId: 'outro', documentId: rec.id, clientRequestId: 'x', expectedContentVersion: 1, content: doc('a') }, deps)), 'not_found');
});

test('salvar incrementa versão, preserva versões anteriores e atualiza ponteiro/auditoria', async () => {
  const { deps, store } = setup();
  const rec = await createEditorDraft({ ...base, content: doc('v1') }, deps);
  const saved = await saveEditorContent({ ...base, documentId: rec.id, actorId: 'revisor', clientRequestId: 's1', expectedContentVersion: 1, content: doc('v2') }, deps);
  assert.equal(saved.contentVersion, 2);
  assert.equal(saved.updatedBy, 'revisor');
  assert.equal(saved.createdBy, 'actor1');
  const main = store.get(`editorDocuments/${rec.id}`)!;
  assert.equal(main.contentVersion, 2);
  assert.equal(main.generatedBy, 'actor1');
  assert.ok(!('content' in main));
  const v1 = await getEditorContentVersion(rec.id, 'w1', deps, 1);
  const v2 = await getEditorContentVersion(rec.id, 'w1', deps);
  assert.equal((v1.content.content[0] as any).content[0].text, 'v1');
  assert.equal((v2.content.content[0] as any).content[0].text, 'v2');
  assert.equal(v2.savedBy, 'revisor');
  assert.equal(store.has(`editorDocuments/${rec.id}/audit/editor-saved-v2`), true);
  assert.equal(await code(getEditorContentVersion(rec.id, 'w1', deps, 3)), 'not_found');
});

test('conflito de versão não grava nada', async () => {
  const { deps, writes } = setup();
  const rec = await createEditorDraft(base, deps);
  await saveEditorContent({ ...base, documentId: rec.id, clientRequestId: 's1', expectedContentVersion: 1, content: doc('a') }, deps);
  const before = writes.length;
  const err = await saveEditorContent({ ...base, documentId: rec.id, clientRequestId: 's2', expectedContentVersion: 1, content: doc('b') }, deps).catch((e) => e);
  assert.equal(err.code, 'version_conflict');
  assert.equal(err.details.currentVersion, 2);
  assert.equal(writes.length, before);
});

test('idempotência: criar e salvar com o mesmo clientRequestId não duplicam', async () => {
  const { deps, writes } = setup();
  const a = await createEditorDraft({ ...base, content: doc('x') }, deps);
  const n = writes.length;
  const b = await createEditorDraft({ ...base, content: doc('x') }, deps);
  assert.equal(a.id, b.id);
  assert.equal(a.id, editorDocumentId('w1', 'actor1', 'req1'));
  assert.equal(writes.length, n);
  assert.equal(await code(createEditorDraft({ ...base, content: doc('y') }, deps)), 'idempotency_mismatch');
  const s1 = await saveEditorContent({ ...base, documentId: a.id, clientRequestId: 's1', expectedContentVersion: 1, content: doc('z') }, deps);
  const m = writes.length;
  const s2 = await saveEditorContent({ ...base, documentId: a.id, clientRequestId: 's1', expectedContentVersion: 1, content: doc('z') }, deps);
  assert.equal(s2.contentVersion, s1.contentVersion);
  assert.equal(writes.length, m);
  assert.equal(await code(saveEditorContent({ ...base, documentId: a.id, clientRequestId: 's1', expectedContentVersion: 1, content: doc('outro') }, deps)), 'idempotency_mismatch');
});

test('versão é imutável: create não sobrescreve uma versão existente', async () => {
  const { deps, store } = setup();
  const rec = await createEditorDraft(base, deps);
  // Corrompe o ponteiro para forçar a colisão com a versão 1 existente.
  const path = `editorDocuments/${rec.id}`;
  store.set(path, { ...store.get(path)!, contentVersion: 0 });
  const before = JSON.stringify(store.get(`${path}/contentVersions/1`));
  await assert.rejects(saveEditorContent({ ...base, documentId: rec.id, clientRequestId: 's9', expectedContentVersion: 0, content: doc('novo') } as any, deps));
  assert.equal(JSON.stringify(store.get(`${path}/contentVersions/1`)), before);
});

test('conteúdo inválido não persiste; só rascunho é editável', async () => {
  const { deps, store, writes } = setup();
  assert.equal(await code(createEditorDraft({ ...base, content: { type: 'doc', content: [{ type: 'script' }] } }, deps)), 'invalid_content');
  assert.equal(store.size, 0);
  const rec = await createEditorDraft(base, deps);
  const n = writes.length;
  assert.equal(await code(saveEditorContent({ ...base, documentId: rec.id, clientRequestId: 's1', expectedContentVersion: 1, content: { type: 'doc', content: [{ type: 'iframe' }] } }, deps)), 'invalid_content');
  assert.equal(writes.length, n);
  const path = `editorDocuments/${rec.id}`;
  store.set(path, { ...store.get(path)!, status: 'final' });
  assert.equal(await code(saveEditorContent({ ...base, documentId: rec.id, clientRequestId: 's2', expectedContentVersion: 1, content: doc('a') }, deps)), 'not_draft');
});

test('coleção própria: nada em generatedDocuments e fontes live de titular/ator', async () => {
  const { deps, store } = setup();
  const rec = await createEditorDraft({ ...base, subject: { namespace: 'hr.employees', id: 'emp9' } }, deps);
  assert.equal(EDITOR_DOCUMENTS_COLLECTION, 'editorDocuments');
  const src = readFileSync('src/features/documents/editor/document-store.server.ts', 'utf8');
  assert.ok(src.includes(`collection("${EDITOR_DOCUMENTS_COLLECTION}")`), 'literal do store igual à constante');
  assert.ok(!src.includes('generatedDocuments'));
  assert.ok([...store.keys()].every((k) => k.startsWith('editorDocuments/')));
  assert.ok(![...store.keys()].some((k) => k.includes('generatedDocuments')));
  assert.ok(store.has(`editorDocuments/${rec.id}`));
  const subj = sourceById('editor-documents')!;
  const actor = sourceById('editor-document-actors')!;
  assert.deepEqual([subj.collection, subj.field, subj.role, subj.namespace, subj.coverage], ['editorDocuments', 'subjectKeys', 'subject', 'subjectKeys', 'live']);
  assert.deepEqual([actor.collection, actor.field, actor.role, actor.namespace, actor.coverage], ['editorDocuments', 'generatedBy', 'actor', 'main.users', 'live']);
});

test('auditoria de prévia resolved: sem conteúdo, com ator/versão/subjectKeys; exige workspace do documento', async () => {
  const { deps, store } = setup();
  const rec = await createEditorDraft({ ...base, content: doc('CPF 123.456.789-09') }, deps);
  await recordEditorPreviewResolved({ documentId: rec.id, workspaceId: 'w1', actorId: 'revisor', version: 1, contentHash: rec.contentHash, subjectKeys: ['hr.employees:emp9'] }, deps);
  const events = [...store.entries()].filter(([k]) => k.includes('/audit/editor-preview_resolved-v1-'));
  assert.equal(events.length, 1);
  const ev = events[0][1];
  assert.equal(ev.type, 'editor.preview_resolved');
  assert.equal(ev.actorId, 'revisor');
  assert.deepEqual(ev.subjectKeys, ['hr.employees:emp9']);
  assert.ok(!JSON.stringify(ev).includes('123.456'));
  assert.ok(!('content' in ev));
  assert.equal(await code(recordEditorPreviewResolved({ documentId: rec.id, workspaceId: 'w2', actorId: 'x', version: 1, contentHash: 'h', subjectKeys: ['a:b'] }, deps)), 'not_found');
  assert.equal(await code(recordEditorPreviewResolved({ documentId: rec.id, workspaceId: 'w1', actorId: 'x', version: 1, contentHash: 'h', subjectKeys: [] }, deps)), 'invalid_input');
});

test('fontes de subcoleção: ator/titular live via collection group; documentId segue lacuna (não é pessoa)', () => {
  const gap = sourceById('editor-content-versions')!;
  assert.equal(gap.coverage, 'legacy_gap');
  assert.ok(gap.reason);
  for (const id of ['editor-content-version-savers', 'editor-audit-actors']) {
    const s = sourceById(id)!;
    assert.equal(s.coverage, 'live');
    assert.equal(s.parentCollection, 'editorDocuments');
  }
  assert.equal(sourceById('editor-content-versions')!.role, 'subject');
  assert.equal(sourceById('editor-content-version-savers')!.role, 'actor');
  assert.equal(sourceById('generated-documents')!.role, 'subject');
  assert.equal(sourceById('generated-document-actors')!.role, 'actor');
  assert.equal(new Set(PERSON_SOURCES.map((s) => s.id)).size, PERSON_SOURCES.length);
});

test('todo campo *By gravado pelo store de documentos tem fonte no inventário (live ator)', async () => {
  const { deps, store } = setup();
  const rec = await createEditorDraft(base, deps);
  await finalizeEditorDocument({ documentId: rec.id, workspaceId: 'w1', actorId: 'revisor', clientRequestId: 'f1', expectedContentVersion: 1, pdfStoragePath: 'generated-documents/standalone/x.pdf', pdfContentHash: 'h', originalName: 'x.pdf', employeeId: null, subject: null, subjectKeys: [] }, deps);
  const main = store.get(`editorDocuments/${rec.id}`)!;
  const byFields = Object.keys(main).filter((k) => /By$/.test(k));
  assert.deepEqual(byFields.sort(), ['createdBy', 'finalizedBy', 'generatedBy', 'updatedBy']);
  const live = new Set(PERSON_SOURCES.filter((s) => s.collection === 'editorDocuments' && s.role === 'actor' && s.namespace === 'main.users' && s.coverage === 'live').map((s) => s.field));
  for (const f of byFields) assert.ok(live.has(f), `campo ${f} sem fonte live no inventário`);
  const src = readFileSync('src/features/documents/editor/document-store.server.ts', 'utf8');
  for (const m of src.matchAll(/\b([a-z][A-Za-z]*By)\s*:/g)) assert.ok(m[1] === 'savedBy' || live.has(m[1]), `store grava ${m[1]} fora do inventário`);
  const savers = sourceById('editor-content-version-savers')!;
  assert.deepEqual([savers.field, savers.coverage], ['savedBy', 'live']);
});

test('inventário: subjectKeys de auditoria é fonte de TITULAR (live, collection group), separada do ator', () => {
  const s = sourceById('editor-audit-subjects')!;
  assert.deepEqual([s.collection, s.field, s.role, s.namespace, s.coverage], ['audit', 'subjectKeys', 'subject', 'subjectKeys', 'live']);
  assert.ok(s.reason);
  assert.equal(sourceById('editor-audit-actors')!.role, 'actor');
  assert.ok(!sourceById('editor-audit-actors')!.reason!.includes('sem titular'));
});
