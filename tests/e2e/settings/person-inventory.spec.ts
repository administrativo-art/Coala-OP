import { expect, test, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";
import { E2E_USER } from "../support/global-setup";

async function openGovernance(page: Page) {
  await page.goto("/login?next=%2Fdashboard%2Fsettings%3Fdepartment%3Dpessoal%26tab%3Dprivacy");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("heading", { name: "Aviso interno de privacidade" })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Pedidos e incidentes" }).click();
  await expect(page.getByRole("button", { name: "+ Registrar pedido" })).toBeVisible();
}

test("pedido vincula ID validado e consulta catálogo, origem e página sob demanda", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const app = getApps().find((entry) => entry.name === "privacy-ui-e2e") ?? initializeApp({ projectId: "demo-coala-e2e" }, "privacy-ui-e2e");
  const db = getFirestore(app, "coala");
  const batch = db.batch();
  for (let index = 0; index < 26; index += 1) batch.set(db.collection("privacyRequests").doc(`privacy-page-${String(index).padStart(2, "0")}`), {
    workspace_id: "coala", subjectName: `ZZ Histórico ${index}`, subjectType: "internal_user", subjectRef: { namespace: "main.users", id: E2E_USER.uid }, subjectKeys: [`main.users:${E2E_USER.uid}`], description: "Fixture de paginação", requestType: "access", status: "open", createdAt: new Date(), updatedAt: new Date(),
  });
  batch.set(db.collection("privacyRequests").doc("privacy-legacy"), { workspace_id: "coala", subjectName: "Antigo sem vínculo", description: "Legado sem identificador", requestType: "access", status: "open", createdAt: new Date(), updatedAt: new Date() });
  await batch.commit();
  const calls: URL[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/privacy/person-inventory?")) calls.push(new URL(request.url())); });
  await openGovernance(page);
  await expect(page.getByText("Cadastro não vinculado.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Ver mais registros" }).click();
  await expect(page.getByText("Mostrando 16 de", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "+ Registrar pedido" }).click();
  const form = page.getByRole("dialog", { name: "Registrar pedido", exact: true });
  await form.getByLabel("Origem do cadastro", { exact: true }).click();
  await page.getByRole("option", { name: "Conta do sistema", exact: true }).click();
  await form.getByLabel("Identificador do cadastro", { exact: true }).fill(E2E_USER.uid);
  await form.getByLabel("Nome", { exact: true }).fill("Pessoa inventário E2E");
  await form.getByLabel("Descrição", { exact: true }).fill("Consulta autorizada de referências por ID");
  const createdResponse = page.waitForResponse((response) => response.url().endsWith("/api/privacy/requests") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Registrar pedido", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const payload = await created.json();
  expect(payload.request.subjectRef).toEqual({ namespace: "main.users", id: E2E_USER.uid });
  const stored = await db.collection("privacyRequests").doc(payload.request.id).get();
  expect(stored.get("subjectKeys")).toContain(`main.users:${E2E_USER.uid}`);
  await expect(form).toBeHidden();
  await page.getByText("Pessoa inventário E2E", { exact: true }).locator("../..").getByRole("button", { name: "Consultar dados", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Consultar dados", exact: true });
  await expect(panel.getByText("Referências confirmadas nesta consulta")).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(calls[0].searchParams.has("source")).toBe(false);
  await panel.getByLabel("Origem dos dados", { exact: true }).click();
  await page.getByRole("option", { name: /^Pedidos de titulares ·/ }).click();
  await expect(panel.getByText("25 referências carregadas", { exact: false })).toBeVisible();
  expect(calls).toHaveLength(2);
  await panel.getByRole("button", { name: "Carregar mais referências" }).click();
  await expect(panel.getByText("27 referências carregadas", { exact: false })).toBeVisible();
  expect(calls).toHaveLength(3);
  expect(calls[2].searchParams.get("cursor")).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("inventario-pessoa.png"), fullPage: true });
  await panel.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Consultar dados por cadastro" }).click();
  await expect(panel.getByLabel("Identificador do cadastro", { exact: true })).toHaveValue("");
  expect((await db.collection("privacyRequests").get()).size).toBe(28);
});

test("inventário explicita restrição, falha e ignora respostas de painel fechado", async ({ page }) => {
  let catalogCalls = 0, sourceCalls = 0;
  let releaseOld: (() => void) | undefined;
  let oldRequested: (() => void) | undefined;
  let oldFinished: (() => void) | undefined;
  const oldRequest = new Promise<void>((resolve) => { oldRequested = resolve; });
  const oldResponseFinished = new Promise<void>((resolve) => { oldFinished = resolve; });
  const source = { id: "accounts", database: "main", collection: "users", role: "subject", coverage: "live", namespace: "main.users", field: "__name__", permissionPolicy: "people", scopePolicy: "person-workspace-unit", retention: "source-policy" };
  await page.route("**/api/privacy/person-inventory?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (!query.has("source")) {
      catalogCalls += 1;
      await route.fulfill({ json: { ref: { namespace: "main.users", id: query.get("id") }, equivalents: [{ namespace: "main.users", id: query.get("id") }], conflicts: ["employee_not_reciprocal"], sources: [source, { id: "opaque-restricted", coverage: "restricted" }] } });
      return;
    }
    sourceCalls += 1;
    if (sourceCalls === 1) { await route.fulfill({ status: 500, json: { error: "Falha controlada da origem" } }); return; }
    if (sourceCalls === 2 && query.get("id") === "person-current") { await route.fulfill({ json: { source, status: "partial", nextCursor: "pc1_synthetic_opaque", items: [] } }); return; }
    if (query.get("id") === "person-old") {
      oldRequested?.();
      await new Promise<void>((resolve) => { releaseOld = resolve; });
    }
    try { await route.fulfill({ json: { source, status: "complete", nextCursor: null, items: [{ id: `record-${query.get("id")}`, recordPath: `users/record-${query.get("id")}`, database: "main", collection: "users", role: "subject", version: null, links: {}, storageReferences: [] }] } }); } catch { /* Closing the panel aborts its request. */ }
    finally { if (query.get("id") === "person-old") oldFinished?.(); }
  });
  await openGovernance(page);
  await page.getByRole("button", { name: "Consultar dados por cadastro" }).click();
  const panel = page.getByRole("dialog", { name: "Consultar dados", exact: true });
  await panel.getByLabel("Identificador do cadastro", { exact: true }).fill("person-current");
  await panel.getByRole("button", { name: "Consultar cadastro", exact: true }).click();
  await expect(panel.getByText("Conflitos de vínculo: cobertura parcial")).toBeVisible();
  await panel.getByLabel("Origem dos dados", { exact: true }).click();
  await expect(page.getByRole("option", { name: /Origem restrita/ })).toBeDisabled();
  await page.getByRole("option", { name: /^Contas do sistema ·/ }).click();
  await expect(panel.getByRole("alert")).toContainText("Falha controlada");
  await expect(panel.getByText("Nenhuma referência encontrada", { exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "Tentar origem novamente" }).click();
  await expect(panel.getByText("Nenhuma referência permitida nesta página.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Carregar mais referências" }).click();
  await expect(panel.getByText("Registro record-person-current", { exact: true })).toBeVisible();
  expect(catalogCalls).toBe(1);
  expect(sourceCalls).toBe(3);
  await panel.getByLabel("Identificador do cadastro", { exact: true }).fill("person-old");
  await panel.getByRole("button", { name: "Consultar cadastro", exact: true }).click();
  await expect(panel.getByText("Referências confirmadas nesta consulta")).toBeVisible();
  await panel.getByLabel("Origem dos dados", { exact: true }).click();
  await page.getByRole("option", { name: /^Contas do sistema ·/ }).click();
  await oldRequest;
  await panel.getByRole("button", { name: "Fechar", exact: true }).click();
  await page.getByRole("button", { name: "Consultar dados por cadastro" }).click();
  await panel.getByLabel("Identificador do cadastro", { exact: true }).fill("person-new");
  await panel.getByRole("button", { name: "Consultar cadastro", exact: true }).click();
  await expect(panel.getByText("Referências confirmadas nesta consulta")).toBeVisible();
  await panel.getByLabel("Origem dos dados", { exact: true }).click();
  await page.getByRole("option", { name: /^Contas do sistema ·/ }).click();
  await expect(panel.getByText("Registro record-person-new", { exact: true })).toBeVisible();
  releaseOld?.();
  await oldResponseFinished;
  await expect(panel.getByText("Registro record-person-old", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Registro record-person-new", { exact: true })).toBeVisible();
});
