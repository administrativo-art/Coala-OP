import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCashClosureTransition,
  canEditCashClosure,
  canTransitionCashClosure,
} from "../../src/features/financial/cash-closures/state-machine";

test("máquina de estados aceita apenas as transições previstas", () => {
  assert.equal(canTransitionCashClosure("draft", "pending_review"), true);
  assert.equal(canTransitionCashClosure("pending_review", "approved"), true);
  assert.equal(canTransitionCashClosure("approved", "reopened"), true);
  assert.equal(canTransitionCashClosure("approved", "draft"), false);
  assert.throws(() => assertCashClosureTransition("draft", "approved"));
});

test("somente rascunho e reaberto são editáveis", () => {
  assert.equal(canEditCashClosure("draft"), true);
  assert.equal(canEditCashClosure("reopened"), true);
  assert.equal(canEditCashClosure("pending_review"), false);
  assert.equal(canEditCashClosure("approved"), false);
});
