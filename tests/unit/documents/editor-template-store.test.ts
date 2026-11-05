import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { collectEditorFieldKeys, hashEditorContent, parseEditorContent } from '../../../src/features/documents/editor/content-schema';
import { createEditorDraft, getEditorContentVersion } from '../../../src/features/documents/editor/document-store.server';
import {
  EDITOR_TEMPLATES_COLLECTION,
  type EditorTemplateStoreDeps,
} from '../../../src/features/documents/editor/document-store.types';
import {
  archiveEditorTemplate,
  createEditorTemplate,
  editorTemplateId,
  getEditorTemplate,
  getEditorTemplateVersion,
  listEditorTemplates,
  publishEditorTemplate,
  saveEditorTemplateContent,
  useEditorTemplate,
} from '../../../src/features/documents/editor/template-store.server';
import { PERSON_SOURCES, sourceById } from '../../../src/features/privacy/person-inventory';

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

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const withField = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá ' }, { type: 'documentField', attrs: { key: 'employee.name' } }] }] };
let clock = 0;
const setup = () => {
  const f = fakeDb();
  clock = Date.parse('2026-11-05T10:00:00Z');
  const deps: EditorTemplateStoreDeps = { db: f.db as any, now: () => new Date((clock += 1000)) };
  return { ...f, deps };
};
const base = { workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'req1', name: 'Carta modelo' };
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { code: string }).code; } return null; };
const mk = (deps: EditorTemplateStoreDeps, over: Record<string, unknown> = {}) => createEditorTemplate({ ...base, content: doc('Texto'), ...over } as any, deps);
const published = async (deps: EditorTemplateStoreDeps, over: Record<string, unknown> = {}) => {
  const t = await mk(deps, over);
  return publishEditorTemplate({ templateId: t.id, workspaceId: t.workspaceId, actorId: 'actor1', clientRequestId: 'p1', expectedVersion: 1 }, deps);
};

test('cria rascunho v1: principal sem JSON, versão imutável, auditoria, fieldKeys e id determinístico', async () => {
  const { deps, store, writes } = setup();
  const rec = await mk(deps, { content: withField, description: ' d ' });
  assert.match(rec.id, /^tpl_[0-9a-f]{32}$/);
  assert.equal(rec.id, editorTemplateId('w1', 'actor1', 'req1'));
  assert.deepEqual([rec.status, rec.currentVersion, rec.publishedVersion, rec.description], ['draft', 1, null, 'd']);
  assert.deepEqual(rec.fieldKeys, collectEditorFieldKeys(withField as any));
  assert.ok(rec.fieldKeys.length > 0);
  const main = store.get(`editorTemplates/${rec.id}`)!;
  assert.ok(!('content' in main));
  assert.ok(!('subject' in main) && !('subjectKeys' in main), 'modelo não tem titular');
  assert.equal(main.createdBy, 'actor1');
  const v1 = store.get(`editorTemplates/${rec.id}/versions/1`)!;
  assert.equal(v1.savedBy, 'actor1');
  assert.equal(v1.contentHash, main.contentHash);
  const audit = store.get(`editorTemplates/${rec.id}/audit/template-created-v1`)!;
  assert.equal(audit.actorId, 'actor1');
  assert.ok(!('content' in audit));
  assert.equal(writes.length, 3);
});

test('modelo em branco quando content é omitido e conteúdo inválido é recusado', async () => {
  const { deps } = setup();
  const rec = await createEditorTemplate(base, deps);
  assert.equal(rec.currentVersion, 1);
  assert.equal(await code(mk(deps, { clientRequestId: 'x', content: { type: 'doc', content: [{ type: 'script' }] } })), 'invalid_content');
  assert.equal(await code(mk(deps, { clientRequestId: 'y', name: '  ' })), 'invalid_input');
  assert.equal(await code(mk(deps, { clientRequestId: 'z', workspaceId: '' })), 'invalid_input');
  assert.equal(await code(mk(deps, { clientRequestId: 'w', fromDocument: { documentId: 'ed_x', version: 1 } })), 'invalid_input');
});

