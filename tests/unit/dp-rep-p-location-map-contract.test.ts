import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const map = readFileSync('src/features/dp/rep-p/unit-location-map.tsx', 'utf8');
const modal = readFileSync('src/features/dp/rep-p/location-policy-control.tsx', 'utf8');

test('busca é o único endereço e nasce com o cadastro oficial', () => {
  assert.match(map, /autocomplete\.value = initialAddress\?\.trim\(\) \?\? ""/);
  assert.match(map, /geocoder\.geocode\(\{ address: initialAddress\.trim\(\), region: "BR" \}\)/);
  assert.match(map, /autocomplete!\.value = formatted/);
  assert.doesNotMatch(modal, /Endereço oficial atual|Novo local selecionado/);
  assert.equal((modal.match(/Endereço da unidade/g) ?? []).length, 1);
});

test('clique e arraste atualizam o mesmo endereço pela geocodificação reversa', () => {
  assert.match(map, /applyPosition\(next\.lat\(\), next\.lng\(\), false, true\)/);
  assert.match(map, /applyPosition\(event\.latLng\.lat\(\), event\.latLng\.lng\(\), false, true\)/);
  assert.match(map, /autocomplete\.value = formatted/);
  assert.match(map, /callbacksRef\.current\.onAddress\(formatted\)/);
  assert.match(map, /currentOperation !== operation/);
  assert.match(map, /onAddressReadyChange\(false\)/);
  assert.match(map, /onAddressReadyChange\(true\)/);
  assert.match(map, /const resolveAddress[\s\S]*?onAddressReadyChange\(false\);\n\s*setError\(null\)/);
  assert.match(modal, /!pointChosen \|\| !addressReady/);
});

test('modal usa cabeçalho e rodapé do formulário padrão', () => {
  assert.match(modal, /<DialogContent className="flex max-h-\[90vh\] max-w-2xl flex-col overflow-hidden p-0">/);
  assert.match(modal, /<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">/);
  assert.match(modal, /<DialogFooter className="items-center justify-between/);
  assert.match(modal, /<Button variant="ds-ghost" size="md" disabled=\{busy\}/);
  assert.match(modal, />Cancelar<\/Button>/);
  assert.match(modal, />Salvar área<\/Button>/);
});

test('não oferece edição parcial entre endereço e centro da área', () => {
  assert.match(modal, /if \(!canManage \|\| !canManageAddress\) return null/);
  assert.doesNotMatch(modal, /Somente quem administra unidades pode alterar o endereço oficial/);
  assert.doesNotMatch(modal, /Latitude|Longitude|Colar coordenadas/);
});
