import { expect, test } from "@playwright/test";

import { E2E_USER, E2E_INVOICE_DESTINATIONS, clearInvoiceDestinationE2EFixtures, resetFinancialE2EFixtures, seedInvoiceDestinationE2EFixtures } from "../support/global-setup";

test.beforeEach(async () => {
  await resetFinancialE2EFixtures();
});
test.afterEach(async () => {
  await clearInvoiceDestinationE2EFixtures();
});

async function loginForInvoice(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();
}

test("confirma NF sem patrimônio, cancela exclusão e retoma após erro sem falso sucesso", async ({ page }) => {
  await seedInvoiceDestinationE2EFixtures();
  let deleteCalls = 0;
  await page.route(`**/api/financial/inbox/${E2E_INVOICE_DESTINATIONS.nonAsset}/files/nf/destination`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    deleteCalls += 1;
    if (deleteCalls === 1) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "INVOICE_DELETE_CONFLICT", message: "O armazenamento ainda exige revisão. Tente novamente." } }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ destination: { kind: "non_asset_invoice", assetIds: [], version: 1, sha256: "b".repeat(64), confirmedAt: "2026-11-03T00:00:00.000Z", confirmedBy: E2E_USER.uid, deletionState: "deleted" } }) });
  });
  await loginForInvoice(page);
  await page.goto("/dashboard/financial/expenses/inbox");
  await page.getByRole("button", { name: /Abrir cobrança Nota fiscal sem patrimônio E2E/ }).click();
  await page.getByRole("button", { name: "Tratar como nota fiscal" }).click();
  await page.getByRole("button", { name: "Confirmar NF sem patrimônio" }).click();
  await expect(page.getByText("Destino sem patrimônio confirmado. Conclua a exclusão do arquivo recebido.")).toBeVisible();
  await page.getByRole("button", { name: "Excluir arquivo recebido" }).click();
  await page.getByRole("button", { name: "Cancelar" }).last().click();
  expect(deleteCalls).toBe(0);
  await expect(page.getByRole("button", { name: "Confirmar exclusão deste arquivo" })).toBeHidden();
  await page.getByRole("button", { name: "Excluir arquivo recebido" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão deste arquivo" }).click();
  await expect(page.getByRole("alert")).toContainText("O armazenamento ainda exige revisão");
  await expect(page.getByText("Arquivo recebido excluído; histórico preservado.")).toBeHidden();
  await page.getByRole("button", { name: "Confirmar exclusão deste arquivo" }).click();
  await expect(page.getByText("Arquivo recebido excluído; histórico preservado.")).toBeVisible();
  expect(deleteCalls).toBe(2);
});

test("NF patrimonial confirmada na cobrança aparece no ativo sem copiar arquivo", async ({ page }) => {
  await seedInvoiceDestinationE2EFixtures();
  await loginForInvoice(page);
  await page.goto("/dashboard/financial/expenses/inbox");
  await page.getByRole("button", { name: /Abrir cobrança Nota fiscal patrimonial E2E/ }).click();
  await page.getByRole("button", { name: "Tratar como nota fiscal" }).click();
  await page.getByRole("textbox", { name: "Código do patrimônio" }).fill(E2E_INVOICE_DESTINATIONS.assetCode);
  await page.getByRole("button", { name: "Adicionar patrimônio" }).click();
  await expect(page.getByText(`${E2E_INVOICE_DESTINATIONS.assetCode} · Máquina NF E2E`)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar vínculo ao patrimônio" }).click();
  await expect(page.getByText("Vinculada a 1 patrimônio(s)." )).toBeVisible();
  await page.goto("/dashboard/assets");
  await page.getByRole("button", { name: /Máquina NF E2E/ }).first().click();
  await page.getByRole("button", { name: "Aquisição" }).click();
  await expect(page.getByRole("button", { name: "Abrir NF recebida 1" })).toBeVisible();
});

test("identifica um lembrete sem alterar a despesa e o preserva na auditoria", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses/inbox");
  await expect(page.getByRole("heading", { name: "Caixa de cobranças" })).toBeVisible();
  await page.getByText("A fatura Vivo Móvel da sua empresa chegou", { exact: true }).first().click();
  await expect(page.getByText("+5598999991234", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("mesma linha telefônica", { exact: false })).toBeVisible();
  const suggestedPosting = await page.getByText("1. Lançamento sugerido", { exact: true }).boundingBox();
  const nextDecision = await page.getByText("2. Próxima decisão", { exact: true }).boundingBox();
  expect(suggestedPosting).not.toBeNull();
  expect(nextDecision).not.toBeNull();
  expect(suggestedPosting!.y).toBeLessThan(nextDecision!.y);

  await page.getByRole("button", { name: "Vincular à despesa", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Confirmar identificação?" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar como já existente" }).click();

  await expect(page.getByText("Cobrança identificada.", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: /Cobranças identificadas/ }).click();
  await expect(page.getByText("Lembrete", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Nome, valor e pagamento foram preservados", { exact: false }).first()).toBeVisible();
});

test("ativa o opt-in e identifica automaticamente somente pelo boleto idêntico", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses/inbox");
  const automation = page.getByRole("switch", { name: "Ativar vinculação automática por identidade documental" });
  await expect(automation).toHaveAttribute("aria-checked", "false");
  await automation.click();
  await expect(automation).toHaveAttribute("aria-checked", "true");

  await page.getByPlaceholder("Buscar fornecedor, assunto, valor, conta ou telefone...").fill("Cobrança automática documental E2E");
  await expect(page.getByText("Cobrança automática documental E2E", { exact: true }).first()).toBeVisible();
  await page.getByText("Cobrança automática documental E2E", { exact: true }).first().click();
  await page.getByRole("button", { name: "Reprocessar documento", exact: true }).click();
  await expect(page.getByText("Cobrança analisada contra despesas, previsões e pagamentos.", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /Cobranças identificadas/ }).click();
  const identifiedCharge = page.getByRole("button", { name: /Abrir cobrança Cobrança automática documental E2E/ });
  await expect(identifiedCharge).toBeVisible();
  await identifiedCharge.click();
  await expect(page.getByText("Identificação automática em", { exact: false })).toBeVisible();
  await expect(page.getByText("Nome, valor e pagamento foram preservados", { exact: false }).first()).toBeVisible();
});

test("separa ruído automático de descarte manual e arquiva só a página visível com restauração", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses/inbox");
  await page.getByRole("radio", { name: "Ruídos" }).click();
  await expect(page.getByRole("heading", { name: "Ruídos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança B E2E/ })).toBeVisible();
  await page.getByRole("button", { name: "Selecionar todos desta página" }).click();
  await expect(page.getByRole("region", { name: "Ações em massa" })).toContainText("2 cobranças selecionadas para arquivamento");
  await page.getByRole("region", { name: "Ações em massa" }).getByRole("button", { name: "Arquivar cobranças" }).click();
  await expect(page.getByRole("heading", { name: "Arquivar 2 cobranças?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Arquivar cobranças" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("2 mensagens arquivadas.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeHidden();

  await page.getByRole("radio", { name: /Cobranças identificadas/ }).click();
  await page.getByRole("button", { name: "Arquivadas" }).click();
  await page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ }).click();
  await page.getByRole("button", { name: "Restaurar cobrança", exact: true }).click();
  await page.getByRole("radio", { name: "Ruídos" }).click();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeVisible();
  await page.getByRole("button", { name: "Descartados manualmente" }).click();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeHidden();
});
