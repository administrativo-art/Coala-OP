import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_USER } from "../support/global-setup";

// Modelos do editor: criar modelo -> publicar -> usar -> preencher -> finalizar, e a negativa de
// publicar sem revisão. Toda a API do editor é interceptada com dados determinísticos (sem backend,
// Gotenberg nem Storage reais); o app roda contra emuladores `demo-`. ESCRITO MAS AINDA NÃO EXECUTADO
// neste worktree (sem Java/emulador): a primeira execução deve ocorrer em observação, conforme a política.
// O usuário E2E é administrador padrão (tem `documents.review`); a decisão "sem revisão não publica"
// é exercida pela resposta 403 do servidor (a UI mostra texto público) e pelos testes unitários dos gates.
const TEMPLATE_ID = `tpl_${"b2".repeat(16)}`;
const DOCUMENT_ID = `ed_${"c3".repeat(16)}`;
const BODY_TEXT = "Declaro, para os devidos fins, que o colaborador pertence ao quadro da empresa.";

type Json = Record<string, unknown>;
type Call = { method: string; path: string; search: string; body: Json | null };

function templateView(overrides: Json = {}) {
  return {
    id: TEMPLATE_ID,
    name: "Modelo sem nome",
    description: "",
    status: "draft",
    currentVersion: 1,
    publishedVersion: null,
    contentHash: "h",
    contentBytes: 10,
    fieldKeys: [],
    ...overrides,
  };
}

function documentView(overrides: Json = {}) {
  return { id: DOCUMENT_ID, title: "Modelo sem nome", status: "draft", contentVersion: 1, contentHash: "h", pdfAvailable: false, ...overrides };
}

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
}

