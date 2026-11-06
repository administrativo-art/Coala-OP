import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PERSON_SOURCES, sourceById } from '../../../src/features/privacy/person-inventory';
import { canViewPersonSource, canViewPersonSourceRow } from '../../../src/features/privacy/person-inventory.server';
import { decodeGroupPosition, encodeGroupPosition, isPersonSourceGroup, ownedGroupParent } from '../../../src/features/privacy/person-source-group';

type Data = Record<string, unknown>;
function ref(path: string, store: Map<string, Data>, reads: string[]): any {
  const parts = path.split('/');
  const parentPath = parts.slice(0, -2).join('/');
  const collPath = parts.slice(0, -1).join('/');
  const collParent = parts.length > 2 ? ref(parentPath, store, reads) : null;
  return {
    id: parts[parts.length - 1], path,
    parent: { id: parts[parts.length - 2], path: collPath, parent: collParent },
    async get() { reads.push(path); return { exists: store.has(path), data: () => store.get(path) }; },
  };
}
function row(path: string, data: Data, store: Map<string, Data>, reads: string[]): any {
  const r = ref(path, store, reads);
  return { id: r.id, ref: r, data: () => data, get: (f: string) => data[f] };
}
const admin = { isDefaultAdmin: true, permissions: {}, userDoc: {}, workspace_id: 'w1' } as any;
const common = { isDefaultAdmin: false, permissions: { dp: { collaborators: { view: true } } }, userDoc: { unitAccessScope: 'all' }, workspace_id: 'w1' } as any;

test('rejeita documento intruso com subcoleção de mesmo nome fora do pai declarado', async () => {
  const store = new Map<string, Data>([
    ['editorDocuments/d1', { workspaceId: 'w1' }],
    ['editorTemplates/t1', { workspaceId: 'w1' }],
    ['otherModule/x1', { workspaceId: 'w1' }],
    ['a/b/otherModule/x2', { workspaceId: 'w1' }],
  ]);
  const reads: string[] = [];
  const audit = sourceById('editor-audit-actors')!;
  assert.equal(await canViewPersonSourceRow(admin, audit, row('editorDocuments/d1/audit/e1', { actorId: 'u1' }, store, reads)), true);
  // Mesmo nome de subcoleção em outro módulo, em editorTemplates (pai errado) e aninhado em profundidade.
  for (const path of ['otherModule/x1/audit/e1', 'editorTemplates/t1/audit/e1', 'a/b/editorDocuments/d1/audit/e1', 'editorDocuments/d1/other/audit/e1']) {
    assert.equal(await canViewPersonSourceRow(admin, audit, row(path, { actorId: 'u1', workspaceId: 'w1' }, store, reads)), false, path);
  }
  const tpl = sourceById('editor-template-audit-actors')!;
  assert.equal(await canViewPersonSourceRow(admin, tpl, row('editorDocuments/d1/audit/e1', { actorId: 'u1' }, store, reads)), false);
  assert.equal(await canViewPersonSourceRow(admin, tpl, row('editorTemplates/t1/audit/e1', { actorId: 'u1' }, store, reads)), true);
  // Nenhuma leitura do pai ocorre para caminhos rejeitados (intruso nunca é tocado).
  assert.ok(!reads.includes('otherModule/x1'));
});

test('workspace vem do pai: outro workspace ou pai ausente/sem workspace nega', async () => {
  const store = new Map<string, Data>([['editorDocuments/dA', { workspaceId: 'w2' }], ['editorDocuments/dB', {}]]);
  const src = sourceById('editor-content-version-savers')!;
  for (const id of ['dA', 'dB', 'ghost']) assert.equal(await canViewPersonSourceRow(admin, src, row(`editorDocuments/${id}/contentVersions/1`, { savedBy: 'u1' }, store, [])), false, id);
});

test('política desconhecida e perfil comum são negados; ator, titular e signatário seguem separados', async () => {
  const store = new Map<string, Data>([['editorDocuments/d1', { workspaceId: 'w1' }]]);
  const subj = sourceById('editor-audit-subjects')!;
  const unknown = { ...subj, permissionPolicy: 'unknown' } as any;
  assert.equal(canViewPersonSource(admin, unknown), false);
  assert.equal(await canViewPersonSourceRow(admin, unknown, row('editorDocuments/d1/audit/e1', {}, store, [])), false);
  assert.equal(await canViewPersonSourceRow(admin, { ...subj, scopePolicy: 'unknown' } as any, row('editorDocuments/d1/audit/e1', {}, store, [])), false);
  assert.equal(canViewPersonSource(common, subj), false);
  const actor = sourceById('editor-audit-actors')!;
  assert.deepEqual([actor.role, actor.namespace, actor.field], ['actor', 'main.users', 'actorId']);
  assert.deepEqual([subj.role, subj.namespace, subj.field], ['subject', 'subjectKeys', 'subjectKeys']);
  assert.ok(!PERSON_SOURCES.some((s) => s.parentCollection && s.role === 'signer'));
  // O ator nunca é consultado como titular: campos distintos na mesma subcoleção.
  assert.notEqual(actor.field, subj.field);
});

