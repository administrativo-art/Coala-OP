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

test('dense stock table receives the full modal width on intermediate screens', () => {
  assert.match(modal, /DialogContent className="[^"]*max-h-\[calc\(100dvh-1rem\)\][^"]*sm:max-w-\[96rem\][^"]*"/);
  assert.match(modal, /form className="flex min-h-0 flex-1 flex-col"/);
  assert.match(modal, /grid min-h-0 flex-1 grid-cols-1 grid-rows-\[minmax\(0,1fr\)\][^"]*xl:grid-cols-\[240px_minmax\(0,1fr\)\]/);
  assert.match(modal, /aside className="hidden border-r[^"]*xl:block"/);
  assert.match(modal, /ScrollArea className="h-full min-h-0 min-w-0"/);
  assert.match(modal, /DialogFooter className="flex shrink-0/);
});

test('the first wizard step cannot submit or save the base product', () => {
  assert.match(modal, /handleNextClick = \(event: React\.MouseEvent<HTMLButtonElement>\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*void handleNext\(\);/);
  assert.match(modal, /handleWizardSubmit = \(event: React\.FormEvent<HTMLFormElement>\) => \{\s*if \(currentStep < WIZARD_STEPS\.length\) \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*void handleNext\(\);\s*return;/);
  assert.match(modal, /form className="flex min-h-0 flex-1 flex-col" onSubmit=\{handleWizardSubmit\}/);
  assert.match(modal, /Button type="button"[^>]*onClick=\{handleNextClick\}>Avançar/);
  assert.match(modal, /Button type="submit"[^>]*>\{saving \? 'Salvando…'/);
});

test('direct purchase uses an accessible per-unit switch without changing the stored routing contract', () => {
  assert.match(modal, /checked=\{field\.value === 'direct'\}/);
  assert.match(modal, /onCheckedChange=\{\(checked\) => field\.onChange\(checked \? 'direct' : 'cd'\)\}/);
  assert.match(modal, /aria-label=\{`Compra direta — \$\{kiosk\.name\}`\}/);
  assert.match(modal, /role === 'supply' \? <div[^>]*>Não se aplica<\/div>/);
});
