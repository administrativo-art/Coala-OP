import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const modal = readFileSync('src/components/add-edit-base-product-modal.tsx', 'utf8');

test('wizard labels use the Portuguese conjunction instead of an ampersand', () => {
  assert.ok(modal.includes("label: 'Identificação e medida'"));
  assert.ok(!modal.includes('Identificação & medida'));
});

test('modal keeps the insumo panel beside the step content and stacks on narrow screens', () => {
  assert.match(modal, /DialogContent hideClose className="[^"]*max-h-\[calc\(100dvh-1rem\)\][^"]*sm:max-w-\[1080px\][^"]*"/);
  assert.match(modal, /form className="grid min-h-0 grid-cols-1 lg:grid-cols-\[380px_minmax\(0,1fr\)\]"/);
  assert.match(modal, /aside className="[^"]*bg-\[#15151c\][^"]*"/);
  assert.match(modal, /grid grid-cols-2 gap-2\.5 md:grid-cols-\[minmax\(0,1\.3fr\)_minmax\(0,\.85fr\)_minmax\(0,1\.3fr\)_minmax\(0,\.75fr\)\]/);
});

test('stock card labels never wrap, so every control in a card stays on one baseline', () => {
  assert.match(modal, /min-h-\[19px\] items-center gap-1\.5 whitespace-nowrap[^"]*">\s*Estoque mínimo/);
});

test('the dialog removes the base padding at every breakpoint so the dark panel is flush with the rounded corners', () => {
  assert.match(modal, /DialogContent hideClose className="[^"]*\bp-0\b[^"]*\bsm:p-0\b[^"]*"/);
});

test('modal exposes an accessible title and a labelled close action', () => {
  assert.match(modal, /<DialogTitle /);
  assert.match(modal, /<DialogDescription /);
  assert.match(modal, /aria-label="Fechar"/);
});

test('category and unit pickers are radio groups bound to the form', () => {
  assert.match(modal, /role="radiogroup" aria-label="Categoria da unidade"/);
  assert.match(modal, /onClick=\{\(\) => handleCategoryChange\(cat\)\}/);
  assert.match(modal, /role="radiogroup" aria-label="Unidade de medida padrão"/);
  assert.match(modal, /CATEGORY_ORDER\.map\(\(cat\)/);
});

test('direct purchase is an accessible per-unit choice without changing the stored routing contract', () => {
  assert.match(modal, /\[\['cd', 'Via CD'\], \['direct', 'Compra direta'\]\] as const/);
  assert.match(modal, /aria-label=\{`Abastecimento — \$\{kiosk\.name\}`\}/);
  assert.match(modal, /onClick=\{\(\) => field\.onChange\(value\)\}/);
  assert.match(modal, /isSupply \? \(\s*<div[^>]*>Não se aplica<\/div>/);
});

test('lead time is fixed at two days only for commercial units routed through the CD under the active policy', () => {
  assert.match(modal, /const leadLocked = policyEnabled === true && !isSupply && mode === 'cd'/);
  assert.match(modal, /Rota via CD usa prazo operacional de dois dias/);
  assert.match(modal, /leadTime: policyEnabled && mode === 'cd' && role !== 'supply' \? 2 : level\.leadTime/);
});

test('legacy-only controls are hidden while the replenishment policy is active', () => {
  assert.match(modal, /policyEnabled === false && \(\s*<FormField control=\{form\.control\} name=\{`stockLevels\.\$\{kiosk\.id\}\.override`\}/);
  assert.match(modal, /policyEnabled === false \? \(\s*<FormField control=\{form\.control\} name=\{`stockLevels\.\$\{kiosk\.id\}\.safetyStock`\}/);
  assert.match(modal, /policyEnabled === false && \(\s*<FormField control=\{form\.control\} name="consumptionMonths"/);
  assert.match(modal, /\.\.\.\(policyEnabled \? \{\} : \{ min: level\.min, safetyStock: level\.safetyStock, override: level\.override \}\)/);
});

test('Enter on the first step advances instead of saving, and a lead-time error returns to step 2', () => {
  assert.match(modal, /const handleWizardSubmit = \(event: React\.FormEvent<HTMLFormElement>\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*if \(currentStep < WIZARD_STEPS\.length\) void handleNext\(\);/);
  assert.match(modal, /onSubmit=\{handleWizardSubmit\}/);
  assert.match(modal, /<button type="button" onClick=\{saveNow\}/);
  assert.match(modal, /Compra direta exige prazo local maior que zero\.' \}\);\s*setCurrentStep\(2\);/);
});

test('saving is blocked while the policy is unverified and the failure is reported', () => {
  assert.match(modal, /if \(policyEnabled === null\) \{\s*setSaveError\(/);
  assert.match(modal, /disabled=\{policyEnabled === null \|\| policyLoading \|\| saving\}/);
});
