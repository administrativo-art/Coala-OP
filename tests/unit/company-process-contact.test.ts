import assert from "node:assert/strict";
import test from "node:test";

import { companyEmailPurposeIndex } from "../../src/lib/company/company-process-contact";

test("indexa finalidades válidas uma única vez e na ordem canônica", () => {
  assert.deepEqual(companyEmailPurposeIndex({
    status: "active",
    contact: {
      emails: [
        { purposes: ["vacation", "onboarding", "vacation", "unknown"] },
        { purposes: ["termination"] },
      ],
    },
  }), ["onboarding", "termination", "vacation"]);
});

test("remove empresa inativa do índice de contatos operacionais", () => {
  assert.deepEqual(companyEmailPurposeIndex({
    status: "inactive",
    contact: { emails: [{ purposes: ["onboarding", "vacation"] }] },
  }), []);
});

test("mescla atualização parcial com o cadastro persistido", () => {
  const persisted = {
    status: "active",
    contact: { emails: [{ purposes: ["onboarding", "termination"] }] },
  };
  assert.deepEqual(companyEmailPurposeIndex({ status: "inactive" }, persisted), []);
  assert.deepEqual(companyEmailPurposeIndex({ status: "active" }, persisted), ["onboarding", "termination"]);
});
