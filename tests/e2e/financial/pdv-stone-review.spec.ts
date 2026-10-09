import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";
import { latestPublishedDate } from "../../../src/features/financial/receivables/period-review";

test("PDV × Stone API enforces admin, bounded input, official unit mapping and stored filial", async ({ request }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Auth emulator required");
  const app = getApps().find(a => a.name === "pdv-stone-review-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "pdv-stone-review-e2e");
  const db = getFirestore(app, "coala");
  const financial = getFirestore(app, "coala-financeiro");
  const query = { kioskId: "pdv-review-e2e-unit", mappingId: "pdv-review-e2e-map", stoneCode: "9876543210123", referenceDate: "2026-09-20" };
  const post = (token?: string, data: unknown = query) => request.post("/api/financial/pdv-stone-review", {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, data,
  });
  const calendarPath = `/api/financial/pdv-stone-review?${new URLSearchParams({ resource: "calendar",
    kioskId: query.kioskId, mappingId: query.mappingId, stoneCode: query.stoneCode,
    from: "2026-01-01", through: "2026-09-20" })}`;
  const get = (token?: string, path = calendarPath) => request.get(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect((await post()).status()).toBe(401);
  expect((await get()).status()).toBe(401);
  const signup = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { data: { returnSecureToken: true } });
  expect(signup.ok()).toBeTruthy();
  const restricted = await signup.json();
  const restrictedRef = db.collection("users").doc(restricted.localId);
  const mappingRef = financial.collection("stoneMerchantMappings").doc(query.mappingId);
  const unitRef = db.collection("kiosks").doc(query.kioskId);
  const accountRef = financial.collection("bankAccounts").doc("pdv-review-e2e-account");
  try {
    await restrictedRef.set({ isActive: true, assignedKioskIds: [], profileCompliance: { status: "complete", policyVersion: 1 } });
    expect((await post(restricted.idToken)).status()).toBe(403);
    expect((await get(restricted.idToken)).status()).toBe(403);
    const login = await request.post(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo`, {
      data: { email: E2E_USER.email, password: E2E_USER.password, returnSecureToken: true },
    });
    expect(login.ok()).toBeTruthy();
    const admin = await login.json();
    expect((await get(admin.idToken)).status()).toBe(422);
    const invalidCalendar = await get(admin.idToken, `${calendarPath}&unexpected=true`);
    expect(invalidCalendar.status()).toBe(400);
    for (const invalid of ["invalid-json", "x".repeat(2049), { ...query, referenceDate: "2026-02-30" }, { ...query, workspaceId: "foreign" }]) {
      const response = await post(admin.idToken, invalid);
      expect(response.status()).toBe(400);
      expect(JSON.stringify(await response.json())).not.toMatch(/stack|PDVLEGAL|Authorization|private_key/);
    }
    const missing = await post(admin.idToken);
    expect(missing.status()).toBe(422);
    expect(JSON.stringify(await missing.json())).toContain("FINANCIAL_AGENT_MAPPING_REQUIRED");
    const mapping = { workspaceId: "coala", kioskId: query.kioskId, accountId: accountRef.id,
      stoneCodes: [query.stoneCode], terminalIds: [], status: "active", validFrom: "2026-01-01", validTo: null };
    await mappingRef.set(mapping);
    const calendar = await get(admin.idToken);
    expect(calendar.status()).toBe(200);
    expect(await calendar.json()).toMatchObject({ from: "2026-01-01", through: "2026-09-20", records: [] });
    const snapshot = await get(admin.idToken, `/api/financial/pdv-stone-review?${new URLSearchParams({ resource: "snapshot",
      kioskId: query.kioskId, mappingId: query.mappingId, stoneCode: query.stoneCode, referenceDate: query.referenceDate })}`);
    expect(snapshot.status()).toBe(200);
    expect(await snapshot.json()).toEqual({ result: null });
    await unitRef.set({ workspaceId: "coala", name: "Unit fixture" });
    await accountRef.set({ workspaceId: "coala", name: "Account fixture" });
    const noFilial = await post(admin.idToken);
    expect(noFilial.status()).toBe(422);
    expect(JSON.stringify(await noFilial.json())).toContain("SALES_REVIEW_FILIAL_REQUIRED");
    // Both failures are before any provider call. Do not inject live provider credentials.
    await unitRef.update({ workspaceId: "foreign", pdvFilialId: "123" });
    const foreign = await post(admin.idToken);
    expect(foreign.status()).toBe(422);
    expect(JSON.stringify(await foreign.json())).toContain("FINANCIAL_AGENT_REFERENCES_INVALID");
    await unitRef.update({ workspaceId: "coala" });
    await mappingRef.update({ terminalIds: ["partition"] });
    const partitioned = await post(admin.idToken);
    expect(partitioned.status()).toBe(422);
    expect(JSON.stringify(await partitioned.json())).toContain("FINANCIAL_AGENT_MAPPING_AMBIGUOUS");
    expect((await mappingRef.get()).data()).toEqual({ ...mapping, terminalIds: ["partition"] });
  } finally {
    await Promise.all([restrictedRef.delete(), mappingRef.delete(), unitRef.delete(), accountRef.delete()]);
  }
});

test("calendar presents monthly cards, late reopening and a larger month view", async ({ page }) => {
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const app = getApps().find(a => a.name === "pdv-stone-calendar-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "pdv-stone-calendar-e2e");
  const financial = getFirestore(app, "coala-financeiro");
  const mappingId = "pdv-calendar-e2e-map", kioskId = "pdv-calendar-e2e-unit", stoneCode = "9876543210999";
  const publishedThrough = latestPublishedDate(new Date());
  const previous = new Date(`${publishedThrough}T12:00:00.000Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const reopenedDate = previous.toISOString().slice(0, 10);
  const summary = { pdvAmountCents: 1250, stoneAmountCents: 1250, autoCheckedCount: 1,
    attentionCount: 0, sourceIssueCount: 0, uncomparedPdvCount: 0 };
  const mapping = financial.collection("stoneMerchantMappings").doc(mappingId);
  const closed = financial.collection("dailySalesReviews").doc("pdv-calendar-e2e-closed");
  const reopened = financial.collection("dailySalesReviews").doc("pdv-calendar-e2e-reopened");
  try {
    await mapping.set({ workspaceId: "coala", kioskId, accountId: "pdv-calendar-e2e-account",
      stoneCodes: [stoneCode], terminalIds: [], status: "active", validFrom: `${publishedThrough.slice(0, 4)}-01-01`, validTo: null });
    await closed.set({ schemaVersion: 1, workspaceId: "coala", kioskId, mappingId,
      accountId: "pdv-calendar-e2e-account", stoneCode, referenceDate: publishedThrough, pdvFilialId: "999",
      status: "closed", revision: 1, sourceFingerprint: "a".repeat(64), summary,
      collectedAt: `${publishedThrough}T12:00:00.000Z`, reviewedAt: `${publishedThrough}T12:01:00.000Z`,
      reviewedBy: "e2e", closedAt: `${publishedThrough}T12:01:00.000Z`, closedBy: "e2e",
      reopenedAt: null, reopenedReason: null });
    await reopened.set({ schemaVersion: 1, workspaceId: "coala", kioskId, mappingId,
      accountId: "pdv-calendar-e2e-account", stoneCode, referenceDate: reopenedDate, pdvFilialId: "999",
      status: "attention_required", revision: 2, sourceFingerprint: "b".repeat(64),
      summary: { ...summary, stoneAmountCents: 0, attentionCount: 1, autoCheckedCount: 0 },
      collectedAt: `${publishedThrough}T13:00:00.000Z`, reviewedAt: `${publishedThrough}T13:01:00.000Z`,
      reviewedBy: "e2e", closedAt: null, closedBy: null,
      reopenedAt: `${publishedThrough}T13:01:00.000Z`, reopenedReason: "source_changed" });

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(E2E_USER.email);
    await page.getByLabel("Senha").fill(E2E_USER.password);
    await page.getByRole("button", { name: "Entrar no sistema" }).click();
    await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();
    await page.goto(`/dashboard/financial/sales-reconciliation?mapping=${mappingId}&stoneCode=${stoneCode}`);
    await expect(page.getByRole("heading", { name: "Visão anual" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel(`${Number(publishedThrough.slice(8))}: Fechado`)).toBeVisible();
    await expect(page.getByLabel(`${Number(reopenedDate.slice(8))}: Reaberto por informação tardia`)).toBeVisible();
    const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(`${publishedThrough.slice(0, 7)}-01T12:00:00.000Z`));
    const visibleLabel = label.charAt(0).toUpperCase() + label.slice(1);
    await page.getByRole("article").filter({ hasText: visibleLabel }).getByRole("link", { name: "Abrir calendário do mês" }).click();
    await expect(page.getByRole("heading", { name: visibleLabel })).toBeVisible();
    await expect(page.getByLabel(`${publishedThrough}: Fechado`)).toBeVisible();
    await expect(page.getByLabel(`${reopenedDate}: Reaberto por informação tardia`)).toBeVisible();
  } finally {
    await Promise.all([mapping.delete(), closed.delete(), reopened.delete()]);
  }
});
