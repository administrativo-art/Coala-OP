import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EDITOR_CONTENT_MAX_BYTES,
  EDITOR_CONTENT_MAX_DEPTH,
  EDITOR_CONTENT_SCHEMA_VERSION,
  hashEditorContent,
  parseEditorContent,
} from '../../../src/features/documents/editor/content-schema';

const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const para = (...content: unknown[]) => ({ type: 'paragraph', content });

const valid = doc(
  { type: 'heading', attrs: { level: 2 }, content: [text('Título')] },
  para(text('Olá ', [{ type: 'bold' }, { type: 'underline' }]), { type: 'documentField', attrs: { key: 'employee.name' } }, { type: 'hardBreak' }),
  { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('x'))] }] },
  { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [para(text('y'))] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(text('h'))] },
    { type: 'tableCell', content: [para()] },
  ] }] },
);

test('versão do esquema é 1 e documento válido é aceito', () => {
  assert.equal(EDITOR_CONTENT_SCHEMA_VERSION, 1);
  const result = parseEditorContent(valid);
  assert.equal(result.ok, true);
});

test('rejeita nó, marca e atributo desconhecidos', () => {
  assert.equal(parseEditorContent(doc({ type: 'image', attrs: { src: 'x' } })).ok, false);
  assert.equal(parseEditorContent(doc(para(text('a', [{ type: 'link', attrs: { href: 'x' } }])))).ok, false);
  assert.equal(parseEditorContent(doc(para(text('a', [{ type: 'bold', attrs: { style: 'x' } }])))).ok, false);
  assert.equal(parseEditorContent(doc({ type: 'paragraph', attrs: { style: 'color:red' }, content: [] })).ok, false);
  assert.equal(parseEditorContent(doc({ type: 'heading', attrs: { level: 4 }, content: [] })).ok, false);
  assert.equal(parseEditorContent({ ...valid, extra: 1 }).ok, false);
  assert.equal(parseEditorContent(doc(para({ ...text('a'), html: '<b>' }))).ok, false);
});

test('rejeita key fora do catálogo e extras no documentField', () => {
  assert.equal(parseEditorContent(doc(para({ type: 'documentField', attrs: { key: 'nao.existe' } }))).ok, false);
  assert.equal(parseEditorContent(doc(para({ type: 'documentField', attrs: { key: 'toString' } }))).ok, false);
  assert.equal(parseEditorContent(doc(para({ type: 'documentField', attrs: { key: 'employee.name', label: 'x' } }))).ok, false);
});

test('rejeita profundidade e tamanho excedidos sem expor o valor recebido', () => {
  let node: unknown = para(text('fundo'));
  for (let i = 0; i < EDITOR_CONTENT_MAX_DEPTH; i += 1) {
    node = { type: 'bulletList', content: [{ type: 'listItem', content: [node] }] };
  }
  const deep = parseEditorContent(doc(node));
  assert.equal(deep.ok, false);

  const huge = parseEditorContent(doc(...Array.from({ length: 30 }, () => para(text('a'.repeat(15000))))));
  assert.equal(huge.ok, false);
  assert.ok(JSON.stringify(doc(...Array.from({ length: 30 }, () => para(text('a'.repeat(15000)))))).length > EDITOR_CONTENT_MAX_BYTES);

  const secret = parseEditorContent(doc({ type: 'image', attrs: { src: 'SEGREDO-123' } }));
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.ok(!JSON.stringify(secret.issues).includes('SEGREDO-123'));
});

test('entradas não serializáveis ou não-objeto falham sem lançar', () => {
  const cyclic: Record<string, unknown> = { type: 'doc' };
  cyclic.content = [cyclic];
  assert.equal(parseEditorContent(cyclic).ok, false);
  assert.equal(parseEditorContent(undefined).ok, false);
  assert.equal(parseEditorContent(null).ok, false);
  assert.equal(parseEditorContent(doc()).ok, false);
});

test('texto com HTML/script é aceito como texto (escape ocorre na renderização)', () => {
  assert.equal(parseEditorContent(doc(para(text('<script>alert(1)</script>')))).ok, true);
});

test('mesmo JSON gera o mesmo hash, independente da ordem das chaves', () => {
  const a = parseEditorContent(valid);
  const reordered = JSON.parse(JSON.stringify(valid), (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  const b = parseEditorContent(reordered);
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.equal(hashEditorContent(a.content), hashEditorContent(b.content));
    assert.match(hashEditorContent(a.content), /^[0-9a-f]{64}$/);
    const changed = parseEditorContent(doc(para(text('outro'))));
    assert.ok(changed.ok);
    if (changed.ok) assert.notEqual(hashEditorContent(changed.content), hashEditorContent(a.content));
  }
});
