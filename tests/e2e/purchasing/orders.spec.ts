import { expect, test } from "@playwright/test";

import { E2E_ORDER_IDS, E2E_USER } from "../support/global-setup";

test("protege a listagem, as gavetas e o retrocesso de pedido", async ({ page }) => {
  await test.step("autentica somente no emulador", async () => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(E2E_USER.email);
    await page.getByLabel("Senha").fill(E2E_USER.password);
    await page.getByRole("button", { name: "Entrar no sistema" }).click();
    await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();
  });

  await test.step("lista pedidos e filtra a etapa a receber", async () => {
    await page.goto("/dashboard/purchasing/orders");

    await expect(page.getByRole("heading", { name: "Pedidos de compra" })).toBeVisible();
    await expect(page.getByText("Fornecedor E2E Emitido", { exact: true })).toBeVisible();
    await expect(page.getByText("Fornecedor E2E Confirmado", { exact: true })).toBeVisible();
    await expect(page.getByText(/Itens: Escada 2 Degraus Alumínio/)).toBeVisible();

    await page.getByRole("button", { name: /A receber\s+1/ }).click();
    await expect(page.getByText("Fornecedor E2E Confirmado", { exact: true })).toBeVisible();
    await expect(page.getByText("Fornecedor E2E Emitido", { exact: true })).toBeHidden();
  });

  await test.step("abre o detalhe e valida as gavetas sensíveis", async () => {
    await page.getByRole("link", { name: /Fornecedor E2E Confirmado/ }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/purchasing/orders/${E2E_ORDER_IDS.confirmed}$`));
    await expect(page.getByRole("heading", { name: "Fornecedor E2E Confirmado" })).toBeVisible();
    await expect(page.getByText("Escada 2 Degraus Alumínio", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Editar pedido" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Editar pedido" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Recebida em outro lugar" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Recebida em outro lugar" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Cancelar pedido" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("retrocede a etapa e reflete o novo estado na listagem", async () => {
    await page.getByRole("button", { name: "Retroceder etapa" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Retroceder pedido para revisão" })).toBeVisible();
    await drawer.getByRole("button", { name: "Corrigir itens ou valores do pedido" }).click();
    await drawer.getByRole("button", { name: "Retroceder para revisão" }).click();

    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: "Confirmar pedido" })).toBeVisible();

    await page.goto("/dashboard/purchasing/orders");
    await page.getByRole("button", { name: /Emitido\s+2/ }).click();
    await expect(page.getByText("Fornecedor E2E Confirmado", { exact: true })).toBeVisible();
  });
});
