import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandwrittenResignationGuide,
  handwrittenLetterWasConfirmed,
} from "../../src/features/hr/termination/resignation-guide";

test("modelo manuscrito inclui somente o texto do aviso que o colaborador escolheu", () => {
  const worked = buildHandwrittenResignationGuide({
    employeeName: "Colaborador Teste",
    jobRoleName: "Atendente",
    noticePreference: "work",
  });
  const waiver = buildHandwrittenResignationGuide({
    employeeName: "Colaborador Teste",
    jobRoleName: "Atendente",
    noticePreference: "request_waiver",
  });

  assert.match(worked, /cumprirei o aviso-prévio de 30 dias/);
  assert.doesNotMatch(worked, /Solicito a dispensa/);
  assert.match(waiver, /Solicito a dispensa/);
  assert.doesNotMatch(waiver, /cumprirei o aviso-prévio de 30 dias/);
  assert.match(worked, /Colaborador Teste/);
  assert.match(worked, /Atendente/);
});

test("confirmação da política manuscrita aceita apenas declaração explícita", () => {
  assert.equal(handwrittenLetterWasConfirmed(true), true);
  assert.equal(handwrittenLetterWasConfirmed("true"), true);
  assert.equal(handwrittenLetterWasConfirmed(false), false);
  assert.equal(handwrittenLetterWasConfirmed("false"), false);
  assert.equal(handwrittenLetterWasConfirmed(undefined), false);
});