test("modelos: cria, edita, publica, usa o modelo e finaliza o documento criado", async ({ page }) => {
  test.setTimeout(300_000);
  const calls: Call[] = [];
  let template = templateView();
  let content: Json = { type: "doc", content: [{ type: "paragraph" }] };
  let docStatus = "draft";

  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === "GET" ? null : (request.postDataJSON() as Json | null);
    calls.push({ method, path: url.pathname, search: url.search, body });
    const path = url.pathname;

    if (method === "POST" && path === "/api/documents/editor/templates") return route.fulfill({ status: 201, json: { template } });
    if (method === "GET" && path === "/api/documents/editor/templates") {
      const status = url.searchParams.get("status");
      return route.fulfill({ json: { items: status === null || status === template.status ? [template] : [], nextCursor: null } });
    }
    if (method === "GET" && path === `/api/documents/editor/templates/${TEMPLATE_ID}`) {
      return route.fulfill({ json: { template, content, version: template.currentVersion } });
    }
    if (method === "PUT" && path === `/api/documents/editor/templates/${TEMPLATE_ID}/content`) {
      content = body!.content as Json;
      template = templateView({ ...template, name: String(body!.name), currentVersion: Number(template.currentVersion) + 1 });
      return route.fulfill({ json: { template } });
    }
    if (method === "POST" && path === `/api/documents/editor/templates/${TEMPLATE_ID}/publish`) {
      template = templateView({ ...template, status: "published", publishedVersion: template.currentVersion });
      return route.fulfill({ json: { template } });
    }
    if (method === "POST" && path === `/api/documents/editor/templates/${TEMPLATE_ID}/use`) {
      return route.fulfill({ status: 201, json: { document: documentView({ title: template.name }) } });
    }
    if (method === "GET" && path === `/api/documents/editor/${DOCUMENT_ID}`) {
      return route.fulfill({ json: { document: documentView({ status: docStatus }), content, version: 1 } });
    }
    if (method === "POST" && path === `/api/documents/editor/${DOCUMENT_ID}/finalize`) {
      docStatus = "final";
      return route.fulfill({ json: { document: documentView({ status: "final", pdfAvailable: true }), replayed: false } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_TEMPLATE_NOT_FOUND", message: "texto interno do servidor" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  // Três caminhos na entrada; criar modelo abre o editor em modo modelo (sem titular, sem finalizar).
  await login(page, "/dashboard/documents/editor");
  await expect(page.getByRole("button", { name: "Criar documento em branco" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("link", { name: "Ver modelos publicados" })).toBeVisible();
  await page.getByRole("button", { name: "Criar modelo" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/documents/editor/templates/${TEMPLATE_ID}$`), { timeout: 180_000 });
  const createCall = calls.find((call) => call.method === "POST" && call.path === "/api/documents/editor/templates")!;
  expect(String(createCall.body?.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
  expect(createCall.body).not.toHaveProperty("subject");

  const editor = page.getByRole("textbox", { name: "Conteúdo do modelo" });
  await expect(editor).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Preencher e finalizar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finalizar documento" })).toHaveCount(0);
  await expect(page.getByTestId("editor-template-versions")).toHaveText("Versão 1 · nunca publicada");

  await editor.click();
  await page.keyboard.type(BODY_TEXT);
  await page.getByLabel("Nome do modelo").fill("Declaração de vínculo");
  await page.getByRole("button", { name: "Salvar modelo" }).click();
  await expect(page.getByTestId("editor-save-state")).toHaveText("Salvo");
  const save = calls.find((call) => call.method === "PUT")!;
  expect(save.body).toMatchObject({ expectedVersion: 1, name: "Declaração de vínculo" });
  expect(String(save.body?.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByTestId("editor-template-versions")).toHaveText("Versão 2 · nunca publicada");

  // Publicar exige confirmação inline e explica que só a versão publicada pode ser usada.
  await page.getByRole("button", { name: "Publicar modelo" }).click();
  const confirm = page.getByRole("group").filter({ hasText: "Só a versão publicada pode ser usada" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Publicar modelo" }).click();
  await expect(page.getByTestId("editor-publish-notice")).toContainText("Versão 2 publicada");
  await expect(page.getByTestId("editor-template-versions")).toHaveText("Versão 2 · publicada: versão 2");
  const publish = calls.find((call) => call.path.endsWith("/publish"))!;
  expect(publish.body).toMatchObject({ expectedVersion: 2 });

  // Lista: o modelo publicado aparece em "Publicados" e pode ser usado.
  await page.goto("/dashboard/documents/editor/templates");
  const row = page.getByTestId("editor-template-row").filter({ hasText: "Declaração de vínculo" });
  await expect(row).toBeVisible({ timeout: 180_000 });
  await expect(row.getByText("Publicado", { exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Usar modelo Declaração de vínculo" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/documents/editor/${DOCUMENT_ID}$`), { timeout: 120_000 });
  const use = calls.find((call) => call.path.endsWith("/use"))!;
  expect(use.body).toMatchObject({ expectedPublishedVersion: 2 });
  expect(use.body).not.toHaveProperty("subject");

  // O documento criado segue o fluxo atual: sem campos do sistema finaliza direto, sem titular.
  await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toContainText(BODY_TEXT, { timeout: 120_000 });
  await page.getByRole("button", { name: "Finalizar documento" }).click();
  const finalizeConfirm = page.getByRole("group").filter({ hasText: "Finalizar este documento?" });
  await finalizeConfirm.getByRole("button", { name: "Finalizar documento" }).click();
  await expect(page.getByText("Documento finalizado: o texto não pode mais ser alterado.")).toBeVisible();
  expect(calls.find((call) => call.path.endsWith("/finalize"))!.body).not.toHaveProperty("subject");
});

test("modelos: publicar sem a permissão de revisão é negado pelo servidor com texto público", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === `/api/documents/editor/templates/${TEMPLATE_ID}`) {
      return route.fulfill({
        json: {
          template: templateView(),
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: BODY_TEXT }] }] },
          version: 1,
        },
      });
    }
    if (request.method() === "POST" && path.endsWith("/publish")) {
      return route.fulfill({ status: 403, json: { error: { code: "EDITOR_TEMPLATE_FORBIDDEN", message: "texto interno do servidor" } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_TEMPLATE_NOT_FOUND", message: "x" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  await login(page, `/dashboard/documents/editor/templates/${TEMPLATE_ID}`);
  await expect(page.getByRole("textbox", { name: "Conteúdo do modelo" })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Publicar modelo" }).click();
  await page.getByRole("group").filter({ hasText: "Só a versão publicada pode ser usada" }).getByRole("button", { name: "Publicar modelo" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Você não tem permissão para esta operação no modelo." })).toBeVisible();
  await expect(page.getByText("texto interno do servidor")).toHaveCount(0);
  await expect(page.getByTestId("editor-publish-notice")).toHaveCount(0);
});

test("documento: Salvar como modelo exige a ciência do aviso e leva ao modelo criado", async ({ page }) => {
  test.setTimeout(300_000);
  const calls: Call[] = [];
  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    calls.push({ method, path: url.pathname, search: url.search, body: method === "GET" ? null : (request.postDataJSON() as Json | null) });
    if (method === "GET" && url.pathname === `/api/documents/editor/${DOCUMENT_ID}`) {
      return route.fulfill({
        json: {
          document: documentView({ title: "Rascunho" }),
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: BODY_TEXT }] }] },
          version: 1,
        },
      });
    }
    if (method === "POST" && url.pathname === "/api/documents/editor/templates") {
      return route.fulfill({ status: 201, json: { template: templateView({ name: "Declaração padrão" }) } });
    }
    if (method === "GET" && url.pathname === `/api/documents/editor/templates/${TEMPLATE_ID}`) {
      return route.fulfill({
        json: { template: templateView({ name: "Declaração padrão" }), content: { type: "doc", content: [{ type: "paragraph" }] }, version: 1 },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_DOCUMENT_NOT_FOUND", message: "x" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  await login(page, `/dashboard/documents/editor/${DOCUMENT_ID}`);
  await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Salvar como modelo" }).click();
  const panel = page.getByRole("dialog", { name: "Salvar como modelo" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("O texto será copiado para o modelo e ficará visível a todos que podem gerar documentos.")).toBeVisible();
  const create = panel.getByRole("button", { name: "Criar modelo" });
  await expect(create).toBeDisabled();
  await panel.getByLabel("Nome do modelo").fill("Declaração padrão");
  await expect(create).toBeDisabled();
  await panel.getByLabel("Li o aviso e revisei o texto").click();
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/documents/editor/templates/${TEMPLATE_ID}$`), { timeout: 120_000 });
  const createCall = calls.find((call) => call.method === "POST" && call.path === "/api/documents/editor/templates")!;
  expect(createCall.body).toMatchObject({ name: "Declaração padrão", fromDocument: { documentId: DOCUMENT_ID, version: 1 } });
  expect(createCall.body).not.toHaveProperty("content");
  expect(createCall.body).not.toHaveProperty("subject");
  // O documento original não é alterado: nenhuma escrita nele.
  expect(calls.filter((call) => call.path.startsWith(`/api/documents/editor/${DOCUMENT_ID}`) && call.method !== "GET")).toHaveLength(0);
});
