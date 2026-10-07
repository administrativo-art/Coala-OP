import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CATEGORY_SYMBOLS, unitFullName, unitSymbol } from '../../src/lib/base-product-unit-display';

const ficha = readFileSync('src/components/base-product-ficha-modal.tsx', 'utf8');
const editor = readFileSync('src/components/add-edit-base-product-modal.tsx', 'utf8');
const list = readFileSync('src/components/base-product-management.tsx', 'utf8');

test('unit display helpers map the stored unit to its symbol and full name', () => {
  assert.equal(unitSymbol('un'), 'un');
  assert.equal(unitSymbol('caixa'), 'cx');
  assert.equal(unitSymbol('peça'), 'pç');
  assert.equal(unitFullName('un'), 'unidade');
  assert.equal(unitFullName('kg'), 'quilograma');
  assert.equal(unitFullName('desconhecida'), 'desconhecida');
  assert.deepEqual(Object.keys(CATEGORY_SYMBOLS).sort(), ['Embalagem', 'Massa', 'Unidade', 'Vestimenta', 'Volume']);
});

test('editor and ficha share the unit display helpers instead of duplicating them', () => {
  assert.match(editor, /from '@\/lib\/base-product-unit-display'/);
  assert.match(ficha, /from '@\/lib\/base-product-unit-display'/);
  assert.ok(!editor.includes('const UNIT_NAMES'));
});

test('ficha follows the handoff with a dark insumo panel flush with the rounded corners', () => {
  assert.match(ficha, /DialogContent hideClose className="[^"]*\bp-0\b[^"]*sm:max-w-\[1080px\][^"]*\bsm:p-0\b[^"]*"/);
  assert.match(ficha, /lg:h-\[780px\] lg:grid-cols-\[380px_minmax\(0,1fr\)\]/);
  assert.match(ficha, /aside className="[^"]*bg-\[#15151c\][^"]*"/);
  assert.match(ficha, /Ficha cadastral · insumo base/);
});

test('ficha has an accessible title, labelled close and tablist with the two sections', () => {
  assert.match(ficha, /<DialogTitle className="sr-only">Ficha cadastral de/);
  assert.match(ficha, /aria-label="Fechar"/);
  assert.match(ficha, /role="tablist" aria-label="Seções da ficha"/);
  assert.match(ficha, /label: 'Dados gerais'/);
  assert.match(ficha, /label: 'Insumos e nutrição'/);
});

test('ficha keeps the replenishment-policy semantics of the stock table', () => {
  assert.match(ficha, /const legacy = policyEnabled === false/);
  assert.match(ficha, /operationalMinimum\(level, policyEnabled\)/);
  assert.match(ficha, /const lead = policyEnabled \? level\.effectiveLeadTime : level\.leadTime/);
  assert.match(ficha, /legacy && level\.override \? 'Travado'/);
  assert.match(ficha, /\{legacy && <span className="text-right">Segurança legada<\/span>\}/);
  assert.match(ficha, /Política não verificada/);
  assert.match(ficha, /Indisponível\. Os mínimos não puderam ser verificados\./);
});

test('nutrition tab searches, filters, expands and zooms linked products', () => {
  assert.match(ficha, /aria-label="Buscar insumo, marca ou embalagem"/);
  assert.match(ficha, /role="radiogroup" aria-label="Filtrar por dados"/);
  assert.match(ficha, /aria-expanded=\{isOpen\}/);
  assert.match(ficha, /aria-label=\{`Ampliar foto — \$\{label\}`\}/);
  assert.match(ficha, /Nenhum insumo encontrado\./);
  assert.match(ficha, /Sem fotos nem dados transcritos\./);
});

test('the list still opens the ficha and hands editing to the editor', () => {
  assert.match(list, /<BaseProductFichaModal/);
  assert.match(list, /setFichaProduct\(null\);\s*setProductToEditId\(bp\.id\);\s*setIsModalOpen\(true\);/);
});
