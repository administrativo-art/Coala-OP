import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("autenticação do servidor verifica revogação e atividade da conta", async () => {
  const auth = await source("src/lib/verify-auth.ts");
  assert.match(auth, /verifyIdToken\(idToken, true\)/);
  assert.match(auth, /userSnap\.get\(['"]isActive['"]\) === false/);
});

test("suspensão preserva cadastro, invalida sessão e alcança os três bancos", async () => {
  const [shared, functions, termination] = await Promise.all([
    source("src/lib/identity-lifecycle.server.ts"),
    source("functions/src/index.ts"),
    source("src/features/hr/termination/server.ts"),
  ]);
  assert.match(shared, /storedSessionVersion\(snapshot\.get\("sessionVersion"\)\) \+ 1/);
  assert.match(shared, /revokeRefreshTokens\(params\.userId\)/);
  assert.match(shared, /rh_access_cache/);
  assert.match(shared, /financialDbAdmin/);
  assert.match(functions, /auth\.revokeRefreshTokens\(uid\)/);
  assert.match(functions, /sessionVersion: nextVersion/);
  assert.equal(termination.match(/suspendIdentityAccess\(\{/g)?.length, 2);
});

test("funções callable com privilégio validam atividade e versão da sessão", async () => {
  const [guard, functions, rhSync, fieldUpdate] = await Promise.all([
    source("functions/src/active-session.ts"),
    source("functions/src/index.ts"),
    source("functions/src/rh/sync.ts"),
    source("functions/src/rh/field-update.ts"),
  ]);
  assert.match(guard, /user\.isActive === false \|\| user\.active === false/);
  assert.match(guard, /identity\.token\.sessionVersion/);
  assert.equal(functions.match(/assertActiveSession\(db, request\.auth\)/g)?.length, 5);
  assert.match(rhSync, /assertActiveSession\(db, request\.auth\)/);
  assert.match(fieldUpdate, /assertActiveSession\(db, request\.auth\)/);
});

test("primeiro acesso não reabilita Auth e reserva antes de alterar a senha", async () => {
  const firstAccess = await source("src/lib/first-access-links.ts");
  const reserveAt = firstAccess.indexOf("const reservation = await reserveFirstAccessLink(token)");
  const passwordAt = firstAccess.indexOf("authAdmin.updateUser(reservation.userId, { password })");
  assert.ok(reserveAt >= 0 && passwordAt > reserveAt);
  assert.doesNotMatch(firstAccess, /disabled:\s*false/);
  assert.match(firstAccess, /consumption: \{ state: "reserved"/);
});
