import { expect, test } from "@playwright/test";

import { E2E_USER, resetFinancialE2EFixtures } from "../support/global-setup";

test.beforeEach(async () => {
  await resetFinancialE2EFixtures();
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

  await page.getByRole("button", { name: "Vincular à despesa" }).click();
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
  await page.getByRole("button", { name: "Reprocessar documento" }).click();
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
  await page.getByRole("button", { name: "Restaurar" }).click();
  await page.getByRole("radio", { name: "Ruídos" }).click();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeVisible();
  await page.getByRole("button", { name: "Descartados manualmente" }).click();
  await expect(page.getByRole("button", { name: /Abrir cobrança Boletim sem cobrança A E2E/ })).toBeHidden();
});
