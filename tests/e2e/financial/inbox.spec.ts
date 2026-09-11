import { expect, test } from "@playwright/test";

import { E2E_USER } from "../support/global-setup";

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

  await page.getByRole("button", { name: "Confirmar como já registrada" }).click();
  await expect(page.getByRole("heading", { name: "Confirmar identificação?" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar como já existente" }).click();

  await expect(page.getByText("Cobrança identificada.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Cobranças identificadas/ }).click();
  await expect(page.getByText("Lembrete", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("A despesa não foi alterada.", { exact: false })).toBeVisible();
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
  await expect(page.getByText("Vinculação automática ativada.", { exact: true })).toBeVisible();
  await expect(automation).toHaveAttribute("aria-checked", "true");

  await page.getByLabel("Buscar cobranças").fill("Cobrança automática documental E2E");
  await expect(page.getByText("Cobrança automática documental E2E", { exact: true }).first()).toBeVisible();
  await page.getByText("Cobrança automática documental E2E", { exact: true }).first().click();
  await page.getByRole("button", { name: "Analisar cobrança" }).click();
  await expect(page.getByText("Cobrança analisada contra despesas, previsões e pagamentos.", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Cobranças identificadas/ }).click();
  await expect(page.getByText("Cobrança automática documental E2E", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Identificação automática em", { exact: false })).toBeVisible();
  await expect(page.getByText("A despesa não foi alterada.", { exact: false })).toBeVisible();
});
