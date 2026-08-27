import assert from "node:assert/strict";
import test from "node:test";

import { getHrEmployeeId, isOwnHrEmployeeId } from "../../src/lib/hr/person-link";

test("usa o vínculo RH canônico antes do identificador legado", () => {
  const user = {
    id: "auth-1",
    hrEmployeeId: "rh-1",
    registrationIdBizneo: "bizneo-1",
  };

  assert.equal(getHrEmployeeId(user), "rh-1");
  assert.equal(isOwnHrEmployeeId(user, "rh-1"), true);
  assert.equal(isOwnHrEmployeeId(user, "bizneo-1"), true);
  assert.equal(isOwnHrEmployeeId(user, "auth-1"), true);
});

test("mantém compatibilidade com contas anteriores à migração", () => {
  assert.equal(getHrEmployeeId({ id: "auth-1", registrationIdBizneo: "bizneo-1" }), "bizneo-1");
  assert.equal(getHrEmployeeId({ id: "auth-1" }), "auth-1");
});

test("não reconhece cadastro de outra pessoa", () => {
  assert.equal(isOwnHrEmployeeId({ id: "auth-1", hrEmployeeId: "rh-1" }, "rh-2"), false);
});
