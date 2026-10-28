import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { belongsToTimeClosureRoster, isWorkforceEmploymentRelationship } from "../../src/lib/hr/employment-relationship";

test("CLT, aprendiz e estágio têm jornada; PJ, societário e cadastro sem vínculo não", () => {
  assert.equal(isWorkforceEmploymentRelationship("clt"), true);
  assert.equal(isWorkforceEmploymentRelationship("apprenticeship"), true);
  assert.equal(isWorkforceEmploymentRelationship("internship"), true);
  assert.equal(isWorkforceEmploymentRelationship("pj"), false);
  assert.equal(isWorkforceEmploymentRelationship("partner"), false);
  assert.equal(isWorkforceEmploymentRelationship(undefined), false);
  assert.equal(isWorkforceEmploymentRelationship("desconhecido"), false);
});

test("fechamento de ponto inclui cadastro sem vínculo e exclui só PJ e societário", () => {
  for (const value of ["clt", "apprenticeship", "internship", undefined, null, ""]) {
    assert.equal(belongsToTimeClosureRoster(value), true, String(value));
  }
  assert.equal(belongsToTimeClosureRoster("pj"), false);
  assert.equal(belongsToTimeClosureRoster("partner"), false);
});

test("escala, fechamento de ponto e metas não leem mais os interruptores Operacional e Metas", () => {
  const files = [
    "src/components/dp/dp-schedule-editor.tsx",
    "src/components/bulk-edit-schedule-modal.tsx",
    "src/components/schedule-table.tsx",
    "src/features/dp/time-adjustments/closure.server.ts",
    "src/features/dp/time-adjustments/closure-section.tsx",
    "src/components/add-employee-goal-modal.tsx",
    "src/components/goal-template-form-modal.tsx",
    "src/components/user-management.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.operacional\b|'operacional'|participatesInGoals/, file);
  }
  for (const file of files.slice(0, 3)) {
    assert.match(readFileSync(file, "utf8"), /isWorkforceEmploymentRelationship\(/, file);
  }
  for (const file of files.slice(3, 5)) {
    assert.match(readFileSync(file, "utf8"), /belongsToTimeClosureRoster\(/, file);
  }
});
