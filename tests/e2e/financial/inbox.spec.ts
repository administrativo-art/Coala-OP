import { expect, test } from "@playwright/test";

import { E2E_FINANCIAL_INBOX_IDS, E2E_USER } from "../support/global-setup";

test("confirma uma sugestão de vínculo identificada pela linha telefônica", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses/inbox");
  await expect(page.getByRole("heading", { name: "Cobranças recebidas" })).toBeVisible();
  await expect(page.getByText("+5598999991234", { exact: false })).toBeVisible();
  await expect(page.getByText("mesma linha telefônica", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Confirmar vínculo" }).click();

  await expect(page.getByText("Vinculada", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`Cobrança vinculada à despesa ${E2E_FINANCIAL_INBOX_IDS.expense}.`)).toBeVisible();
});
