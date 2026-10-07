import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  formatEntityDate,
  formatEntityDateTime,
  icmsLabel,
  ieStatusLabel,
  isAttentionCadastralStatus,
  purposeLabel,
  signatoryScopeLabel,
} from '../../src/components/cadastros/entity-form-options';

const editor = readFileSync('src/components/entity-management.tsx', 'utf8');
const ficha = readFileSync('src/components/entity-ficha-modal.tsx', 'utf8');

test('entity labels map stored values to the ficha wording', () => {
  assert.equal(icmsLabel('nao_informado'), 'Não informado');
  assert.equal(icmsLabel('sim'), 'Sim');
  assert.equal(ieStatusLabel('nao_consultada'), 'Não consultada');
  assert.equal(ieStatusLabel('baixada'), 'Baixada');
  assert.equal(ieStatusLabel(undefined), '');
  assert.equal(signatoryScopeLabel(undefined), 'Somente este CNPJ');
  assert.equal(signatoryScopeLabel('cnpj_root'), 'Matriz e filiais do mesmo CNPJ-base');
  assert.equal(purposeLabel('aso'), 'ASO');
});

test('cadastral statuses that need confirmation are the same ones the save flow asks about', () => {
  assert.equal(isAttentionCadastralStatus('SUSPENSA'), true);
  assert.equal(isAttentionCadastralStatus('Baixada'), true);
  assert.equal(isAttentionCadastralStatus('INAPTA'), true);
  assert.equal(isAttentionCadastralStatus('ATIVA'), false);
  assert.equal(isAttentionCadastralStatus(undefined), false);
});

test('dates are shown as dd/mm/yyyy and unknown text is kept as is', () => {
  assert.equal(formatEntityDate('1991-04-18'), '18/04/1991');
  assert.equal(formatEntityDate('2009-03-14T00:00:00.000Z'), '14/03/2009');
  assert.equal(formatEntityDate('14/03/2009'), '14/03/2009');
  assert.equal(formatEntityDate(undefined), '');
  assert.equal(formatEntityDateTime('não é data'), 'não é data');
});

test('editor follows the handoff: dark live panel, CNPJ first, collapsible fiscal block and two-column shell', () => {
  assert.match(editor, /DialogContent hideClose flush className="[^"]*sm:max-w-\[1080px\][^"]*"/);
  assert.match(editor, /grid min-h-0 grid-cols-1 lg:h-\[800px\] lg:grid-cols-\[340px_minmax\(0,1fr\)\]/);
  assert.match(editor, /bg-\[#15151c\]/);
  assert.match(editor, /consulta automática ao completar 14 dígitos/);
  assert.match(editor, /Dados fiscais e da Receita/);
  assert.match(editor, /preenchido pela consulta/);
  assert.match(editor, /role="radiogroup" aria-label=\{label\}/);
  assert.match(editor, /<Segmented label="Contribuinte ICMS"/);
  assert.match(editor, /label="Situação da inscrição estadual"/);
  assert.match(editor, /label="Abrangência da assinatura"/);
});

test('advancing never submits the form and new records validate name and document before moving on', () => {
  assert.match(editor, /if \(currentStep < ENTITY_WIZARD_STEPS\.length\) \{\s*event\.preventDefault\(\);\s*void handleNext\(\);/);
  assert.match(editor, /if \(step > currentStep && !isEdit\) void handleNext\(\);/);
  assert.match(editor, /<button type="button" onClick=\{\(\) => void handleNext\(\)\}/);
  assert.match(editor, /<button type="submit" disabled=\{saving\}/);
});

test('save keeps the Receita confirmation and shows failures in a banner visible on any step', () => {
  assert.match(editor, /isAttentionCadastralStatus\(values\.cadastralStatus\)/);
  assert.match(editor, /window\.confirm\('A situação cadastral desta empresa exige atenção/);
  assert.match(editor, /setFormError\(error instanceof Error \? error\.message : 'Falha ao salvar cadastro\.'\)/);
  assert.match(editor, /role="alert" className="flex items-start gap-2 border-t/);
});

test('the Pix key is only edited with payment permission and never shown in the read-only ficha', () => {
  assert.match(editor, /\{canManagePix \? \(/);
  assert.match(ficha, /A chave nunca é exibida na ficha/);
  assert.match(ficha, /value: hasPix === null \? '' : hasPix \? 'Cadastrada' : 'Não cadastrada'/);
});

test('opening a row shows the ficha and each ficha section enters the matching edit step', () => {
  assert.match(editor, /<EntityFichaModal/);
  assert.match(editor, /initialStep=\{editTarget\.step\}/);
  assert.match(editor, /initialFiscalOpen=\{editTarget\.fiscal\}/);
  assert.match(ficha, /title: 'Receita Federal',\s*edit: \(\) => onEdit\(\{ step: 1, fiscal: true \}\)/);
  assert.match(ficha, /title: 'Endereço',\s*edit: \(\) => onEdit\(\{ step: 2 \}\)/);
  assert.match(ficha, /\.\.\.\(isPJ \? \[\{ id: 'fiscal' as const, label: 'Fiscal' \}\] : \[\]\)/);
});

test('inactivating from the ficha asks for confirmation before calling deleteEntity', () => {
  assert.match(editor, /onClick: \(\) => setPendingInactivate\(opened\)/);
  assert.match(editor, /<AlertDialog open=\{Boolean\(pendingInactivate\)\}/);
  assert.match(editor, /await deleteEntity\(entity\.id\)/);
});
