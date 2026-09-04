import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Gestão do colaborador é agrupador e Perfil do colaborador é o destino autorizado", async () => {
  const source = await readFile(new URL("../../src/components/sidebar.tsx", import.meta.url), "utf8");
  const start = source.indexOf('label: "Gestão do colaborador"');
  const end = source.indexOf('{ label: "Organograma"', start);
  const group = source.slice(start, end);

  assert.ok(start >= 0 && end > start, "grupo Gestão do colaborador não encontrado");
  assert.match(group, /href:\s*"__group:collaborator-management"/u);
  assert.match(group, /label:\s*"Perfil do colaborador"/u);
  assert.match(group, /show:\s*permissions\.dp\?\.collaborators\?\.view/u);
  assert.match(group, /ownProfileOnly\s*===\s*true/u);
  assert.match(group, /`\/dashboard\/dp\/collaborators\/\$\{user\.id\}`/u);
  assert.ok(
    group.indexOf('label: "Perfil do colaborador"') < group.indexOf('label: "Integração"'),
    "Perfil do colaborador deve ser o primeiro destino do grupo",
  );
});

test("permissões nomeiam acesso e alcance do Perfil do colaborador", async () => {
  const source = await readFile(new URL("../../src/components/profile-management-modal.tsx", import.meta.url), "utf8");

  assert.match(source, /Acessar perfil do colaborador/u);
  assert.match(source, /Restringir ao próprio perfil/u);
  assert.doesNotMatch(source, /Visualizar Gestão do colaborador/u);
});
