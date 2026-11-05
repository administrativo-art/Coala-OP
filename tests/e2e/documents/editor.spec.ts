import { expect, test, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

import { E2E_USER } from "../support/global-setup";

// Fluxo crítico do editor de documentos. Toda a API do editor é interceptada com dados
// determinísticos (sem backend, Gotenberg nem Storage reais); o app roda contra emuladores `demo-`.
const DOCUMENT_ID = `ed_${"a1".repeat(16)}`;
const SUBJECT = { id: "employee-vacation-e2e", name: "Colaboradora Férias E2E" };
const FIELD = { key: "employee.birth_date", label: "Data de nascimento" };

type Json = Record<string, unknown>;

async function pdfBytes() {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Prévia de teste", { x: 40, y: 740, size: 18 });
  return Buffer.from(await pdf.save());
}

function view(overrides: Json = {}) {
  return { id: DOCUMENT_ID, title: "Documento sem título", status: "draft", contentVersion: 1, contentHash: "h", pdfAvailable: false, ...overrides };
}

async function login(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
}

test("editor: cria em branco, escreve, insere campo, salva, vê a prévia e finaliza", async ({ page }) => {
  test.setTimeout(300_000);
  const bytes = await pdfBytes();
  const calls: Array<{ method: string; path: string; body: Json | null }> = [];
  let version = 1;
  let status = "draft";
  let previewFails = true;
  let resolvedMissing = true;

  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = method === "GET" ? null : (request.postDataJSON() as Json | null);
    calls.push({ method, path, body });
    if (method === "POST" && path === "/api/documents/editor") {
      return route.fulfill({ status: 201, json: { document: view() } });
    }
    if (method === "GET" && path.endsWith("/file")) {
      return status === "final"
        ? route.fulfill({ contentType: "application/pdf", body: bytes })
        : route.fulfill({ status: 409, json: { error: { code: "EDITOR_DOCUMENT_NOT_FINAL", message: "texto interno do servidor" } } });
    }
    if (method === "GET") {
      return route.fulfill({
        json: { document: view({ contentVersion: version, status }), content: { type: "doc", content: [{ type: "paragraph" }] }, version },
      });
    }
    if (method === "PUT") {
      version += 1;
      return route.fulfill({ json: { document: view({ contentVersion: version, title: String(body?.title) }) } });
    }
    if (path.endsWith("/preview") && body?.mode === "resolved") {
      if (resolvedMissing) {
        resolvedMissing = false;
        return route.fulfill({
          status: 422,
          json: { error: { code: "EDITOR_MISSING_FIELDS", message: "texto interno do servidor" }, missingKeys: [FIELD.key] },
        });
      }
      return route.fulfill({ contentType: "application/pdf", body: bytes });
    }
    if (path.endsWith("/preview")) {
      if (previewFails) {
        previewFails = false;
        return route.fulfill({
          status: 503,
          json: { error: { code: "EDITOR_PDF_UNAVAILABLE", message: "texto interno do servidor" } },
        });
      }
      return route.fulfill({ contentType: "application/pdf", body: bytes });
    }
    if (path.endsWith("/finalize")) {
      status = "final";
      return route.fulfill({ json: { document: view({ status: "final", contentVersion: version, pdfAvailable: true }), replayed: false } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_DOCUMENT_NOT_FOUND", message: "x" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  await login(page, "/dashboard/documents/editor");
  await page.getByRole("button", { name: "Criar documento em branco" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/documents/editor/${DOCUMENT_ID}$`), { timeout: 180_000 });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/api/documents/editor" });
  expect(String(calls[0]!.body?.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);

  const editor = page.getByRole("textbox", { name: "Conteúdo do documento" });
  await expect(editor).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("editor-save-state")).toHaveText("Salvo");

  await editor.click();
  await page.keyboard.type("Declaro para os devidos fins, em ");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Alterações não salvas");
  await page.getByRole("button", { name: "Aplicar negrito" }).click();
  await page.keyboard.type("negrito");

  // Campo do sistema pelo painel lateral.
  await page.getByRole("button", { name: "Inserir campo do sistema" }).click();
  const panel = page.getByRole("dialog");
  await panel.getByRole("searchbox", { name: "Buscar campo do sistema" }).fill("nascimento");
  await panel.getByRole("button", { name: `Inserir campo ${FIELD.label}`, exact: true }).click();
  await expect(panel).toHaveCount(0);
  const chip = editor.locator(`[data-document-field="${FIELD.key}"]`);
  await expect(chip).toHaveText(FIELD.label);
  await expect(chip).toHaveCSS("white-space", "nowrap");

  // Com campo do sistema o botão principal vira "Preencher e finalizar" (o titular nunca é escolhido na criação).
  await expect(page.getByRole("button", { name: "Finalizar documento" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Preencher e finalizar" })).toBeEnabled();

  // Salvar explícito: envia a versão esperada, um identificador de requisição e o campo no JSON.
  await page.getByLabel("Título do documento").fill("Declaração de teste");
  await page.getByRole("button", { name: "Salvar documento" }).click();
  await expect(page.getByTestId("editor-save-state")).toHaveText("Salvo");
  const firstSave = calls.find((call) => call.method === "PUT")!;
  expect(firstSave.path).toBe(`/api/documents/editor/${DOCUMENT_ID}/content`);
  expect(firstSave.body).toMatchObject({ expectedContentVersion: 1, title: "Declaração de teste" });
  expect(JSON.stringify(firstSave.body?.content)).toContain(`"documentField","attrs":{"key":"${FIELD.key}"}`);
  expect(JSON.stringify(firstSave.body?.content)).toContain('"bold"');

  // Prévia: a primeira tentativa falha com 503 (texto público, sem a mensagem do servidor); a segunda abre o PDF.
  await page.getByRole("button", { name: "Ver prévia timbrada" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "indisponível" })).toBeVisible();
  await expect(page.getByText("texto interno do servidor")).toHaveCount(0);
  await page.getByRole("button", { name: "Ver prévia timbrada" }).click();
  const frame = page.getByTitle("Prévia timbrada do documento em PDF");
  await expect(frame).toHaveAttribute("src", /^blob:/);
  await page.getByRole("button", { name: "Fechar prévia" }).click();
  await expect(frame).toHaveCount(0);

  // Etapa "Preencher e finalizar": titular só no estado da tela; finalizar exige titular escolhido.
  const fillButton = page.getByRole("button", { name: "Preencher e finalizar" });
  await fillButton.click();
  const fill = page.getByRole("dialog", { name: "Preencher e finalizar" });
  await expect(fill).toBeVisible();
  const fillFinalize = fill.getByRole("button", { name: "Finalizar documento" });
  await expect(fillFinalize).toBeDisabled();
  await expect(fill.getByText("Escolha o titular para preencher os campos do documento.")).toBeVisible();
  await expect(fill.getByRole("button", { name: "Ver prévia com dados do titular" })).toBeDisabled();
  expect(calls.filter((call) => call.method === "POST" && call.path.endsWith("/finalize"))).toHaveLength(0);

  await fill.getByRole("searchbox", { name: "Buscar colaborador" }).fill("Férias");
  await fill.getByLabel("Titular do documento").selectOption({ label: SUBJECT.name });
  await expect(fillFinalize).toBeEnabled();

  // Prévia com dados reais: 1ª tentativa aponta campo sem valor (rótulo, sem texto do servidor); a 2ª abre o PDF.
  await fill.getByRole("button", { name: "Ver prévia com dados do titular" }).click();
  await expect(fill.getByRole("alert").filter({ hasText: `Campos sem valor: ${FIELD.label}` })).toBeVisible();
  await expect(page.getByText("texto interno do servidor")).toHaveCount(0);
  await expect(fillFinalize).toBeDisabled();
  await fill.getByRole("button", { name: "Ver prévia com dados do titular" }).click();
  await page.getByRole("button", { name: "Fechar prévia" }).click();
  const resolvedCalls = calls.filter((call) => call.path.endsWith("/preview") && call.body?.mode === "resolved");
  expect(resolvedCalls).toHaveLength(2);
  expect(resolvedCalls[0]!.body).toEqual({ mode: "resolved", subject: { employeeId: SUBJECT.id } });

  // Finaliza com o titular, com confirmação inline dentro do painel.
  await expect(fillFinalize).toBeEnabled();
  await fillFinalize.click();
  const confirm = fill.getByRole("group").filter({ hasText: "Finalizar este documento" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Finalizar documento" }).click();
  // Durante a finalização o texto não aceita digitação (somente leitura até o desfecho).
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.getByText("Documento finalizado: o texto não pode mais ser alterado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar documento" })).toHaveCount(0);

  // Download do PDF final pela rota própria, sem abrir nada fora do app.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar PDF final" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Declaracao-de-teste.pdf");
  expect(calls.filter((call) => call.path.endsWith("/file"))).toHaveLength(1);

  const finalizeCall = calls.find((call) => call.path.endsWith("/finalize"))!;
  expect(finalizeCall.body).toMatchObject({ expectedContentVersion: version, subject: { employeeId: SUBJECT.id } });
  // Nenhuma prévia por digitação nem polling: só as chamadas explícitas.
  expect(calls.filter((call) => call.path.endsWith("/preview"))).toHaveLength(4);
});

test("editor: conflito de versão mantém o texto local e oferece recarregar", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      return route.fulfill({ json: { document: view(), content: { type: "doc", content: [{ type: "paragraph" }] }, version: 1 } });
    }
    if (method === "PUT") {
      return route.fulfill({
        status: 409,
        json: { error: { code: "EDITOR_VERSION_CONFLICT", message: "mensagem interna" }, currentVersion: 4 },
      });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_DOCUMENT_NOT_FOUND", message: "x" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  await login(page, `/dashboard/documents/editor/${DOCUMENT_ID}`);
  const editor = page.getByRole("textbox", { name: "Conteúdo do documento" });
  await expect(editor).toBeVisible({ timeout: 180_000 });
  await editor.click();
  await page.keyboard.type("Texto local que não pode se perder");
  await page.getByRole("button", { name: "Salvar documento" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Outra sessão alterou este documento" })).toBeVisible();
  await expect(page.getByText("mensagem interna")).toHaveCount(0);
  await expect(editor).toContainText("Texto local que não pode se perder");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Conflito de versão");
  await expect(page.getByRole("button", { name: "Salvar documento" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Salvar minha versão sobre a atual" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recarregar versão salva" })).toBeVisible();
});

test("editor: documento sem campos do sistema finaliza direto, sem escolher titular", async ({ page }) => {
  test.setTimeout(300_000);
  let status = "draft";
  const calls: Array<{ method: string; path: string; body: Json | null }> = [];
  await page.route(/\/api\/documents\/editor(\/.*)?$/, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    calls.push({ method, path, body: method === "GET" ? null : (request.postDataJSON() as Json | null) });
    if (method === "GET") {
      return route.fulfill({
        json: {
          document: view({ status }),
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Texto avulso" }] }] },
          version: 1,
        },
      });
    }
    if (path.endsWith("/finalize")) {
      status = "final";
      return route.fulfill({ json: { document: view({ status: "final", pdfAvailable: true }), replayed: false } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "EDITOR_DOCUMENT_NOT_FOUND", message: "x" } } });
  });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));

  await login(page, `/dashboard/documents/editor/${DOCUMENT_ID}`);
  await expect(page.getByRole("textbox", { name: "Conteúdo do documento" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("button", { name: "Preencher e finalizar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Finalizar documento" }).click();
  const confirm = page.getByRole("group").filter({ hasText: "Finalizar este documento?" });
  await confirm.getByRole("button", { name: "Finalizar documento" }).click();
  await expect(page.getByText("Documento finalizado: o texto não pode mais ser alterado.")).toBeVisible();
  const finalizeCall = calls.find((call) => call.path.endsWith("/finalize"))!;
  expect(finalizeCall.body).not.toHaveProperty("subject");
});
