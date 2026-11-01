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
  assert.match(source, /aria-label="Seções da edição do colaborador"\s+className=\{cn\(\s+'shrink-0 overflow-x-auto'/);
});

test("no painel lateral as abas ficam no topo escuro, em formato de pasta", () => {
  const panel = readFileSync(path.join(process.cwd(), "src/components/patterns/side-panel.tsx"), "utf8");
  const page = readFileSync(path.join(process.cwd(), "src/app/dashboard/dp/collaborators/[userId]/page.tsx"), "utf8");
  assert.match(panel, /headerTabs \? <div ref=\{setTabsSlot\} data-ui="side-panel-header-tabs"/);
  assert.match(page, /kicker="Editar colaborador"[^]*?headerTabs\n/);
  assert.match(source, /createPortal\(nav, headerTabsSlot\)/);
  // A aba ativa usa a cor do corpo do painel para "abrir" sobre ele.
  assert.match(source, /active \? 'bg-ds-warm text-ds-ink' : 'text-ds-on-dark-muted hover:text-ds-on-dark'/);
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
  assert.match(source, /Unidade que paga os custos da pessoa nos relatórios/);
  assert.match(source, /Onde aparece como gestor no organograma/);
});
