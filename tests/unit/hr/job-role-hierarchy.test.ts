import assert from "node:assert/strict";
import test from "node:test";

import { planExecutiveJobRoleHierarchy } from "../../../src/features/hr/lib/job-role-hierarchy";

test("coloca o vice abaixo do diretor geral e as diretorias abaixo do vice", () => {
  const plan = planExecutiveJobRoleHierarchy([
    { id: "geral", name: "Diretor geral", parentId: null, reportsTo: null },
    { id: "vice", name: "Vice-diretor geral", parentId: "geral", reportsTo: "geral" },
    { id: "financeiro", name: "Diretor financeiro", parentId: "geral", reportsTo: "geral" },
    { id: "operacional", name: "Diretor operacional", parentId: "geral", reportsTo: "geral" },
    { id: "gerente", name: "Gerente financeiro", parentId: "financeiro", reportsTo: "financeiro" },
  ]);

  assert.deepEqual(plan.updates, [
    {
      id: "financeiro",
      name: "Diretor financeiro",
      parentId: "vice",
      reportsTo: "vice",
    },
    {
      id: "operacional",
      name: "Diretor operacional",
      parentId: "vice",
      reportsTo: "vice",
    },
  ]);
});

test("repara as duas referências do vice e reconhece variações com hífen e acento", () => {
  const plan = planExecutiveJobRoleHierarchy([
    { id: "geral", name: "Diretor-Geral" },
    { id: "vice", name: "Vice-Diretor Geral", parentId: null, reportsTo: null },
    { id: "rh", name: "Diretor de RH | Gestão estratégica", parentId: "vice", reportsTo: null },
  ]);

  assert.deepEqual(plan.updates, [
    {
      id: "vice",
      name: "Vice-Diretor Geral",
      parentId: "geral",
      reportsTo: "geral",
    },
    {
      id: "rh",
      name: "Diretor de RH | Gestão estratégica",
      parentId: "vice",
      reportsTo: "vice",
    },
  ]);
});

test("é idempotente quando a hierarquia já está correta", () => {
  const plan = planExecutiveJobRoleHierarchy([
    { id: "geral", name: "Diretor geral", parentId: null, reportsTo: null },
    { id: "vice", name: "Vice-diretor geral", parentId: "geral", reportsTo: "geral" },
    { id: "financeiro", name: "Diretor financeiro", parentId: "vice", reportsTo: "vice" },
  ]);

  assert.deepEqual(plan.updates, []);
});