test('replay idempotente de criação e mismatch de idempotência', async () => {
  const { deps, writes } = setup();
  const a = await mk(deps);
  const n = writes.length;
  const b = await mk(deps);
  assert.equal(a.id, b.id);
  assert.equal(writes.length, n);
  assert.equal(await code(mk(deps, { content: doc('Outro') })), 'idempotency_mismatch');
  assert.equal(await code(mk(deps, { name: 'Outro nome' })), 'idempotency_mismatch');
});

test('criar a partir de documento do editor copia a versão pedida; outro workspace/versão inexistente = não encontrado', async () => {
  const { deps, store } = setup();
  const d = await createEditorDraft({ workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'd1', title: 'Doc', content: doc('Original') }, deps as any);
  const t = await createEditorTemplate({ ...base, fromDocument: { documentId: d.id, version: 1 } }, deps);
  const v = await getEditorTemplateVersion(t.id, 'w1', deps);
  assert.equal(v.contentHash, d.contentHash);
  assert.equal(await code(createEditorTemplate({ ...base, workspaceId: 'w2', clientRequestId: 'r2', fromDocument: { documentId: d.id, version: 1 } }, deps)), 'not_found');
  assert.equal(await code(createEditorTemplate({ ...base, clientRequestId: 'r3', fromDocument: { documentId: d.id, version: 2 } }, deps)), 'not_found');
  assert.equal(await code(createEditorTemplate({ ...base, clientRequestId: 'r4', fromDocument: { documentId: 'ed_naoexiste', version: 1 } }, deps)), 'not_found');
  const again = await createEditorTemplate({ ...base, fromDocument: { documentId: d.id, version: 1 } }, deps);
  assert.equal(again.id, t.id);
  assert.equal(await code(createEditorTemplate({ ...base, content: doc('Original') }, deps)), 'idempotency_mismatch');
  assert.ok(![...store.keys()].some((k) => k.startsWith('editorDocuments/') && k.includes('/audit/') && k.includes('template')));
});

test('salvar cria versão nova imutável, preserva anteriores e conflita com versão velha', async () => {
  const { deps, store, writes } = setup();
  const t = await mk(deps);
  const s = await saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w1', actorId: 'revisor', clientRequestId: 's1', expectedVersion: 1, content: withField, name: 'Novo nome' }, deps);
  assert.deepEqual([s.currentVersion, s.updatedBy, s.createdBy, s.name], [2, 'revisor', 'actor1', 'Novo nome']);
  assert.deepEqual(s.fieldKeys, ['employee.name']);
  assert.equal((await getEditorTemplateVersion(t.id, 'w1', deps, 1)).content.content.length, 1);
  assert.equal((await getEditorTemplateVersion(t.id, 'w1', deps, 1)).savedBy, 'actor1');
  assert.equal((await getEditorTemplateVersion(t.id, 'w1', deps)).savedBy, 'revisor');
  assert.equal(store.has(`editorTemplates/${t.id}/audit/template-saved-v2`), true);
  const before = writes.length;
  const err = await saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's2', expectedVersion: 1, content: doc('b') }, deps).catch((e) => e);
  assert.equal(err.code, 'version_conflict');
  assert.equal(err.details.currentVersion, 2);
  assert.equal(writes.length, before);
  // replay do último salvamento e reuso indevido da chave
  const replay = await saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w1', actorId: 'revisor', clientRequestId: 's1', expectedVersion: 1, content: withField }, deps);
  assert.equal(replay.currentVersion, 2);
  assert.equal(writes.length, before);
  assert.equal(await code(saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w1', actorId: 'revisor', clientRequestId: 's1', expectedVersion: 1, content: doc('zzz') }, deps)), 'idempotency_mismatch');
  assert.equal(await code(saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's9', expectedVersion: 2, content: { type: 'x' } }, deps)), 'invalid_content');
});

