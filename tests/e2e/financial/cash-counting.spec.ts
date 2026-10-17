import { expect, test, type Page } from "@playwright/test";

import { E2E_CASH_COUNTING, E2E_USER } from "../support/global-setup";

async function login(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page).toHaveURL(/\/dashboard(?:$|\/)/, { timeout: 180_000 });
}

test("percorre o modal redesenhado da data até a conferência do operador", async ({ page }) => {
  test.setTimeout(420_000);
  await login(page);
  await page.goto(`/dashboard/financial/cash-closures/sessions/${E2E_CASH_COUNTING.sessionId}`, {
    waitUntil: "domcontentloaded",
  });

  await page.getByRole("button", { name: new RegExp(E2E_CASH_COUNTING.kioskName) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Contar malote", { exact: true }).last()).toBeVisible();
  await expect(dialog.getByRole("navigation", { name: "Etapas para contar e finalizar o malote" }).getByRole("button")).toHaveCount(4);
  await expect(dialog.getByText("ETAPA 1 DE 4 · IDENTIFICAÇÃO")).toBeVisible();

  await dialog.getByRole("button", { name: /Ontem/ }).click();
  const chooseOperator = dialog.getByRole("button", { name: "Escolher operador" });
  await expect(chooseOperator).toBeEnabled({ timeout: 180_000 });
  await chooseOperator.click();

  await expect(dialog.getByText("ETAPA 2 DE 4 · OPERADOR")).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Operadores do malote" }).getByText(E2E_CASH_COUNTING.operatorName)).toBeVisible();
  await dialog.getByRole("button", { name: "Começar contagem" }).click();

  await expect(dialog.getByText("ETAPA 3 DE 4 · CONFERÊNCIA")).toBeVisible();
  await expect(dialog.getByText("Canal manual")).toBeVisible();
  await expect(dialog.getByLabel(`Valor informado pelo Caixa em Dinheiro para ${E2E_CASH_COUNTING.operatorName}`)).toBeVisible();
  await expect(dialog.getByLabel(`Valor contado agora em Dinheiro para ${E2E_CASH_COUNTING.operatorName}`)).toBeVisible();
});
