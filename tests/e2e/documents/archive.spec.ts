import { expect, test, type Page } from "@playwright/test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";

/** Sem visualizador nativo, a prévia ampliada usa o PDF.js e o teste confere a página desenhada. */
async function setNativePdfViewer(page: Page, enabled: boolean) {
  await page.evaluate((value) => Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", { configurable: true, get: () => value }), enabled);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", { configurable: true, get: () => false }));
});

test("Acervo abre na Empresa, busca por termos e mostra a pasta do colaborador nos três modos", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Contrato de teste", { x: 40, y: 740, size: 18 }); pdf.addPage().drawText("Segunda página", { x: 40, y: 740, size: 18 });
  const bytes = Buffer.from(await pdf.save());
  const accesses: Array<{ id: string; action: string }> = [];
  const hrAccesses: Array<{ id: string; action: string }> = [];
  const organizationCalls: Array<Record<string, unknown>> = [];
  let hrListCalls = 0;
  let deleteCalls = 0;
  const published = { status: "published", at: "2026-11-03T12:00:00.000Z" };
  // Quem gerencia a equipe vê tudo da pessoa: publicados (com a marca) e não publicados.
  await page.route("**/api/hr/employee-documents?*", (route) => { hrListCalls++; return route.fulfill({ json: { documents: [
    {id:"published-kit-e2e",displayName:"Kit publicado de teste",originalName:"kit.pdf",documentType:"Kit admissional",documentTypeCode:"ADMISSION_PACKAGE",category:"admission",destinationTrail:[],mimeType:"application/pdf",uploadedAt:"2026-11-03T12:00:00.000Z",publication:published},
    {id:"published-vacation-e2e",displayName:"Aviso publicado",originalName:"aviso.pdf",documentType:"Aviso de férias",documentTypeCode:"VACATION_NOTICE",category:"vacations",destinationTrail:["Férias","Período aquisitivo 2025-2026","Parcela 01","Aviso de férias"],archivePath:["Férias","Conferência"],mimeType:"application/pdf",uploadedAt:"2026-11-04T12:00:00.000Z",publication:published},
    {id:"internal-leave-e2e",archiveName:"Atestado de agosto",originalName:"atestado.pdf",documentType:"Atestado médico",documentTypeCode:"MEDICAL_CERTIFICATE",category:"leaves",archivePath:["Afastamentos","2026","Agosto"],mimeType:"application/pdf",uploadedAt:"2026-08-14T12:00:00.000Z"},
  ] } }); });
  await page.route("**/api/hr/employee-documents/access", async (route) => { hrAccesses.push(route.request().postDataJSON()); await route.fulfill({ contentType:"application/pdf", body:bytes }); });
  await page.route("**/api/hr/employee-document-folder-profile?*", (route) => route.fulfill({ json: { folderProfile: { folders: [] } } }));
  await page.route("**/api/documents/generated?*", (route) => route.fulfill({ json: { documents: [] } }));
  await page.route("**/api/hr/employee-documents/batches?*", (route) => route.fulfill({ json: { batches: [] } }));
  await page.route("**/api/hr/employee-documents/summary", (route) => route.fulfill({ json: { summaries: [{ employeeId: E2E_USER.uid, total: 3, pendingReviewFiles: 1 }] } }));
  await page.route("**/api/hr/employee-documents/visibility", (route) => route.fulfill({ json: { documentVisibility: { categories: {}, document_types: {} } } }));
  await page.route("**/api/hr/employee-documents/organization", async (route) => { organizationCalls.push(route.request().postDataJSON()); await route.fulfill({ json: { document: { ok: true } } }); });
  await page.route("**/api/documents/company", (route) => route.fulfill({ json: { documents: [
    { id: "archive-company-e2e", title: "Contrato da unidade", category: "Contratos", status: "active", originalName: "original.pdf", standardizedName: "CONTRATO__UNIDADE-001__v01.pdf", mimeType: "application/pdf", size: bytes.length, uploadedAt: "2026-11-02T12:00:00.000Z" },
    { id: "archive-company-second-e2e", title: "Aditivo da unidade", category: "Contratos", status: "active", originalName: "aditivo.pdf", mimeType: "application/pdf", size: bytes.length + 1000, uploadedAt: "2026-11-01T12:00:00.000Z" },
  ] } }));
  await page.route("**/api/documents/company?id=*", route => { if (route.request().method() === "DELETE") { deleteCalls++; return route.fulfill(deleteCalls === 1 ? {status:500,json:{error:"Falha simulada ao excluir."}} : {json:{ok:true}}); } return route.continue(); });
  await page.route("**/api/documents/company/units", (route) => route.fulfill({ json: { units: [] } }));
  await page.route("**/api/documents/company/access", async (route) => { accesses.push(route.request().postDataJSON()); await route.fulfill({ contentType: "application/pdf", body: bytes }); });
  await page.route("**/api/documents/templates", (route) => route.fulfill({ json: { templates: [{ id: "archive-model-e2e", name: "Recibo de pagamento", category: "Financeiro e recibos", status: "published", version: 2, generationMode: "direct", sourceFormat: "pdf", previewUrl: "/api/documents/templates/archive-model-e2e/preview", downloadUrl: "/api/documents/templates/archive-model-e2e/source" }] } }));
  await page.route("**/api/documents/templates/archive-model-e2e/preview", (route) => route.fulfill({ contentType: "application/pdf", body: bytes }));
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/login?next=%2Fdashboard%2Fdocuments");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("heading", { name: "Acervo", exact: true })).toBeVisible({ timeout: 180_000 });
  const contents = page.getByRole("main", { name: "Conteúdo da pasta" });
  const sections = page.getByRole("navigation", { name: "Seções do Acervo" });
  await expect(page.getByRole("navigation", { name: "Documentos", exact: true })).toHaveCount(0);
  // O Acervo abre direto na aba Empresa, já nas pastas da empresa; as pastas de pessoas ficam na aba Colaborador.
  await expect(sections.getByRole("link", { name: "Empresa", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("radiogroup", { name: "Modo de visualização" }).getByRole("radio", { name: "Painel lateral" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("navigation", { name: "Árvore de pastas" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pasta acima" })).toHaveCount(0);
  await expect(contents.getByRole("button", { name: /^Pasta:/ }).first()).toHaveAttribute("aria-label", "Pasta: 01 - Societário");
  await expect(contents.getByRole("button", { name: /Colaboradores/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Modificado", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tamanho", exact: true })).toHaveCount(0);
  // Gerar (gerador) e Criar (editor) são funcionalidades diferentes; Criar oferece modelo ou documento novo.
  await expect(page.getByRole("link", { name: "Gerar documento", exact: true })).toHaveAttribute("href", "/dashboard/documents/generator");
  await page.getByRole("button", { name: "Criar documento", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /Usar modelo/ })).toHaveAttribute("href", "/dashboard/documents/editor/templates");
  await expect(page.getByRole("menuitem", { name: /Novo documento/ })).toHaveAttribute("href", "/dashboard/documents/editor");
  await page.keyboard.press("Escape");
  // A busca da aba Empresa procura em todas as pastas da empresa, por termos e enquanto se digita.
  const companySearch = page.getByRole("searchbox", { name: "Buscar nos documentos da empresa" });
  await companySearch.fill("unidade aditivo");
  await expect(contents.getByRole("button", { name: "Arquivo: Aditivo da unidade", exact: true })).toBeVisible();
  await expect(contents.getByRole("button", { name: "Arquivo: Contrato da unidade", exact: true })).toHaveCount(0);
  await expect(contents.getByRole("button", { name: "Arquivo: Aditivo da unidade", exact: true }).getByText(/06 - Contratos/)).toBeVisible();
  await companySearch.fill("contratos");
  await expect(contents.getByRole("button", { name: "Pasta: 06 - Contratos", exact: true })).toBeVisible();
  await companySearch.fill("Inexistente");
  await expect(contents.getByRole("button", { name: /^(Pasta|Arquivo):/ })).toHaveCount(0);
  await companySearch.clear();

  // Aba Colaborador: escolher a pessoa (filtro Ativos/Desligados) e abrir a pasta dela.
  await sections.getByRole("link", { name: "Colaborador", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/documents\/collaborators$/, {timeout:90_000});
  const situation = page.getByRole("radiogroup", { name: "Situação do colaborador" });
  await expect(situation.getByRole("radio", { name: /^Ativos/ })).toHaveAttribute("aria-checked", "true");
  await situation.getByRole("radio", { name: /^Desligados/ }).click();
  await expect(page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true })).toHaveCount(0);
  await situation.getByRole("radio", { name: /^Ativos/ }).click();
  // A configuração de Visibilidade (antiga DP › Documentos) abre aqui mesmo.
  await page.getByRole("button", { name: "Visibilidade", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Visibilidade por pasta e documento", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true }).click();
  // Anexar documentos (antiga página do DP) abre na própria pasta da pessoa.
  await page.getByRole("button", { name: "Anexar documentos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Anexar documentos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  // Quem gerencia vê as pastas padrão, inclusive vazias, e todos os documentos da pessoa.
  await expect(contents.getByRole("button", { name: "Pasta: Identificação", exact: true })).toBeVisible();
  await expect(contents.getByRole("button", { name: "Pasta: Identificação", exact: true }).getByText("Vazia", { exact: true })).toBeVisible();
  await contents.getByRole("button", { name: "Pasta: Admissão", exact: true }).click();
  const publishedFile = page.getByRole("button", { name: "Arquivo: Kit publicado de teste", exact: true });
  await expect(publishedFile.getByText("Publicado", { exact: true })).toBeVisible();
  await publishedFile.click();
  const panel = page.getByRole("dialog", { name: "Kit publicado de teste" });
  await expect(panel.getByRole("img", { name: "Prévia de Kit publicado de teste" })).toHaveAttribute("data-rendered", "true");
  await expect(panel.getByRole("combobox", { name: "Status do documento" })).toBeVisible();
  const settledHrListCalls = hrListCalls;
  expect(hrAccesses.filter(call => call.action === "view")).toHaveLength(1);
  await panel.getByRole("button", { name: "Ampliar prévia", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Kit publicado de teste" })).toHaveAttribute("data-rendered", "true");
  const expandedBounds = await page.getByRole("dialog").boundingBox();
  expect(expandedBounds?.width ?? 0).toBeGreaterThan(Math.min(900, (page.viewportSize()?.width ?? 1280) - 64));
  await page.screenshot({ path: testInfo.outputPath("acervo-leitura-ampliada.png"), fullPage: true });
  expect(hrAccesses.filter(call => call.action === "view")).toHaveLength(1);
  await page.getByRole("dialog").press("Escape");
  expect(hrListCalls).toBe(settledHrListCalls);
  expect(settledHrListCalls).toBeLessThanOrEqual(2); // React Strict Mode pode repetir somente a montagem inicial.
  // No computador, a prévia ampliada usa o visualizador de PDF do navegador com o mesmo arquivo já autorizado.
  await setNativePdfViewer(page, true);
  await publishedFile.click();
  await panel.getByRole("button", { name: "Ampliar prévia", exact: true }).click();
  await expect(page.getByRole("dialog").locator('iframe[data-viewer="native"][title="Prévia de Kit publicado de teste"]')).toHaveAttribute("src", /^blob:/);
  expect(hrAccesses.filter(call => call.action === "view")).toHaveLength(1);
  await page.getByRole("dialog").press("Escape");
  await setNativePdfViewer(page, false);
  await publishedFile.click();
  await panel.getByRole("button", { name: "Renomear", exact: true }).click();
  await page.getByLabel("Nome no Acervo").fill("Kit publicado conferido");
  await page.getByRole("button", { name: "Salvar nome", exact: true }).click();
  const renamedPublishedFile = page.getByRole("button", { name: "Arquivo: Kit publicado conferido", exact: true });
  await expect(renamedPublishedFile).toBeVisible();
  // A busca da pasta do colaborador procura em todas as pastas dele, por termos em qualquer ordem.
  const personSearch = page.getByRole("searchbox", { name: "Buscar nos documentos de Administrador E2E" });
  await personSearch.fill("agosto atestado");
  const leaveFile = contents.getByRole("button", { name: "Arquivo: Atestado de agosto", exact: true });
  await expect(leaveFile).toBeVisible();
  await expect(leaveFile.getByText(/Afastamentos › 2026 › Agosto/)).toBeVisible();
  await expect(leaveFile.getByText("Publicado", { exact: true })).toHaveCount(0);
  await expect(renamedPublishedFile).toHaveCount(0);
  await personSearch.fill("ferias");
  await expect(contents.getByRole("button", { name: "Pasta: Férias", exact: true })).toBeVisible();
  await personSearch.clear();
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Administrador E2E", exact: true }).click();
  await contents.getByRole("button", { name: "Pasta: Férias", exact: true }).click();
  await contents.getByRole("button", { name: "Pasta: Conferência", exact: true }).click();
  const vacationFile = page.getByRole("button", { name: "Arquivo: Aviso publicado", exact: true });
  await vacationFile.click();
  await page.getByRole("dialog", { name: "Aviso publicado" }).getByRole("button", { name: "Mover", exact: true }).click();
  await page.getByLabel("Pasta de destino").selectOption(JSON.stringify(["Férias", "Período aquisitivo 2025-2026", "Parcela 01"]));
  await page.getByRole("button", { name: "Mover documento", exact: true }).click();
  await expect(vacationFile).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Caminho da pasta" }).getByText("Parcela 01", { exact: true })).toBeVisible();
  expect(organizationCalls).toEqual([
    { ids: ["published-kit-e2e"], action: "rename", name: "Kit publicado conferido", expectedName: "Kit publicado de teste" },
    { ids: ["published-vacation-e2e"], action: "move", path: ["Férias", "Período aquisitivo 2025-2026", "Parcela 01"], expectedPath: ["Férias", "Conferência"] },
  ]);
  await page.screenshot({ path: testInfo.outputPath("acervo-colaborador.png"), fullPage: true });

  // Pastas da empresa no modo Painel lateral.
  await sections.getByRole("link", { name: "Empresa", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/documents$/, { timeout: 90_000 });
  await expect(contents.getByRole("button", { name: /^Pasta:/ }).first()).toHaveAttribute("aria-label", "Pasta: 01 - Societário");
  await page.getByRole("combobox", { name: "Ordenar documentos" }).selectOption("title-desc");
  await expect(contents.getByRole("button", { name: /^Pasta:/ }).first()).toHaveAttribute("aria-label", "Pasta: 11 - A classificar");
  await page.getByRole("button", { name: "Título", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ordenar documentos" })).toHaveValue("title-asc");
  await page.getByRole("button", { name: "Pasta: 06 - Contratos", exact: true }).click();
  await expect(page).toHaveURL(/category=Contratos/);
  const fileNames = () => contents.getByRole("button", { name: /^Arquivo:/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-label")));
  await page.getByRole("combobox", { name: "Ordenar documentos" }).selectOption("modified-asc");
  expect(await fileNames()).toEqual(["Arquivo: Aditivo da unidade", "Arquivo: Contrato da unidade"]);
  await page.getByRole("button", { name: "Modificado", exact: true }).click();
  expect(await fileNames()).toEqual(["Arquivo: Contrato da unidade", "Arquivo: Aditivo da unidade"]);
  await page.getByRole("combobox", { name: "Ordenar documentos" }).selectOption("size-asc");
  expect(await fileNames()).toEqual(["Arquivo: Contrato da unidade", "Arquivo: Aditivo da unidade"]);
  await page.getByRole("button", { name: "Tamanho", exact: true }).click();
  expect(await fileNames()).toEqual(["Arquivo: Aditivo da unidade", "Arquivo: Contrato da unidade"]);
  const file = page.getByRole("button", { name: "Arquivo: Contrato da unidade", exact: true });
  await file.click();
  const filePanel = page.getByRole("dialog", { name: "Contrato da unidade" });
  await expect(filePanel.getByRole("img", { name: "Prévia de Contrato da unidade" })).toHaveAttribute("data-rendered", "true");
  await expect(filePanel.getByRole("button", { name: "Baixar", exact: true })).toBeVisible();
  await filePanel.getByRole("button", { name: "Ampliar prévia", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Contrato da unidade" })).toHaveAttribute("data-rendered", "true");
  await page.getByRole("dialog").getByRole("button", { name: "Próxima página da prévia" }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Contrato da unidade" })).toHaveAttribute("data-page", "2");
  await page.getByRole("dialog").getByRole("button", { name: "Página anterior da prévia" }).click();
  expect(accesses.filter(call => call.id === "archive-company-e2e" && call.action === "view")).toHaveLength(1);
  await page.getByRole("dialog").press("Escape");
  await page.screenshot({ path: testInfo.outputPath("acervo-empresa.png"), fullPage: true });

  // Modo Clássico: linha "Pasta atual" e menu ⋯ visível em cada linha.
  const modes = page.getByRole("radiogroup", { name: "Modo de visualização" });
  await modes.getByRole("radio", { name: "Clássico" }).click();
  await expect(contents.getByText("Pasta atual", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ações de Contrato da unidade" }).click();
  await expect(page.getByRole("menuitem", { name: "Baixar", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("acervo-classico.png"), fullPage: true });
  // Modo Cascata: a prévia fica na última coluna.
  await modes.getByRole("radio", { name: "Cascata" }).click();
  await file.click();
  await expect(page.getByRole("complementary", { name: "Prévia e detalhes" }).getByRole("img", { name: "Prévia de Contrato da unidade" })).toHaveAttribute("data-rendered", "true");
  await page.screenshot({ path: testInfo.outputPath("acervo-cascata.png"), fullPage: true });
  await page.reload();
  await expect(page.getByRole("radiogroup", { name: "Modo de visualização" }).getByRole("radio", { name: "Cascata" })).toHaveAttribute("aria-checked", "true", { timeout: 90_000 });
  await page.getByRole("radiogroup", { name: "Modo de visualização" }).getByRole("radio", { name: "Painel lateral" }).click();

  // Voltar é pela trilha; o histórico do navegador também funciona.
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Empresa", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pasta: 06 - Contratos", exact: true })).toBeVisible();
  await page.goBack();
  await expect(file).toBeVisible();
  await file.click({button:"right"});
  await page.getByRole("dialog", { name: "Contrato da unidade" }).getByRole("button", {name:"Excluir",exact:true}).click();
  await expect(page.getByRole("dialog").getByText(/remove o registro da Empresa e o arquivo armazenado/)).toBeVisible();
  expect(deleteCalls).toBe(0);
  await page.getByRole("dialog").getByRole("button", {name:"Continuar"}).click();
  expect(deleteCalls).toBe(0);
  await page.getByRole("dialog").getByRole("button", {name:"Cancelar"}).click();
  expect(deleteCalls).toBe(0);
  await file.press("Shift+F10");
  await page.getByRole("dialog", { name: "Contrato da unidade" }).getByRole("button", {name:"Excluir",exact:true}).click();
  await page.getByRole("dialog").getByRole("button", {name:"Continuar"}).click();
  await page.getByRole("dialog").getByRole("button", {name:"Excluir definitivamente"}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Falha simulada ao excluir.");
  await page.getByRole("dialog").getByRole("button", {name:"Cancelar"}).click();
  await expect(file).toBeVisible();
  await file.click();
  await page.getByRole("dialog", { name: "Contrato da unidade" }).getByRole("button", {name:"Excluir",exact:true}).click();
  await page.getByRole("dialog").getByRole("button", {name:"Continuar"}).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", {name:"Excluir definitivamente"}).click();
  await expect(file).toHaveCount(0);
  expect(deleteCalls).toBe(2);
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Empresa", exact: true }).click();
  await expect(contents.getByRole("button", { name: "Pasta: 08 - Jurídico", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pasta: 10 - Modelos", exact: true }).click();
  await page.getByRole("button", { name: "Pasta: Financeiro e recibos", exact: true }).click();
  await page.getByRole("button", { name: "Modelo: Recibo de pagamento", exact: true }).click();
  const modelPanel = page.getByRole("dialog", { name: "Recibo de pagamento" });
  await expect(modelPanel.getByRole("img", { name: "Prévia de Recibo de pagamento" })).toHaveAttribute("data-rendered", "true");
  await expect(modelPanel.getByRole("button", { name: "Gerar documento", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("acervo-modelos.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Gerenciar biblioteca", exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/generator\/models$/);
  await page.getByRole("button", { name: "Novo modelo", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.route("**/api/documents/work-items?*", (route) => route.fulfill({ json: { items: [], warnings: [], pages: [] } }));
  const sidebar = page.getByRole("complementary", { name: "Navegação do Coala One" });
  await sidebar.getByRole("link", { name: "Fluxos e pendências", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fluxos e pendências", exact: true })).toBeVisible();
  await sidebar.getByRole("link", { name: "Acervo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Acervo", exact: true })).toBeVisible();
});

test("Colaborador e Financeiro institucional abrem pastas e arquivos no painel lateral", async ({ page }) => {
  test.setTimeout(300_000);
  const pdf = await PDFDocument.create(); pdf.addPage().drawText("Documento de teste", { x: 40, y: 740 });
  const bytes = Buffer.from(await pdf.save());
  const companyAccesses: Array<{ id: string; action: string }> = [];
  let financialInboxCalls = 0;
  let generatedDeleteCalls = 0;
  await page.route("**/api/hr/employee-documents?*", (route) => route.fulfill({ json: { documents: [{ id: "employee-file-e2e", category: "personal", documentType: "Documento de identificação", documentTypeCode: "PERSONAL_ID", displayName: "Identidade de teste", storedName: "COL-001__IDENTIFICACAO__v01", originalName: "identidade.pdf", mimeType: "application/pdf", size: bytes.length }, ...Array.from({ length: 7 }, (_, index) => ({ id: `package-reference-${index}`, employeeId: "employee", source: "autentique_signature", documentTypeCode: "ADMISSION_PACKAGE", category: "admission", displayName: "Kit admissional assinado", originalName: `Componente ${index}.pdf`, mimeType: "application/pdf", contentHash: "c".repeat(64), signatureRequestId: "bundle", sourceOnboardingId: "onboarding", size: bytes.length }))] } }));
  await page.route("**/api/hr/employee-documents/access", (route) => route.fulfill({ contentType: "application/pdf", body: bytes }));
  await page.route("**/api/hr/employee-document-folder-profile?*", (route) => route.fulfill({ json: { folderProfile: { folders: [{ id: "personal", category: "personal", path: ["Documentos pessoais"], employeeVisible: true }] } } }));
  await page.route("**/api/documents/generated?*", (route) => route.fulfill({ json: { documents: [{ id: "generated-archive-e2e", status: "review_pending", templateName: "Contrato gerado", originalName: "contrato.docx", pdfAvailable: true }] } }));
  await page.route("**/api/documents/generated/generated-archive-e2e/file?format=pdf", (route) => route.fulfill({ contentType: "application/pdf", body: bytes }));
  await page.route("**/api/documents/generated/generated-archive-e2e", (route) => { generatedDeleteCalls++; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/documents/company", (route) => route.fulfill({ json: { documents: [{ id: "institutional-finance-e2e", title: "Relatório financeiro da unidade", category: "Financeiro", status: "active", originalName: "relatorio-financeiro.pdf", mimeType: "application/pdf", size: bytes.length, uploadedAt: "2026-11-02T12:00:00.000Z" }] } }));
  await page.route("**/api/documents/company/units", (route) => route.fulfill({ json: { units: [] } }));
  await page.route("**/api/documents/company/access", async (route) => { companyAccesses.push(route.request().postDataJSON()); await route.fulfill({ contentType: "application/pdf", body: bytes }); });
  await page.route("**/api/financial/inbox?*", (route) => { financialInboxCalls++; return route.fulfill({ status: 500, json: { error: "A caixa financeira não integra o Acervo." } }); });
  await page.route("**/api/audit/log", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/login?next=%2Fdashboard%2Fdocuments%2Fcollaborators");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true }).click();
  await page.getByRole("button", { name: "Pasta: Identificação", exact: true }).click();
  await page.getByRole("button", { name: "Arquivo: Identidade de teste", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Identidade de teste" })).toHaveAttribute("data-rendered", "true");
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Administrador E2E", exact: true }).click();
  await page.getByRole("button", { name: "Pasta: Admissão", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arquivo: Kit admissional assinado", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Arquivo: Kit admissional assinado", exact: true }).click();
  await page.getByRole("dialog").press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Arquivo: Kit admissional assinado", exact: true }).click();
  await page.getByRole("dialog").getByRole("region", {name:"Prévia e detalhes"}).getByText("Detalhes do arquivo", {exact:true}).click();
  await expect(page.getByText(/7 referências ao mesmo kit assinado/)).toBeVisible();
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Colaborador", exact: true }).click();
  await expect(page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Seções do Acervo" }).getByRole("link", { name: "Empresa", exact: true }).click();
  await page.getByRole("button", { name: "Pasta: 07 - Financeiro", exact: true }).click();
  await expect(page).toHaveURL(/category=Financeiro/);
  await expect(page.getByRole("button", { name: "Pasta: Identificados", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arquivo: Recibo financeiro.pdf", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Arquivo: Relatório financeiro da unidade", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Relatório financeiro da unidade" })).toHaveAttribute("data-rendered", "true");
  expect(companyAccesses.filter(call => call.id === "institutional-finance-e2e" && call.action === "view")).toHaveLength(1);
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("button", { name: "Arquivo: Relatório financeiro da unidade", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Relatório financeiro da unidade" }).getByRole("button", { name: "Baixar", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(financialInboxCalls).toBe(0);
  await expect(page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Empresa", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Caminho da pasta" }).getByRole("button", { name: "Empresa", exact: true }).click();
  await page.getByRole("navigation", { name: "Seções do Acervo" }).getByRole("link", { name: "Colaborador", exact: true }).click();
  await page.getByRole("button", { name: "Abrir pasta de Administrador E2E", exact: true }).click();
  await page.getByRole("button", { name: "Pasta: Documentos gerados", exact: true }).click();
  await page.getByRole("button", { name: "Arquivo: Contrato gerado", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("img", { name: "Prévia de Contrato gerado" })).toHaveAttribute("data-rendered", "true");
  await page.getByRole("dialog").press("Escape");
  await page.getByRole("button", { name: "Arquivo: Contrato gerado", exact: true }).click({ button: "right" });
  await page.getByRole("dialog", { name: "Contrato gerado" }).getByRole("button", { name: "Descartar preparação", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/Somente a prévia em rascunho ou conferência/)).toBeVisible();
  expect(generatedDeleteCalls).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Continuar", exact: true }).click();
  expect(generatedDeleteCalls).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: "Descartar definitivamente", exact: true }).click();
  await expect(page.getByRole("button", { name: "Arquivo: Contrato gerado", exact: true })).toHaveCount(0);
  expect(generatedDeleteCalls).toBe(1);
});

test("perfil comum abre só a própria pasta publicada e baixa com o nome da origem", async ({ page }) => {
  test.setTimeout(180_000);
  const app = getApps().find(item => item.name === "published-common-e2e") ?? initializeApp({projectId:"demo-coala-e2e"},"published-common-e2e");
  const auth = getAuth(app), db = getFirestore(app,"coala");
  const uid = "published-common-e2e", email = "published.common@coala.test", password = "coala-published-e2e";
  try {
    await auth.createUser({uid,email,password,emailVerified:true,displayName:"Colaboradora Comum E2E"}).catch(error => { if (error.code !== "auth/uid-already-exists") throw error; });
    await auth.setCustomUserClaims(uid,{profileId:"published-common-profile",isDefaultAdmin:false});
    await db.collection("profiles").doc("published-common-profile").set({name:"Colaborador",permissions:{},isDefaultAdmin:false});
    await db.collection("users").doc(uid).set({username:"Colaboradora Comum E2E",email,profileId:"published-common-profile",isActive:true,sessionVersion:0,
      loginRestrictionEnabled:false,profileCompliance:{status:"complete",policyVersion:1,missingFields:[],invalidFields:[],nextReviewAt:"2027-11-03"}});
    const pdf = await PDFDocument.create(); pdf.addPage(); const bytes = Buffer.from(await pdf.save());
    const ownCalls: Array<{id:string;action:string}> = [];
    let hrCalls = 0;
    await page.route("**/api/collaborator/documents", route => route.fulfill({json:{documents:[{id:"own-kit-e2e",displayName:"Kit comum",documentType:"Kit admissional",documentTypeCode:"ADMISSION_PACKAGE",category:"admission",destinationTrail:[],mimeType:"application/pdf",publishedAt:"2026-11-03"}],folderProfile:{folders:[]},limitReached:false}}));
    await page.route("**/api/collaborator/documents/access", async route => {ownCalls.push(route.request().postDataJSON());await route.fulfill({contentType:"application/pdf",headers:{"Content-Disposition":"attachment; filename*=UTF-8''KIT-CANONICO.pdf"},body:bytes});});
    await page.route("**/api/hr/employee-documents?*", route => {hrCalls++;return route.fulfill({status:403,json:{error:"fora de escopo"}});});
    await page.goto("/login?next=%2Fdashboard%2Fdocuments%2Fpublished");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(password);
    await page.getByRole("button",{name:"Entrar no sistema"}).click();
    // Sem acesso à equipe: abre direto na própria pasta (endereço antigo redireciona), sem seletor e sem a aba Empresa.
    await expect(page.getByRole("heading",{name:"Colaboradora Comum E2E",exact:true})).toBeVisible({timeout:90_000});
    await expect(page).toHaveURL(/\/dashboard\/documents\/collaborators$/);
    await expect(page.getByRole("navigation",{name:"Seções do Acervo"}).getByRole("link",{name:"Empresa",exact:true})).toHaveCount(0);
    await expect(page.getByRole("combobox",{name:"Trocar colaborador"})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Pasta: Identificação",exact:true})).toHaveCount(0); // só pastas com documento publicado
    await page.getByRole("button",{name:"Pasta: Admissão",exact:true}).click();
    await expect(page.getByRole("button",{name:"Arquivo: Kit comum",exact:true}).getByText("Publicado",{exact:true})).toHaveCount(0);
    await page.getByRole("button",{name:"Arquivo: Kit comum",exact:true}).press("Enter");
    const ownPanel = page.getByRole("dialog",{name:"Kit comum"});
    await expect(ownPanel.getByRole("button",{name:"Renomear",exact:true})).toHaveCount(0);
    await expect(ownPanel.getByRole("button",{name:"Mover",exact:true})).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download");
    await ownPanel.getByRole("button",{name:"Baixar",exact:true}).click();
    assert.equal((await downloadPromise).suggestedFilename(),"KIT-CANONICO.pdf");
    expect(ownCalls).toContainEqual({id:"own-kit-e2e",action:"download"});
    expect(hrCalls).toBe(0);
  } finally {
    await db.collection("users").doc(uid).delete().catch(() => undefined);
    await db.collection("profiles").doc("published-common-profile").delete().catch(() => undefined);
    await auth.deleteUser(uid).catch(() => undefined);
    await deleteApp(app);
  }
});
