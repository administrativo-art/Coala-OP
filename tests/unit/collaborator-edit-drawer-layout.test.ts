import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// O corpo do SidePanel é uma coluna flex de altura fixa: sem shrink-0, o form encolhe até o min-h
// e a barra de abas (overflow-x-auto, min-height 0) fica reduzida ao padding.
const source = readFileSync(path.join(process.cwd(), "src/components/user-management.tsx"), "utf8");

test("form do drawer do colaborador não encolhe dentro do SidePanel", () => {
  assert.match(source, /isDrawer && 'collaborator-edit-form flex shrink-0 /);
});

test("barra de abas do drawer do colaborador não encolhe", () => {
  assert.match(source, /aria-label="Seções da edição do colaborador"\s+className="[^"]*\bshrink-0\b[^"]*overflow-x-auto/);
});

test("edição do colaborador só inicializa e poda funções com os catálogos carregados", () => {
  // Antes do catálogo do RH chegar, a lista de funções é vazia e apagava a função gravada ao abrir o drawer.
  assert.match(source, /if \(hrLoading\) return;\s+const allowedFunctionIds/);
  assert.match(source, /if \(hrLoading \|\| kiosksLoading\) return;\s+const target = users\.find/);
});

test("cada escopo de visualização por unidade tem nota explicativa", () => {
  for (const scope of ["linked", "selected", "all"]) {
    assert.match(source, new RegExp(`UNIT_ACCESS_SCOPE_NOTES[^]*?\\b${scope}: '`));
  }
});

test("cada aba do drawer tem painel próprio e as linhas de unidade explicam o efeito", () => {
  const tabs = [...source.matchAll(/\{ id: '(\w+)', label: '[^']+' \}/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ["identity", "journey", "units"]);
  for (const tab of tabs) {
    assert.match(source, new RegExp(`id="collaborator-edit-panel-${tab}"`));
  }
  // Quiosques atribuídos e acesso ao PDV saem da vigência; não existe mais seletor manual de quiosque na edição.
  assert.match(source, /Os quiosques atribuídos e os acessos ao PDV saem destas unidades automaticamente/);
  assert.match(source, /<OperationalKioskSummary/);
  assert.match(source, /<PdvAccessControl/);
  assert.doesNotMatch(source, /<FormLabel>Quiosques atribuídos<\/FormLabel>/);
  assert.match(source, /<OperationalUnitPeriodsField/);
  assert.match(source, /Referência do financeiro/);
  assert.match(source, /Onde aparece como gestor no organograma/);
});