test('publicar move só o ponteiro, audita e é idempotente; salvar depois não altera a versão publicada', async () => {
  const { deps, store, writes } = setup();
  const p = await published(deps);
  assert.deepEqual([p.status, p.publishedVersion, p.currentVersion], ['published', 1, 1]);
  assert.equal(store.has(`editorTemplates/${p.id}/audit/template-published-v1`), true);
  const n = writes.length;
  const again = await publishEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'p2', expectedVersion: 1 }, deps);
  assert.equal(again.publishedVersion, 1);
  assert.equal(writes.length, n);
  const s = await saveEditorTemplateContent({ templateId: p.id, workspaceId: 'w1', actorId: 'actor1', clientRequestId: 's1', expectedVersion: 1, content: doc('v2') }, deps);
  assert.deepEqual([s.status, s.publishedVersion, s.currentVersion], ['published', 1, 2]);
  assert.equal(await code(publishEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'p3', expectedVersion: 1 }, deps)), 'version_conflict');
  const p2 = await publishEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'p3', expectedVersion: 2 }, deps);
  assert.equal(p2.publishedVersion, 2);
});

test('modelo vazio não publica; conteúdo adulterado no armazenamento é recusado', async () => {
  const { deps, store } = setup();
  const empty = await createEditorTemplate(base, deps);
  assert.equal(await code(publishEditorTemplate({ templateId: empty.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'invalid_content');
  const blanks = await mk(deps, { clientRequestId: 'b', content: doc('   ') });
  assert.equal(await code(publishEditorTemplate({ templateId: blanks.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'invalid_content');
  const t = await mk(deps, { clientRequestId: 'c' });
  store.set(`editorTemplates/${t.id}/versions/1`, { ...store.get(`editorTemplates/${t.id}/versions/1`)!, content: { type: 'doc', content: [{ type: 'script' }] } });
  assert.equal(await code(publishEditorTemplate({ templateId: t.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'invalid_content');
});

test('arquivar mantém tudo, bloqueia edição/publicação/uso e é idempotente', async () => {
  const { deps, store } = setup();
  const p = await published(deps);
  const keysBefore = [...store.keys()];
  assert.equal(await code(archiveEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'a1', expectedVersion: 5 }, deps)), 'version_conflict');
  const a = await archiveEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'chefe', clientRequestId: 'a1', expectedVersion: 1 }, deps);
  assert.equal(a.status, 'archived');
  assert.equal(a.publishedVersion, 1);
  for (const k of keysBefore) assert.ok(store.has(k), 'nada é apagado');
  assert.equal(store.get(`editorTemplates/${p.id}`)!.archivedBy, 'chefe');
  assert.equal(store.has(`editorTemplates/${p.id}/audit/template-archived-v1`), true);
  assert.equal((await archiveEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'chefe', clientRequestId: 'a2', expectedVersion: 1 }, deps)).status, 'archived');
  assert.equal(await code(saveEditorTemplateContent({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's', expectedVersion: 1, content: doc('x') }, deps)), 'template_archived');
  assert.equal(await code(publishEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'template_archived');
  const draft = await mk(deps, { clientRequestId: 'd' });
  assert.equal((await archiveEditorTemplate({ templateId: draft.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'a3', expectedVersion: 1 }, deps)).status, 'archived');
});

test('obter e isolamento por workspace: outro workspace = não encontrado em todas as operações', async () => {
  const { deps } = setup();
  const t = await mk(deps);
  assert.equal((await getEditorTemplate(t.id, 'w1', deps)).name, 'Carta modelo');
  assert.equal(await code(getEditorTemplate(t.id, 'w2', deps)), 'not_found');
  assert.equal(await code(getEditorTemplateVersion(t.id, 'w2', deps)), 'not_found');
  assert.equal(await code(getEditorTemplateVersion(t.id, 'w1', deps, 2)), 'not_found');
  assert.equal(await code(saveEditorTemplateContent({ templateId: t.id, workspaceId: 'w2', actorId: 'a', clientRequestId: 's', expectedVersion: 1, content: doc('x') }, deps)), 'not_found');
  assert.equal(await code(publishEditorTemplate({ templateId: t.id, workspaceId: 'w2', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'not_found');
  assert.equal(await code(archiveEditorTemplate({ templateId: t.id, workspaceId: 'w2', actorId: 'a', clientRequestId: 'p', expectedVersion: 1 }, deps)), 'not_found');
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w2', actorId: 'a', templateId: t.id, clientRequestId: 'u' }, deps)), 'not_found');
  assert.equal(await code(getEditorTemplate('tpl_zz', 'w1', deps)), 'invalid_input');
});

test('listar: filtro de workspace e status, limite máximo 25, cursor sem repetir e sem varrer a coleção', async () => {
  const { deps, queries, reads } = setup();
  for (let i = 0; i < 30; i++) await mk(deps, { clientRequestId: `r${i}`, name: `M${i}` });
  await mk(deps, { workspaceId: 'w2', clientRequestId: 'o', name: 'Outro WS' });
  const archived = await mk(deps, { clientRequestId: 'arq', name: 'Arquivado' });
  await archiveEditorTemplate({ templateId: archived.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'x', expectedVersion: 1 }, deps);

  const p1 = await listEditorTemplates({ workspaceId: 'w1', status: 'draft', limit: 100 }, deps);
  assert.equal(p1.items.length, 25);
  assert.ok(p1.nextCursor);
  assert.ok(p1.items.every((i) => i.workspaceId === 'w1' && i.status === 'draft'));
  assert.ok(JSON.parse(queries.at(-1)!).lim === 26, 'busca limit+1');
  const p2 = await listEditorTemplates({ workspaceId: 'w1', status: 'draft', limit: 25, cursor: p1.nextCursor! }, deps);
  assert.equal(p2.items.length, 5);
  assert.equal(p2.nextCursor, null);
  const ids = [...p1.items, ...p2.items].map((i) => i.id);
  assert.equal(new Set(ids).size, 30);
  assert.ok(!ids.includes(archived.id));
  assert.equal(p1.items[0].name, 'M29', 'mais recentes primeiro');

  const only = await listEditorTemplates({ workspaceId: 'w1', status: 'archived' }, deps);
  assert.deepEqual(only.items.map((i) => i.id), [archived.id]);
  const all = await listEditorTemplates({ workspaceId: 'w1', limit: 3 }, deps);
  assert.equal(all.items.length, 3);
  assert.equal((await listEditorTemplates({ workspaceId: 'w2' }, deps)).items.length, 1);
  assert.deepEqual(JSON.parse(queries.at(-1)!).filters, [['workspaceId', 'w2']]);
  const before = reads.length;
  await listEditorTemplates({ workspaceId: 'w1', limit: 2 }, deps);
  assert.equal(reads.length - before, 3, 'no máximo limit+1 leituras');
  assert.equal(await code(listEditorTemplates({ workspaceId: 'w1', limit: 0 }, deps)), 'invalid_input');
  assert.equal(await code(listEditorTemplates({ workspaceId: 'w1', status: 'x' as any }, deps)), 'invalid_input');
  assert.equal(await code(listEditorTemplates({ workspaceId: 'w1', cursor: 'lixo' }, deps)), 'invalid_input');
  assert.equal(await code(listEditorTemplates({ workspaceId: '' }, deps)), 'invalid_input');
});

test('usar: cria documento em rascunho sem titular, com origem, conteúdo/hash da versão publicada e auditorias', async () => {
  const { deps, store, writes } = setup();
  const p = await published(deps, { content: withField });
  // versão nova não publicada não pode vazar para o uso
  await saveEditorTemplateContent({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's1', expectedVersion: 1, content: doc('NAO PUBLICADO') }, deps);
  const before = writes.length;
  const rec = await useEditorTemplate({ workspaceId: 'w1', actorId: 'usuario', templateId: p.id, clientRequestId: 'u1', expectedPublishedVersion: 1 }, deps);
  assert.equal(writes.length - before, 4);
  const main = store.get(`editorDocuments/${rec.id}`)!;
  const expectedHash = hashEditorContent(withField as any);
  assert.deepEqual(main.origin, { kind: 'editor_template', templateId: p.id, templateVersion: 1, templateContentHash: expectedHash });
  assert.equal(main.status, 'draft');
  assert.equal(main.subject, null);
  assert.deepEqual(main.subjectKeys, []);
  assert.equal(main.contentHash, expectedHash);
  assert.equal(main.generatedBy, 'usuario');
  assert.equal(main.title, 'Carta modelo');
  assert.equal(main.workspaceId, 'w1');
  const v = await getEditorContentVersion(rec.id, 'w1', deps as any);
  assert.equal(v.contentHash, expectedHash);
  assert.deepEqual(v.content, withField);
  assert.equal(store.has(`editorDocuments/${rec.id}/audit/editor-created-v1`), true);
  const used = store.get(`editorTemplates/${p.id}/audit/template-used-v1-${rec.id}`)!;
  assert.equal(used.type, 'editor_template.used');
  assert.equal(used.actorId, 'usuario');
  assert.equal(used.documentId, rec.id);
  assert.ok(!('content' in used));
  assert.equal(store.get(`editorTemplates/${p.id}`)!.currentVersion, 2, 'usar não altera o modelo');
  assert.ok(![...store.keys()].some((k) => k.startsWith('editorTemplates/') && k.split('/').length === 2 && k !== `editorTemplates/${p.id}`), 'usar não cria modelo implícito');
});

test('usar: replay idempotente (inclusive após arquivar), reuso da chave com outro modelo e conflitos fixos', async () => {
  const { deps, writes } = setup();
  const p = await published(deps);
  const a = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u1' }, deps);
  const n = writes.length;
  const b = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u1' }, deps);
  assert.equal(a.id, b.id);
  assert.equal(writes.length, n);
  const other = await published(deps, { clientRequestId: 'o', name: 'Outro' });
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: other.id, clientRequestId: 'u1' }, deps)), 'idempotency_mismatch');
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u2', expectedPublishedVersion: 7 }, deps)), 'published_version_mismatch');
  const draft = await mk(deps, { clientRequestId: 'dd' });
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: draft.id, clientRequestId: 'u3' }, deps)), 'template_not_published');
  await archiveEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'ar', expectedVersion: 1 }, deps);
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u4' }, deps)), 'template_archived');
  const replayed = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u1' }, deps);
  assert.equal(replayed.id, a.id, 'replay devolve o documento já criado');
});

