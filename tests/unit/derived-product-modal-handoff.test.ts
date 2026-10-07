import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync('src/components/add-edit-product-modal.tsx', 'utf8');
const ficha = readFileSync('src/components/product-ficha-modal.tsx', 'utf8');
const list = readFileSync('src/components/item-management.tsx', 'utf8');

test('editor follows the derived-product handoff with a live dark panel and responsive two-column shell', () => {
  assert.match(editor, /DialogContent ref=\{dialogContentRef\} hideClose flush className="[^"]*sm:max-w-\[1080px\][^"]*"/);
  assert.match(editor, /form\s+className="grid min-h-0 grid-cols-1 lg:h-\[800px\] lg:grid-cols-\[360px_minmax\(0,1fr\)\]/);
  assert.match(editor, /Painel do insumo ao vivo/);
  assert.match(editor, /bg-\[#15151c\]/);
  assert.match(editor, /salva por etapa/);
});

test('editor exposes direct choices for item category, package, measurement category and unit', () => {
  assert.match(editor, /role="radiogroup" aria-label="Categoria do item"/);
  assert.match(editor, /role="radiogroup" aria-label="Tipo de embalagem"/);
  assert.match(editor, /role="radiogroup" aria-label="Categoria da unidade"/);
  assert.match(editor, /role="radiogroup" aria-label="Unidade"/);
});

test('wizard navigation never submits while advancing and edit mode still saves only the active step', () => {
  assert.match(editor, /const handleNext = async \(\) =>/);
  assert.match(editor, /<Button type="button"[^>]*onClick=\{handleNext\}/);
  assert.match(editor, /onClick=\{\(\) => void handleSaveEditStep\(\)\}/);
  assert.match(editor, /Salvar etapa/);
});

test('opening a product card or row shows the read-only ficha and each ficha section can enter its matching edit step', () => {
  assert.match(list, /onOpen=\{\(\) => setOpenId\(product\.id\)\}/);
  assert.match(list, /<ProductFichaModal/);
  assert.match(list, /product=\{opened\}/);
  assert.match(list, /initialStep=\{editInitialStep\}/);
  assert.match(ficha, /onEdit: \(step: number\) => void/);
  assert.match(ficha, /onEdit\(tab === 'aliases' \? 2 : tab === 'extra' \? \(isUniform \? 4 : 5\) : 1\)/);
  assert.match(ficha, /title="Embalagem e contagem" onEdit=\{\(\) => onEdit\(3\)\}/);
});

test('card and row selection stay independent from opening the ficha', () => {
  assert.match(list, /<GridCard[\s\S]*?<SelectBox/);
  assert.match(list, /<ListRow[\s\S]*?<SelectBox/);
  assert.match(list, /label=\{`Selecionar \$\{product\.baseName\}`\}/);
});
