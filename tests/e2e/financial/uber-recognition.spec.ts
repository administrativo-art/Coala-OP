import { expect, test } from "@playwright/test";

import { E2E_USER } from "../support/global-setup";

test("mostra quem solicitou uma viagem Uber reconhecida na despesa", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/financial/expenses");
  await expect(page.getByRole("heading", { name: "Despesas" })).toBeVisible();
  const expenseRow = page.getByRole("row").filter({ hasText: "UBER *TRIP E2E" }).first();
  await expect(expenseRow.getByText("UBER *TRIP E2E", { exact: true })).toBeVisible();
  await expect(expenseRow.getByText("Solicitada por Maria Operações", { exact: true })).toBeVisible();

  await expenseRow.getByText("UBER *TRIP E2E", { exact: true }).click();
  await expect(page.getByText("UberX ·", { exact: false })).toBeVisible();
  await expect(page.getByText("viagem trip-e2e-123", { exact: false })).toBeVisible();
});
