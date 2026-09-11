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
