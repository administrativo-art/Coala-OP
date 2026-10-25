import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";

import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

const PROJECT_ID = "demo-coala-e2e";
const DEV = {
  uid: "developer-view-as-e2e",
  email: "administrativo@coalashakes.com",
  password: "coala-view-as-e2e-2026",
};
const TARGET = {
  uid: "developer-view-as-target-e2e",
  email: "target.view-as.e2e@coala.test",
};

test("DEV navega como o alvo sem trocar o ator nem permitir escrita", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: PROJECT_ID });
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!authHost || !/^(127\.0\.0\.1|localhost):\d+$/.test(authHost)) {
    throw new Error("Auth emulator required");
  }

  const app = getApps().find((candidate) => candidate.name === "developer-view-as-e2e")
    ?? initializeApp({ projectId: PROJECT_ID }, "developer-view-as-e2e");
  const auth = getAuth(app);
  const db = getFirestore(app, "coala");
  const profileId = "developer-view-as-profile-e2e";
  const actionRefs: DocumentReference[] = [];

  const existingDeveloper = await auth.getUserByEmail(DEV.email).catch(() => null);
  if (existingDeveloper) await auth.deleteUser(existingDeveloper.uid);
  await Promise.all([
    auth.getUser(DEV.uid).then(() => auth.deleteUser(DEV.uid)).catch(() => undefined),
    auth.getUser(TARGET.uid).then(() => auth.deleteUser(TARGET.uid)).catch(() => undefined),
  ]);

  try {
    await auth.createUser({
      uid: DEV.uid,
      email: DEV.email,
      password: DEV.password,
      emailVerified: true,
      displayName: "Desenvolvimento E2E",
    });
    await auth.createUser({
      uid: TARGET.uid,
      email: TARGET.email,
      password: "target-view-as-e2e-2026",
      emailVerified: true,
      displayName: "Usuário Visualizado E2E",
    });
    const now = new Date().toISOString();
    await db.collection("profiles").doc(profileId).set({
      name: "Perfil restrito E2E",
      permissions: {},
      isDefaultAdmin: false,
    });
    await db.collection("users").doc(DEV.uid).set({
      username: "Desenvolvimento E2E",
      email: DEV.email,
      profileId,
      assignedKioskIds: [],
      isActive: true,
      profileCompliance: { status: "complete", policyVersion: 1, missingFields: [], invalidFields: [], evaluatedAt: now },
    });
    await db.collection("users").doc(TARGET.uid).set({
      username: "Usuário Visualizado E2E",
      email: TARGET.email,
      profileId,
      assignedKioskIds: [],
      isActive: true,
    });

    const login = await request.post(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`,
      { data: { email: DEV.email, password: DEV.password, returnSecureToken: true } },
    );
    expect(login.status()).toBe(200);
    const { idToken } = await login.json() as { idToken: string };
    const authenticated = { Authorization: `Bearer ${idToken}` };

    const directory = await request.get("/api/auth/view-as", { headers: authenticated });
    expect(directory.status()).toBe(200);
    expect((await directory.json()).users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: TARGET.uid, email: TARGET.email }),
    ]));

    const started = await request.post("/api/auth/view-as", {
      headers: authenticated,
      data: { targetUserId: TARGET.uid },
    });
    expect(started.status()).toBe(200);
    expect(started.headers()["set-cookie"]).toContain("coala_dev_view_as=");

    const viewHeaders = { ...authenticated, "x-coala-view-as": TARGET.uid };
    const bootstrap = await request.get("/api/client/bootstrap?collections=currentUser", { headers: viewHeaders });
    expect(bootstrap.status()).toBe(200);
    expect((await bootstrap.json()).currentUser).toEqual(expect.objectContaining({
      id: TARGET.uid,
      email: TARGET.email,
    }));

    const blockedWrite = await request.post("/api/auth/last-login", { headers: viewHeaders });
    expect(blockedWrite.status()).not.toBe(200);
    expect((await db.collection("users").doc(TARGET.uid).get()).get("lastLoginAt")).toBeUndefined();

    const stopped = await request.delete("/api/auth/view-as", { headers: viewHeaders });
    expect(stopped.status()).toBe(200);
    expect(stopped.headers()["set-cookie"]).toContain("Max-Age=0");

    const actions = await db.collection("actionLogs").where("user_id", "==", DEV.uid).get();
    actionRefs.push(...actions.docs.map((document) => document.ref));
    expect(actions.docs.map((document) => document.get("action"))).toEqual(expect.arrayContaining([
      "developer_view_as_started",
      "developer_view_as_stopped",
    ]));
    expect(actions.docs.every((document) => document.get("user_id") === DEV.uid)).toBe(true);
  } finally {
    await Promise.all(actionRefs.map((reference) => reference.delete()));
    await Promise.all([
      db.collection("users").doc(DEV.uid).delete(),
      db.collection("users").doc(TARGET.uid).delete(),
      db.collection("profiles").doc(profileId).delete(),
    ]);
    await Promise.all([
      auth.deleteUser(DEV.uid).catch(() => undefined),
      auth.deleteUser(TARGET.uid).catch(() => undefined),
    ]);
  }
});