test('helpers: caminho exato, posição de continuação validada', () => {
  const src = sourceById('editor-template-version-savers')!;
  assert.equal(isPersonSourceGroup(src), true);
  assert.equal(isPersonSourceGroup(sourceById('editor-documents')!), false);
  const pos = encodeGroupPosition('editorTemplates/t1/versions/3');
  assert.ok(!pos.includes('/'));
  assert.equal(decodeGroupPosition(src, pos), 'editorTemplates/t1/versions/3');
  for (const bad of [encodeGroupPosition('editorTemplates/t1/audit/3'), encodeGroupPosition('editorTemplates/t1/versions'), encodeGroupPosition('a/versions'), encodeGroupPosition('a/b/versions'), 'abc', 'g1.@@@']) assert.equal(decodeGroupPosition(src, bad), null);
  assert.equal(ownedGroupParent(sourceById('editor-documents')!, ref('editorDocuments/d1/audit/e1', new Map(), [])), null);
});

test('fontes de subcoleção do editor: live, banco main, exemption de collection group e fora de legacy_gap', () => {
  const ids = ['editor-audit-actors', 'editor-audit-subjects', 'editor-content-version-savers', 'editor-template-version-savers', 'editor-template-audit-actors'];
  const classification = JSON.parse(readFileSync('config/person-source-classification.json', 'utf8'));
  const overrides = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).fieldOverrides as any[];
  for (const id of ids) {
    const s = sourceById(id)!;
    assert.deepEqual([s.database, s.coverage], ['main', 'live']);
    assert.ok(s.parentCollection === 'editorDocuments' || s.parentCollection === 'editorTemplates');
    assert.ok(!classification.approvedLegacyGaps.includes(id), id);
    const o = overrides.find((x) => x.collectionGroup === s.collection && x.fieldPath === s.field);
    assert.ok(o, `fieldOverride ${s.collection}.${s.field}`);
    assert.ok(o.indexes.some((i: any) => i.queryScope === 'COLLECTION_GROUP' && (s.field === 'subjectKeys' ? i.arrayConfig === 'CONTAINS' : i.order === 'ASCENDING')));
    assert.ok(o.indexes.some((i: any) => i.queryScope === 'COLLECTION'), 'preserva o escopo COLLECTION padrão');
  }
  assert.equal(sourceById('editor-content-versions')!.coverage, 'legacy_gap');
});

test('coletor: collection group com limite e leitura exata, sem varredura', () => {
  const src = readFileSync('src/features/privacy/person-inventory.server.ts', 'utf8');
  assert.match(src, /db\.collectionGroup\(source\.collection\)/);
  assert.match(src, /PERSON_SOURCE_READ_BUDGET = 100/);
  assert.match(src, /\.limit\(batchSize\)/);
  assert.match(src, /group \? 2 : 1|\|\| group \? 2 : 1/);
});

test('continuação a partir de posição intrusa ou aninhada segue válida, mas o intruso nunca é exposto', async () => {
  const src = sourceById('editor-audit-actors')!;
  for (const path of ['companyDocuments/x/audit/y', 'a/b/companyDocuments/x/audit/y', 'editorDocuments/d1/audit/e1']) {
    assert.equal(decodeGroupPosition(src, encodeGroupPosition(path)), path, path);
  }
  const store = new Map<string, Data>([['editorDocuments/d1', { workspaceId: 'w1' }]]);
  for (const path of ['companyDocuments/x/audit/y', 'a/b/companyDocuments/x/audit/y']) {
    const r = row(path, { actorId: 'u1' }, store, []);
    assert.equal(ownedGroupParent(src, r.ref), null);
    assert.equal(await canViewPersonSourceRow(admin, src, r), false);
  }
  const collector = readFileSync('src/features/privacy/person-inventory.server.ts', 'utf8');
  // Intruso é ignorado antes de contar como negado (não força "partial" por escopo).
  assert.match(collector, /if \(group && !ownedGroupParent\(source, doc\.ref\)\) continue;\n\s+if \(await canViewPersonSourceRow/);
});