test('usar: falha no meio não deixa escrita parcial e conteúdo adulterado é recusado', async () => {
  const { deps, store, writes } = setup();
  const p = await published(deps);
  store.set(`editorTemplates/${p.id}/versions/1`, { ...store.get(`editorTemplates/${p.id}/versions/1`)!, content: { type: 'doc', content: [{ type: 'script' }] } });
  const before = writes.length;
  assert.equal(await code(useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u1' }, deps)), 'invalid_content');
  assert.equal(writes.length, before);
  assert.ok(![...store.keys()].some((k) => k.startsWith('editorDocuments/')));
});

test('o código do modelo não toca generatedDocuments e a coleção é literal editorTemplates', () => {
  assert.equal(EDITOR_TEMPLATES_COLLECTION, 'editorTemplates');
  const src = readFileSync('src/features/documents/editor/template-store.server.ts', 'utf8');
  assert.ok(src.includes(`collection("${EDITOR_TEMPLATES_COLLECTION}")`));
  assert.ok(!src.includes('generatedDocuments'));
  assert.ok(!/from\s+["']next|NextRequest|NextResponse/.test(src), 'sem Next/rotas');
  for (const key of readFileSync('src/features/documents/editor/document-store.server.ts', 'utf8').matchAll(/collection\("([A-Za-z]+)"\)/g)) assert.notEqual(key[1], 'generatedDocuments');
});

test('inventário pessoal: modelo sem titular; ator separado; lacunas aprovadas só de ator', () => {
  const live = sourceById('editor-template-creators')!;
  const updaters = sourceById('editor-template-updaters')!;
  for (const s of [live, updaters]) {
    assert.deepEqual([s.database, s.collection, s.role, s.namespace, s.coverage], ['main', 'editorTemplates', 'actor', 'main.users', 'live']);
    assert.equal(s.reason, undefined);
  }
  assert.deepEqual([live.field, updaters.field], ['createdBy', 'updatedBy']);
  for (const [id, field] of [['editor-template-publishers', 'publishedBy'], ['editor-template-archivers', 'archivedBy']]) {
    const s = sourceById(id)!;
    assert.deepEqual([s.database, s.collection, s.field, s.role, s.namespace, s.coverage], ['main', 'editorTemplates', field, 'actor', 'main.users', 'live']);
    assert.equal(s.reason, undefined);
  }
  const savers = sourceById('editor-template-version-savers')!;
  const audit = sourceById('editor-audit-actors')!;
  assert.deepEqual([savers.collection, savers.field, savers.role, savers.namespace, savers.coverage], ['versions', 'savedBy', 'actor', 'main.users', 'live']);
  assert.equal(savers.parentCollection, 'editorTemplates');
  assert.equal(audit.coverage, 'live');
  assert.equal(audit.parentCollection, 'editorDocuments');
  const tplAudit = sourceById('editor-template-audit-actors')!;
  assert.deepEqual([tplAudit.collection, tplAudit.parentCollection, tplAudit.field, tplAudit.role, tplAudit.coverage], ['audit', 'editorTemplates', 'actorId', 'actor', 'live']);
  const templateSources = PERSON_SOURCES.filter((s) => s.collection === 'editorTemplates' || s.parentCollection === 'editorTemplates' || s.id.startsWith('editor-template-'));
  assert.ok(templateSources.length >= 3);
  assert.ok(templateSources.every((s) => s.role === 'actor' && s.namespace === 'main.users'), 'nenhuma fonte de titular para modelos');
  const classification = JSON.parse(readFileSync('config/person-source-classification.json', 'utf8'));
  assert.ok(!classification.approvedLegacyGaps.includes('editor-template-version-savers'));
  assert.ok(!classification.approvedLegacyGaps.includes('editor-template-creators'));
  assert.equal(new Set(PERSON_SOURCES.map((s) => s.id)).size, PERSON_SOURCES.length);
});

test('firestore.rules nega editorTemplates ao cliente (catch-all) e o índice de listagem existe', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  assert.ok(!rules.includes('editorTemplates'), 'sem regra própria: cai no catch-all');
  assert.match(rules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes as any[];
  const mine = indexes.filter((i) => i.collectionGroup === 'editorTemplates');
  const shape = (i: any) => i.fields.map((f: any) => `${f.fieldPath}:${f.order}`).join(',');
  assert.ok(mine.every((i) => i.queryScope === 'COLLECTION'));
  assert.deepEqual(mine.map(shape).sort(), ['workspaceId:ASCENDING,status:ASCENDING,updatedAt:DESCENDING', 'workspaceId:ASCENDING,updatedAt:DESCENDING']);
});

test('todo campo *By gravado no registro principal do modelo está no inventário live', async () => {
  const { deps, store } = setup();
  const p = await published(deps);
  await archiveEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'chefe', clientRequestId: 'a1', expectedVersion: 1 }, deps);
  const main = store.get(`editorTemplates/${p.id}`)!;
  const byFields = Object.keys(main).filter((k) => /By$/.test(k));
  assert.ok(byFields.length >= 4);
  const live = new Set(PERSON_SOURCES.filter((s) => s.collection === 'editorTemplates' && s.coverage === 'live').map((s) => s.field));
  for (const f of byFields) assert.ok(live.has(f), `campo ${f} sem fonte live no inventário`);
  const src = readFileSync('src/features/documents/editor/template-store.server.ts', 'utf8');
  for (const m of src.matchAll(/\b([a-z][A-Za-z]*By)\s*:/g)) assert.ok(m[1] === 'savedBy' || live.has(m[1]), `store grava ${m[1]} fora do inventário`);
});

test('criar de documento grava origem opaca no modelo e na auditoria created; sem origem = null', async () => {
  const { deps, store } = setup();
  const d = await createEditorDraft({ workspaceId: 'w1', actorId: 'actor1', clientRequestId: 'd1', title: 'Doc', content: doc('Original') }, deps as any);
  const t = await createEditorTemplate({ ...base, fromDocument: { documentId: d.id, version: 1 } }, deps);
  assert.deepEqual(t.source, { kind: 'editor_document', documentId: d.id, version: 1 });
  assert.deepEqual(store.get(`editorTemplates/${t.id}`)!.source, { kind: 'editor_document', documentId: d.id, version: 1 });
  const audit = store.get(`editorTemplates/${t.id}/audit/template-created-v1`)!;
  assert.equal(audit.sourceDocumentId, d.id);
  assert.equal(audit.sourceVersion, 1);
  const plain = await mk(deps, { clientRequestId: 'x' });
  assert.equal(plain.source, null);
  assert.equal('sourceDocumentId' in store.get(`editorTemplates/${plain.id}/audit/template-created-v1`)!, false);
  // legado sem os campos é lido com tolerância
  const legacy = store.get(`editorTemplates/${plain.id}`)!;
  delete legacy.source; delete legacy.publishedName;
  const read = await getEditorTemplate(plain.id, 'w1', deps);
  assert.deepEqual([read.source, read.publishedName], [null, null]);
});

test('cursor com milissegundos fora do intervalo de Date é invalid_input', async () => {
  const { deps } = setup();
  const bad = Buffer.from(JSON.stringify([9e15, 'tpl_abc']), 'utf8').toString('base64url');
  assert.equal(await code(listEditorTemplates({ workspaceId: 'w1', cursor: bad }, deps)), 'invalid_input');
});

test('replay de salvar com name diferente do gravado é idempotency_mismatch; sem name mantém o replay', async () => {
  const { deps, writes } = setup();
  const t = await mk(deps);
  const args = { templateId: t.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's1', expectedVersion: 1, content: doc('v2') };
  await saveEditorTemplateContent({ ...args, name: 'Nome B' }, deps);
  const n = writes.length;
  assert.equal((await saveEditorTemplateContent({ ...args, name: 'Nome B' }, deps)).currentVersion, 2);
  assert.equal((await saveEditorTemplateContent(args, deps)).currentVersion, 2);
  assert.equal(await code(saveEditorTemplateContent({ ...args, name: 'Nome C' }, deps)), 'idempotency_mismatch');
  assert.equal(writes.length, n);
});

test('usar: título vem do nome registrado na versão publicada; renomear sem republicar não o muda', async () => {
  const { deps, store } = setup();
  const p = await published(deps);
  assert.equal(p.publishedName, 'Carta modelo');
  await saveEditorTemplateContent({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 's1', expectedVersion: 1, content: doc('v2'), name: 'Renomeado' }, deps);
  const d1 = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u1' }, deps);
  assert.equal(store.get(`editorDocuments/${d1.id}`)!.title, 'Carta modelo');
  const p2 = await publishEditorTemplate({ templateId: p.id, workspaceId: 'w1', actorId: 'a', clientRequestId: 'p9', expectedVersion: 2 }, deps);
  assert.equal(p2.publishedName, 'Renomeado');
  const d2 = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u2' }, deps);
  assert.equal(store.get(`editorDocuments/${d2.id}`)!.title, 'Renomeado');
  // legado publicado sem publishedName cai no nome atual
  delete store.get(`editorTemplates/${p.id}`)!.publishedName;
  const d3 = await useEditorTemplate({ workspaceId: 'w1', actorId: 'u', templateId: p.id, clientRequestId: 'u3' }, deps);
  assert.equal(store.get(`editorDocuments/${d3.id}`)!.title, 'Renomeado');
});
