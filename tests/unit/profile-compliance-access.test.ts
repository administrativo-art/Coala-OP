import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import {
  hasCurrentProfileCompliance,
  requestAllowsIncompleteProfile,
} from "../../src/features/hr/profile-compliance-access.server";

test("libera somente as rotas mínimas durante a atualização obrigatória", () => {
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/profile-compliance")), true);
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/profile-compliance/overview")), false);
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/auth/password-changed")), true);
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/client/bootstrap?collections=currentUser")), true);
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/client/bootstrap?collections=currentUser,profiles")), false);
  assert.equal(requestAllowsIncompleteProfile(new NextRequest("https://coala.test/api/financial/data")), false);
});

test("mantém o acesso de um cadastro completo sem exigir reconfirmação trimestral", () => {
  const confirmedNow = {
    profileCompliance: {
      status: "complete",
      policyVersion: 1,
      lastConfirmedAt: "2026-07-01T03:00:00.000Z",
    },
  };
  assert.equal(hasCurrentProfileCompliance(confirmedNow), true);
  assert.equal(hasCurrentProfileCompliance({ isDefaultAdmin: true }), false);
});
