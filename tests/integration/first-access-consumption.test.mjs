import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-repository";
assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });

const { authAdmin, dbAdmin } = await import("../../src/lib/firebase-admin.ts");
const { consumeFirstAccessLink } = await import("../../src/lib/first-access-links.ts");

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function seedLink({ token, userId, active = true }) {
  const hash = tokenHash(token);
  await authAdmin.createUser({ uid: userId, email: `${userId}@example.test`, disabled: !active });
  await Promise.all([
    dbAdmin.collection("users").doc(userId).set({
      email: `${userId}@example.test`,
      username: userId,
      isActive: active,
      mustChangePassword: true,
    }),
    dbAdmin.collection("firstAccessLinks").doc(hash).set({
      tokenId: hash.slice(0, 16),
      userId,
      onboardingId: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      usedAt: null,
      revokedAt: null,
    }),
  ]);
  return hash;
}

async function cleanup(userIds, hashes) {
  await Promise.all([
    ...userIds.map((userId) => dbAdmin.collection("users").doc(userId).delete()),
    ...hashes.map((hash) => dbAdmin.collection("firstAccessLinks").doc(hash).delete()),
    ...userIds.map((userId) => authAdmin.deleteUser(userId).catch(() => undefined)),
  ]);
}

test("somente uma requisição concorrente consome o link de primeiro acesso", async (t) => {
  const token = "first-access-concurrency-token";
  const userId = "first-access-concurrency-user";
  const hash = await seedLink({ token, userId });
  t.after(() => cleanup([userId], [hash]));

  const results = await Promise.all([
    consumeFirstAccessLink(token, "password-one"),
    consumeFirstAccessLink(token, "password-two"),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const rejected = results.find((result) => !result.ok);
  assert.ok(rejected && ["in_progress", "used"].includes(rejected.reason));

  const [link, user] = await Promise.all([
    dbAdmin.collection("firstAccessLinks").doc(hash).get(),
    dbAdmin.collection("users").doc(userId).get(),
  ]);
  assert.equal(typeof link.get("usedAt"), "string");
  assert.equal(link.get("consumption"), undefined);
  assert.equal(user.get("firstAccess.status"), "used");
  assert.equal(user.get("mustChangePassword"), false);
});

test("link de primeiro acesso não reativa cadastro inativo", async (t) => {
  const token = "first-access-inactive-token";
  const userId = "first-access-inactive-user";
  const hash = await seedLink({ token, userId, active: false });
  t.after(() => cleanup([userId], [hash]));

  const result = await consumeFirstAccessLink(token, "password-three");
  assert.deepEqual(result, { ok: false, reason: "inactive" });
  assert.equal((await authAdmin.getUser(userId)).disabled, true);
  assert.equal((await dbAdmin.collection("firstAccessLinks").doc(hash).get()).get("usedAt"), null);
});
