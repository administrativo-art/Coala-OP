import assert from 'node:assert/strict';
import test from 'node:test';

import { getSchema } from '@tiptap/core';
import { createTable } from '@tiptap/extension-table';
import { toggleMark } from '@tiptap/pm/commands';
import { EditorState, TextSelection } from '@tiptap/pm/state';

import { parseEditorContent } from '../../../src/features/documents/editor/content-schema';
import {
  createAtomMarksPlugin,
  createEditorExtensions,
} from '../../../src/features/documents/editor/ui/editor-extensions';
import { DOCUMENT_VARIABLES } from '../../../src/features/hr/integration/document-variables';

// O Tiptap `Editor` exige DOM; sem navegador/jsdom, o esquema real do Tiptap é exercitado com o
// ProseMirror que ele usa por baixo (getSchema + EditorState), que é o que gera `editor.getJSON()`.
const schema = getSchema(createEditorExtensions());
const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow',
  'tableHeader', 'tableCell', 'hardBreak', 'text', 'documentField',
]);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline']);

function accepted(json: unknown) {
  const result = parseEditorContent(json);
  assert.equal(result.ok, true, JSON.stringify(result));
}

test('o esquema do editor só contém nós e marcas da allowlist do servidor', () => {
  assert.deepEqual(Object.keys(schema.nodes).filter((name) => !ALLOWED_NODES.has(name)), []);
  assert.deepEqual(Object.keys(schema.marks).filter((name) => !ALLOWED_MARKS.has(name)), []);
});

test('o nó documentField serializa como {type, attrs:{key}} e aceita só chaves do catálogo', () => {
  const key = DOCUMENT_VARIABLES[0]!.key;
  const node = schema.nodes.documentField!.create({ key });
  assert.deepEqual(JSON.parse(JSON.stringify(node.toJSON())), { type: 'documentField', attrs: { key } });
  accepted({ type: 'doc', content: [{ type: 'paragraph', content: [node.toJSON()] }] });
  assert.equal(
    parseEditorContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'documentField', attrs: { key: 'nao.existe' } }] }] }).ok,
    false,
  );
});

test('todo nó criável com valores padrão produz JSON aceito pelo servidor', () => {
  const para = (inner: unknown[] = []) => ({ type: 'paragraph', ...(inner.length ? { content: inner } : {}) });
  const field = { type: 'documentField', attrs: { key: DOCUMENT_VARIABLES[0]!.key } };
  const sample = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }] }] },
      { type: 'heading', attrs: { level: 3 } },
      para([{ type: 'text', text: 'a' }, { type: 'hardBreak' }, field]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(), { type: 'orderedList', content: [{ type: 'listItem', content: [para()] }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para([{ type: 'text', text: 'x' }])] }] },
      createTable(schema, 3, 3, true).toJSON(),
    ],
  });
  sample.check();
  accepted(sample.toJSON());
  // O atributo `type` do orderedList e `align` das células do Tiptap não podem vazar.
  const json = JSON.stringify(sample.toJSON());
  assert.equal(json.includes('"align"'), false);
  assert.equal(json.includes('"type":null'), false);
});

test('conteúdo que o servidor rejeita não é válido no esquema do editor', () => {
  const para = { type: 'paragraph' };
  const invalid = (json: unknown) => {
    assert.throws(() => schema.nodeFromJSON(json).check());
  };
  // Nós fora da allowlist.
  invalid({ type: 'doc', content: [{ type: 'blockquote', content: [para] }] });
  invalid({ type: 'doc', content: [{ type: 'codeBlock' }] });
  invalid({ type: 'doc', content: [{ type: 'horizontalRule' }] });
  // Marcas fora da allowlist.
  invalid({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'strike' }] }] }] });
  invalid({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'x' } }] }] }] });
  invalid({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'code' }] }] }] });
  // Estruturas que o servidor não aceita: título e tabela dentro de célula/item de lista.
  const cell = (inner: unknown) => ({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [inner] }] }] });
  invalid({ type: 'doc', content: [cell({ type: 'heading', attrs: { level: 1 } })] });
  invalid({ type: 'doc', content: [cell(cell(para))] });
  invalid({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para, { type: 'heading', attrs: { level: 1 } }] }] }] });
  invalid({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [para, cell(para)] }] }] });
});

test('atributos fora do esquema do servidor são descartados ou limitados pelo editor', () => {
  // Atributos desconhecidos viram padrão ao reconstruir o nó.
  const list = schema.nodes.orderedList!.create({ start: 3, type: 'a' } as never, schema.nodes.listItem!.createAndFill()!);
  assert.deepEqual(JSON.parse(JSON.stringify(list.toJSON().attrs)), { start: 3 });
  const cell = schema.nodes.tableCell!.createAndFill({ colwidth: [120], align: 'center' } as never)!;
  assert.equal(JSON.stringify(cell.toJSON()).includes('align'), false);
  // Colar HTML só reconhece títulos nos níveis 1-3 (h4-h6 viram parágrafo).
  const headingTags = (schema.nodes.heading!.spec.parseDOM ?? []).map((rule) => rule.tag).sort();
  assert.deepEqual(headingTags, ['h1', 'h2', 'h3']);
});

test('negrito sobre seleção com campo e quebra de linha não deixa marcas nesses nós', () => {
  const field = { type: 'documentField', attrs: { key: DOCUMENT_VARIABLES[0]!.key } };
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ab' }, field, { type: 'hardBreak' }, { type: 'text', text: 'cd' }] }],
  });
  let state = EditorState.create({ doc, schema, plugins: [createAtomMarksPlugin()] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
  toggleMark(schema.marks.bold!)(state, (tr) => { state = state.apply(tr); });
  const json = state.doc.toJSON();
  accepted(json);
  assert.equal(JSON.stringify(json).includes('"marks"'), true, 'o texto continua em negrito');
  const inline = json.content[0].content as Array<{ type: string; marks?: unknown }>;
  for (const node of inline) {
    if (node.type !== 'text') assert.equal(node.marks, undefined, `${node.type} não pode ter marcas`);
  }
});
