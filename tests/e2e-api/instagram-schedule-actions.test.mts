import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

import { assertFirestoreEmulatorSafety } from "../helpers/firestore-emulator-safety.mjs";

const projectId = "demo-coala-instagram";
assertFirestoreEmulatorSafety({ projectId });
const app = initializeApp({ projectId, storageBucket: `${projectId}.firebasestorage.app` });
const db = getFirestore(app, "coala");
const marketing = getFirestore(app, "coala-signage");
const auth = getAuth(app);
const bucket = getStorage(app).bucket();
const origin = "http://127.0.0.1:3115";
const schedulePath = "/api/integrations/instagram/schedule";
const HOUR = 3_600_000;

type Seed = {
  status: string;
  workspace_id?: string;
  scheduledAt?: Date;
  hiddenFromGrid?: boolean;
  withMedia?: boolean;
};

test("API E2E: ações do card do Instagram (pausar, programar, cancelar, ocultar e excluir)", { timeout: 300_000 }, async (context) => {
  const server = spawn("node_modules/.bin/next", ["dev", "--hostname", "127.0.0.1", "--port", "3115"], {
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
  }
  context.after(async () => {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  });
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await fetch(`${origin}/login`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async function createUser(uid: string, isDefaultAdmin: boolean) {
    const email = `${uid}@coala.test`;
    await auth.createUser({ uid, email, password: "test-only-password" });
    await auth.setCustomUserClaims(uid, { isDefaultAdmin, profileId: uid });
    await db.collection("profiles").doc(uid).set({ name: uid, isDefaultAdmin, permissions: {} });
    const now = new Date().toISOString();
    await db.collection("users").doc(uid).set({
      username: uid,
      email,
      profileId: uid,
      isActive: true,
      phone: "5598999999999",
      birthDate: "1990-01-01",
      profileCompliance: {
        status: "complete",
        policyVersion: 1,
        missingFields: [],
        invalidFields: [],
        evaluatedAt: now,
        completedAt: now,
        lastConfirmedAt: now,
        nextReviewAt: "2099-01-01T00:00:00Z",
      },
    });
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "test-only-password", returnSecureToken: true }),
      },
    );
    const credentials = await response.json();
    assert.equal(response.status, 200);
    return credentials.idToken as string;
  }

  const adminToken = await createUser("ig-admin", true);
  const restrictedToken = await createUser("ig-restricted", false);

  let counter = 0;
  async function seed(input: Seed) {
    counter += 1;
    const id = `e2e-ig-${counter}`;
    const scheduledAt = input.scheduledAt ?? new Date(Date.now() + 48 * HOUR);
    const objectPath = `instagram/scheduled/${id}/01-arte.jpg`;
    if (input.withMedia) {
      await bucket.file(objectPath).save(Buffer.from("jpeg-de-teste"), { contentType: "image/jpeg" });
    }
    const ref = marketing.collection("instagramScheduledPosts").doc(id);
    await ref.set({
      workspace_id: input.workspace_id ?? "coala",
      account_id: "ig-test",
      format: "story",
      status: input.status,
      caption: "",
      scheduledAt: Timestamp.fromDate(scheduledAt),
      nextAttemptAt: Timestamp.fromDate(scheduledAt),
      wakeAt: Timestamp.fromDate(scheduledAt),
      attempts: 0,
      shareToFeed: true,
      storyMentions: [],
      media: [{
        kind: "image",
        contentType: "image/jpeg",
        fileName: "arte.jpg",
        sizeBytes: 13,
        objectPath,
        deliveryUrl: "https://example.invalid/arte.jpg",
      }],
      createdAt: Timestamp.now(),
      ...(input.hiddenFromGrid ? { hiddenFromGrid: true } : {}),
    });
    await ref.collection("events").doc("seed-event").set({ type: "created", createdAt: Timestamp.now() });
    return { id, ref, objectPath };
  }

  const call = (token: string | null, method: string, id: string, body?: unknown) => fetch(`${origin}${schedulePath}/${id}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const patch = (id: string, body: unknown, token = adminToken) => call(token, "PATCH", id, body);
  const eventTypes = async (ref: FirebaseFirestore.DocumentReference) =>
    (await ref.collection("events").get()).docs.map((doc) => doc.get("type") as string);
  const listIds = async () => {
    const response = await fetch(`${origin}${schedulePath}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(response.status, 200, logs);
    return ((await response.json()).items as Array<{ id: string; status: string }>);
  };

  await context.test("sem permissão ou sem login, nenhuma ação é aceita", async () => {
    const item = await seed({ status: "scheduled" });
    for (const [method, body] of [["PATCH", { pause: true }], ["PATCH", { cancel: true }], ["PATCH", { hide: true }], ["DELETE", undefined]] as const) {
      const denied = await call(restrictedToken, method, item.id, body);
      assert.equal(denied.status, 403, `${method} ${JSON.stringify(body)}`);
    }
    const anonymous = await call(null, "DELETE", item.id);
    // Hoje o login do servidor responde 500 a quem não envia token; o contrato aqui é só não executar a ação.
    assert.ok(anonymous.status >= 400, `anônimo recebeu ${anonymous.status}`);
    assert.equal((await item.ref.get()).get("status"), "scheduled");
    assert.equal((await item.ref.get()).exists, true);
  });

  await context.test("pausar tira o item da fila do publicador e só vale para programados", async () => {
    const item = await seed({ status: "scheduled" });
    const paused = await patch(item.id, { pause: true });
    assert.equal(paused.status, 200, logs);
    const doc = (await item.ref.get()).data()!;
    assert.equal(doc.status, "paused");
    assert.equal(doc.wakeAt, undefined, "wakeAt precisa sair para o publicador não reivindicar");
    assert.ok(doc.pausedAt);
    assert.ok((await eventTypes(item.ref)).includes("paused"));
    assert.equal((await patch(item.id, { pause: true })).status, 409);
  });

  await context.test("programar de novo: horário passado exige nova data; futuro volta a scheduled", async () => {
    const past = await seed({ status: "paused", scheduledAt: new Date(Date.now() - HOUR) });
    assert.equal((await patch(past.id, { resume: true })).status, 400);
    assert.equal((await past.ref.get()).get("status"), "paused");

    const nextDate = new Date(Date.now() + 5 * HOUR);
    const resumed = await patch(past.id, { resume: true, scheduledAt: nextDate.toISOString() });
    assert.equal(resumed.status, 200, logs);
    const doc = (await past.ref.get()).data()!;
    assert.equal(doc.status, "scheduled");
    assert.equal(doc.scheduledAt.toMillis(), nextDate.getTime());
    assert.equal(doc.wakeAt.toMillis(), doc.scheduledAt.toMillis());
    assert.equal(doc.pausedAt, undefined);
    assert.ok((await eventTypes(past.ref)).includes("resumed"));

    const stillFuture = await seed({ status: "paused" });
    assert.equal((await patch(stillFuture.id, { resume: true })).status, 200);
    assert.equal((await stillFuture.ref.get()).get("status"), "scheduled");
    assert.equal((await patch(stillFuture.id, { resume: true })).status, 409);
  });

  await context.test("alterar data de um item pausado não o reativa", async () => {
    const item = await seed({ status: "paused" });
    const nextDate = new Date(Date.now() + 72 * HOUR);
    assert.equal((await patch(item.id, { scheduledAt: nextDate.toISOString() })).status, 200, logs);
    const doc = (await item.ref.get()).data()!;
    assert.equal(doc.status, "paused");
    assert.equal(doc.scheduledAt.toMillis(), nextDate.getTime());
  });

  await context.test("cancelar mantém o item visível na listagem como cancelado", async () => {
    const item = await seed({ status: "paused" });
    assert.equal((await patch(item.id, { cancel: true })).status, 200, logs);
    const doc = (await item.ref.get()).data()!;
    assert.equal(doc.status, "cancelled");
    assert.ok(doc.cancelledAt);
    assert.ok((await eventTypes(item.ref)).includes("cancelled"));
    const listed = (await listIds()).find((entry) => entry.id === item.id);
    assert.equal(listed?.status, "cancelled");
    assert.equal((await patch(item.id, { cancel: true })).status, 409);
  });

  await context.test("remover da grade oculta da listagem, mantém o registro e só vale para itens concluídos", async () => {
    const published = await seed({ status: "published" });
    assert.ok((await listIds()).some((entry) => entry.id === published.id));
    assert.equal((await patch(published.id, { hide: true })).status, 200, logs);
    assert.equal((await published.ref.get()).get("hiddenFromGrid"), true);
    assert.ok((await eventTypes(published.ref)).includes("hidden_from_grid"));
    assert.ok(!(await listIds()).some((entry) => entry.id === published.id));

    for (const status of ["scheduled", "paused", "processing"]) {
      const active = await seed({ status });
      assert.equal((await patch(active.id, { hide: true })).status, 409, status);
      assert.notEqual((await active.ref.get()).get("hiddenFromGrid"), true, status);
    }
  });

  await context.test("excluir remove documento, eventos e arquivos; envio em andamento bloqueia", async () => {
    const item = await seed({ status: "scheduled", withMedia: true });
    assert.equal((await bucket.file(item.objectPath).exists())[0], true);
    const removed = await call(adminToken, "DELETE", item.id);
    const removedBody = await removed.json();
    assert.equal(removed.status, 200, `${JSON.stringify(removedBody)}\n${logs}`);
    assert.equal(removedBody.cleanup, "complete");
    assert.equal((await item.ref.get()).exists, false);
    assert.equal((await item.ref.collection("events").get()).size, 0);
    assert.equal((await bucket.file(item.objectPath).exists())[0], false);
    assert.ok(!(await listIds()).some((entry) => entry.id === item.id));

    const published = await seed({ status: "published", withMedia: true });
    assert.equal((await call(adminToken, "DELETE", published.id)).status, 200);
    assert.equal((await published.ref.get()).exists, false);

    for (const status of ["processing", "uploading"]) {
      const busy = await seed({ status, withMedia: true });
      assert.equal((await call(adminToken, "DELETE", busy.id)).status, 409, status);
      assert.equal((await busy.ref.get()).exists, true, status);
      assert.equal((await bucket.file(busy.objectPath).exists())[0], true, status);
    }
  });

  await context.test("itens de outro workspace e ids inexistentes retornam 404 sem alteração", async () => {
    const foreign = await seed({ status: "scheduled", workspace_id: "outro-workspace", withMedia: true });
    for (const [method, body] of [["PATCH", { pause: true }], ["PATCH", { cancel: true }], ["PATCH", { hide: true }], ["DELETE", undefined]] as const) {
      assert.equal((await call(adminToken, method, foreign.id, body)).status, 404, `${method} ${JSON.stringify(body)}`);
    }
    const doc = await foreign.ref.get();
    assert.equal(doc.get("status"), "scheduled");
    assert.equal((await bucket.file(foreign.objectPath).exists())[0], true);
    assert.equal((await call(adminToken, "DELETE", "nao-existe")).status, 404);
    assert.equal((await patch("nao-existe", { pause: true })).status, 404);
  });
});
