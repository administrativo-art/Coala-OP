import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync('src/components/add-edit-base-product-modal.tsx', 'utf8');

test('wizard labels use the Portuguese conjunction instead of an ampersand', () => {
  assert.ok(modal.includes("label: 'Identificação e medida'"));
  assert.ok(!modal.includes('Identificação & medida'));
});

test('stock parameters top-align controls independently of their explanatory text', () => {
  assert.match(modal, /Table className="min-w-\[760px\] table-fixed"/);
  assert.match(modal, /TableRow key=\{kiosk\.id\} className="\[&>td\]:align-top \[&>td\]:py-4"/);
  assert.equal((modal.match(/className="h-10 w-full text-right"/g) ?? []).length, 3);
  assert.equal((modal.match(/className="flex h-10 items-center justify-center"/g) ?? []).length, 2);
});

test('direct purchase uses an accessible per-unit switch without changing the stored routing contract', () => {
  assert.match(modal, /checked=\{field\.value === 'direct'\}/);
  assert.match(modal, /onCheckedChange=\{\(checked\) => field\.onChange\(checked \? 'direct' : 'cd'\)\}/);
  assert.match(modal, /aria-label=\{`Compra direta — \$\{kiosk\.name\}`\}/);
  assert.match(modal, /role === 'supply' \? <div[^>]*>Não se aplica<\/div>/);
});
