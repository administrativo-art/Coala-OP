import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const screen = readFileSync("src/components/asset-management.tsx", "utf8");
const wizard = readFileSync("src/components/patterns/wizard-modal.tsx", "utf8");
const collaboratorAssets = readFileSync("src/components/collaborator-assets.tsx", "utf8");

test("detalhe patrimonial usa as cinco etapas horizontais na ordem aprovada", () => {
  assert.match(screen, /stepper="top"/);
  const labels = ["Identificação", "Auditoria e manutenção", "Localização e posse", "Aquisição", "Histórico geral"];
  let cursor = -1;
  for (const label of labels) {
    const next = screen.indexOf(`label: '${label}'`, cursor + 1);
    assert.ok(next > cursor, `etapa ${label} deve estar na ordem`);
    cursor = next;
  }
  assert.match(wizard, /overflow-x-auto/);
  assert.match(wizard, /headerActions/);
});

test("posse, movimentação, auditoria e preventiva chamam contratos separados", () => {
  assert.match(screen, /locationAction === 'custody'/);
  assert.match(screen, /custody-transfers/);
  assert.match(screen, /\/movements/);
  assert.match(screen, /\/audits/);
  assert.match(screen, /maintenance-plans/);
  assert.match(screen, /Gerar termo de entrega/);
  assert.match(screen, /disabled=\{movSaving \|\| !permissions\.assets\?\.transfer\}/);
  assert.match(screen, /setLifecycleVersion\(result\.lifecycleVersion\)/);
  assert.match(screen, /refreshAssets\(\)/);
});

test("histórico oferece filtros e exportações server-side sem inventar eventos", () => {
  assert.match(screen, /Exportar CSV/);
  assert.match(screen, /Exportar PDF/);
  assert.match(screen, /historyFilter/);
  assert.match(screen, /value: 'lifecycle', label: 'Posse e local'/);
  assert.match(screen, /Nenhum evento encontrado neste filtro/);
  assert.match(screen, /\/history\?format=/);
});

test("leituras paginadas e perfil do colaborador usam APIs bounded", () => {
  assert.match(screen, /audits\/list\?limit=20/);
  assert.match(screen, /maintenance-plans\/list\?limit=20/);
  assert.match(screen, /maintenance-occurrences\/list\?limit=20/);
  assert.match(screen, /Carregar mais eventos/);
  assert.match(collaboratorAssets, /\/api\/users\/\$\{encodeURIComponent\(userId\)\}\/assets/);
  assert.doesNotMatch(collaboratorAssets, /serial|imei|phone|telefone/i);
});
