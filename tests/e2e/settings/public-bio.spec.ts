import { expect, test } from "@playwright/test";

import { E2E_USER } from "../support/global-setup";

test("edita com prévia, publica somente links externos e mantém a edição protegida", async ({ page, request }) => {
  const unauthorized = await request.get("/api/settings/public-bio");
  expect(unauthorized.status()).toBe(401);
  expect((await request.get("/api/settings/public-bio/media/25ffdb78-d6c9-4357-a98b-6f50c89a50e4")).status()).toBe(401);
  expect((await request.get("/api/public/bio/media/25ffdb78-d6c9-4357-a98b-6f50c89a50e4")).status()).toBe(404);
  expect((await (await request.get("/api/public/bio")).json()).page).toBeNull();

  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();

  await page.goto("/dashboard/settings?department=operacional&tab=public-bio");
  await expect(page.getByText("Prévia ao vivo")).toBeVisible();
  await expect(page.getByText("Imagens do cardápio")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Imagens das promoções" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Acessar página" })).toBeVisible();
  await expect(page.getByAltText("QR Code da página pública Coala Shakes")).toBeVisible();

  const urls = page.getByPlaceholder("https://");
  await urls.first().fill("https://op.coalashakes.com/dashboard");
  await page.getByRole("button", { name: "Publicar página" }).click();
  await expect(page.getByRole("status")).toContainText("destino público e válido");

  for (let index = 0; index < await urls.count(); index += 1) {
    await urls.nth(index).fill(`https://example.com/coala-${index}`);
  }
  await page.getByRole("checkbox", { name: "Mostrar Promoções" }).uncheck();
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByRole("status")).toContainText("Rascunho salvo");
  expect((await (await request.get("/api/public/bio")).json()).page).toBeNull();

  await page.getByRole("button", { name: "Publicar página" }).click();
  await expect(page.getByRole("status")).toContainText("Página publicada");
  const published = await (await request.get("/api/public/bio")).json();
  expect(published.page.links).toHaveLength(5);
  expect(published.page.links.every((link: { url: string }) => link.url.startsWith("https://example.com/"))).toBe(true);
  expect(published.page.links.some((link: { label: string }) => link.label === "Promoções")).toBe(false);
  expect(published).not.toHaveProperty("draft");
});
