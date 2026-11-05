import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEditorContent, type EditorContent } from '../../../src/features/documents/editor/content-schema';
import { EDITOR_HTML_CSP, PROVISIONAL_PAGE_LAYOUT, renderEditorHtml } from '../../../src/features/documents/editor/render-html';
import { EDITOR_SAMPLE_VALUES } from '../../../src/features/documents/editor/sample-values';
import { DOCUMENT_VARIABLES } from '../../../src/features/hr/integration/document-variables';

function content(input: unknown): EditorContent {
  const result = parseEditorContent(input);
  assert.ok(result.ok, 'conteúdo de teste deve ser válido');
  return (result as { ok: true; content: EditorContent }).content;
}
const field = (key: string) => ({ type: 'documentField', attrs: { key } });
const doc = (...c: unknown[]) => content({ type: 'doc', content: [{ type: 'paragraph', content: c }] });

test('amostras cobrem todas as chaves do catálogo', () => {
  for (const variable of DOCUMENT_VARIABLES) assert.ok(variable.key in EDITOR_SAMPLE_VALUES, variable.key);
});

test('escapa texto, inclusive script e aspas', () => {
  const { html } = renderEditorHtml(doc({ type: 'text', text: '<script>alert("x")</script> & \'y\'' }), { mode: 'sample' });
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;'));
});

test('mesmo conteúdo gera o mesmo HTML; marcas em ordem diferente também', () => {
  const a = doc({ type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'italic' }] }, field('employee.name'));
  const b = doc({ type: 'text', text: 'a', marks: [{ type: 'italic' }, { type: 'bold' }] }, field('employee.name'));
  const opts = { mode: 'sample' as const };
  assert.equal(renderEditorHtml(a, opts).html, renderEditorHtml(a, opts).html);
  assert.equal(renderEditorHtml(a, opts).html, renderEditorHtml(b, opts).html);
});

test('modo resolved lista chaves ausentes; sample usa exemplos', () => {
  const c = doc(field('employee.name'), field('employee.cpf'), field('employee.name'));
  const resolved = renderEditorHtml(c, { mode: 'resolved', values: { 'employee.cpf': '52998224725' } });
  assert.deepEqual(resolved.missingKeys, ['employee.name']);
  assert.ok(resolved.html.includes('529.982.247-25'));
  assert.ok(resolved.html.includes('field-missing'));
  const sample = renderEditorHtml(c, { mode: 'sample' });
  assert.deepEqual(sample.missingKeys, []);
  assert.ok(sample.html.includes('Marina Costa Almeida'));
});

test('valor do campo é escapado e campo mantém nowrap', () => {
  const long = 'Nome muito longo '.repeat(20) + '<b>';
  const { html } = renderEditorHtml(doc(field('employee.name')), { mode: 'resolved', values: { 'employee.name': long } });
  assert.ok(html.includes('&lt;b&gt;'));
  assert.match(html, /\.field \{ white-space: nowrap; \}/);
  assert.match(html, /<span class="field" data-field="employee\.name">/);
});

test('HTML é autocontido: sem URL externa, link, script ou import', () => {
  const { html } = renderEditorHtml(doc({ type: 'text', text: 'texto' }), { mode: 'sample' });
  assert.ok(!/https?:\/\//i.test(html));
  assert.ok(!/<link|<script|@import|url\(/i.test(html));
  assert.ok(html.includes('box-sizing: border-box'));
  assert.ok(html.includes(`${PROVISIONAL_PAGE_LAYOUT.widthPx}px ${PROVISIONAL_PAGE_LAYOUT.heightPx}px`));
});

test('página customizada é aplicada e dimensões inválidas são rejeitadas', () => {
  const c = doc({ type: 'text', text: 'x' });
  assert.ok(renderEditorHtml(c, { mode: 'sample', page: { marginTopPx: 50 } }).html.includes('margin: 50px 76px 135px 76px'));
  assert.throws(() => renderEditorHtml(c, { mode: 'sample', page: { marginTopPx: -1 } }), RangeError);
  assert.throws(() => renderEditorHtml(c, { mode: 'sample', page: { marginLeftPx: 700 } }), RangeError);
});

test('renderiza listas e tabelas', () => {
  const c = content({ type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'i' }] }] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2 }, content: [{ type: 'paragraph' }] }] }] },
  ] });
  const { html } = renderEditorHtml(c, { mode: 'sample' });
  assert.ok(html.includes('<h1>T</h1>') && html.includes('<ol start="3">') && html.includes('<th colspan="2">'));
});

test('HTML traz CSP restritiva (sem rede/script) antes de qualquer conteúdo', () => {
  const { html } = renderEditorHtml(doc({ type: 'text', text: 'x' }), { mode: 'sample' });
  const meta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
  assert.equal(EDITOR_HTML_CSP, "default-src 'none'; style-src 'unsafe-inline'");
  assert.ok(html.includes(meta));
  assert.ok(html.indexOf(meta) < html.indexOf('<style>') && html.indexOf(meta) < html.indexOf('<body>'));
});
