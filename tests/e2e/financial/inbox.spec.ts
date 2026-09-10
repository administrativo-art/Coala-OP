import { expect, test } from "@playwright/test";

import { E2E_USER } from "../support/global-setup";

test("confirma uma sugestão de vínculo identificada pela linha telefônica", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses/inbox");
  await expect(page.getByRole("heading", { name: "Caixa de cobranças" })).toBeVisible();
  await expect(page.getByText("+5598999991234", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("mesma linha telefônica", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Vincular sugestão" }).click();
  await expect(page.getByRole("heading", { name: "Confirmar vínculo?" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar vínculo" }).click();

  await expect(page.getByText("Vinculada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cobrança vinculada.", { exact: true })).toBeVisible();
});
