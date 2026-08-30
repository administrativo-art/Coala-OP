import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCashClosureTransition,
  canEditCashClosure,
  canTransitionCashClosure,
} from "../../src/features/financial/cash-closures/state-machine";

test("máquina de estados aceita apenas as transições previstas", () => {
  assert.equal(canTransitionCashClosure("draft", "approved"), true);
  assert.equal(canTransitionCashClosure("draft", "pending_review"), false);
  assert.equal(canTransitionCashClosure("pending_review", "approved"), true);
  assert.equal(canTransitionCashClosure("approved", "reopened"), true);
  assert.equal(canTransitionCashClosure("approved", "draft"), false);
  assert.throws(() => assertCashClosureTransition("draft", "pending_review"));
});

test("rascunho, reaberto e revisões legadas são editáveis", () => {
  assert.equal(canEditCashClosure("draft"), true);
  assert.equal(canEditCashClosure("reopened"), true);
  assert.equal(canEditCashClosure("pending_review"), true);
  assert.equal(canEditCashClosure("approved"), false);
});
