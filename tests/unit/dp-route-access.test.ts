import assert from "node:assert/strict";
import test from "node:test";
import { canAccessDpRoute } from "../../src/lib/dp-route-access";
import type { PermissionSet } from "../../src/types";

function permissions(dp: PermissionSet["dp"]): PermissionSet {
  return { dp } as PermissionSet;
}

test("permite o perfil do colaborador com a permissão granular", () => {
  const ownProfilePermissions = permissions({
    view: false,
    collaborators: {
      view: true,
      ownProfileOnly: true,
      add: false,
      edit: false,
      syncProfile: false,
      terminate: false,
    },
  } as PermissionSet["dp"]);

  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/collaborators"), true);
  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/collaborators/luis"), true);
  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/collaborators/luis/documents"), true);
});

test("a permissão granular de perfil não libera as demais rotas do DP", () => {
  const ownProfilePermissions = permissions({
    view: false,
    collaborators: { view: true, ownProfileOnly: true },
  } as PermissionSet["dp"]);

  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp"), false);
  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/schedules"), false);
  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/settings"), false);
  assert.equal(canAccessDpRoute(ownProfilePermissions, "/dashboard/dp/collaborators-private"), false);
});

test("a permissão ampla de DP continua liberando as rotas do módulo", () => {
  const fullDpPermissions = permissions({ view: true } as PermissionSet["dp"]);

  assert.equal(canAccessDpRoute(fullDpPermissions, "/dashboard/dp"), true);
  assert.equal(canAccessDpRoute(fullDpPermissions, "/dashboard/dp/schedules"), true);
});
