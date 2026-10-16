import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

test("Configurações operacionais mantém navegação de contexto fora do painel escuro", async () => {
  const [workspaceSource, uiSource, baseSource, derivedSource, entitiesSource, unitsSource, designSource] = await Promise.all([
    readFile(path.join(process.cwd(), "src/components/cadastros/cadastros-workspace.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/cadastros/cadastros-ui.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/base-product-management.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/item-management.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/entity-management.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "src/components/dp/dp-settings-units.tsx"), "utf8"),
    readFile(path.join(process.cwd(), "docs/design/estrutura-e-navegacao.md"), "utf8"),
  ]);

  assert.match(workspaceSource, /<CadastrosTabs[\s\S]*<BaseProductManagement/);
  assert.match(uiSource, /aria-label="Tipos de cadastro"/);
  assert.match(uiSource, /bg-ds-surface font-extrabold/);
  assert.doesNotMatch(uiSource, /border-b border-white\/10 sm:grid-cols-3/);
  assert.doesNotMatch(baseSource, /tabs=\{tabs\}/);
  assert.doesNotMatch(derivedSource, /tabs=\{tabs\}/);
  assert.doesNotMatch(entitiesSource, /tabs=\{tabs\}/);
  assert.match(unitsSource, /<CadastrosTabs[\s\S]*<CadastrosHero/);
  assert.doesNotMatch(unitsSource, /tabs=\{<CadastrosTabs/);
  assert.match(designSource, /Abas que trocam a seção ou o tipo de cadastro pertencem à faixa clara de navegação/);
});
