import { expect, test } from "@playwright/test";
import { E2E_USER } from "../support/global-setup";

test("recibo fecha confirmação ao falhar consulta e exige atualização após envio incerto", async ({ page }) => {
  test.setTimeout(240_000);
  let failRead = false;
  let submitted = 0;
  let status = "ready_to_submit";
  let holdNextRead = false;
  let releaseRead: (() => void) | undefined;
  const document = { id: "receipt-payment-e2e", templateId: "system-receipt-standard", templateName: "Recibo de pagamento", employeeName: "Pessoa de teste", status: "approved", pdfAvailable: true, signatureScope: "independent", signatureStatus: "not_sent", parties: [] };
  await page.route("**/api/documents/generated", (route) => route.fulfill({ json: { documents: [document] } }));
  await page.route("**/api/documents/generated/receipt-payment-e2e/payment", async (route) => {
    if (route.request().method() === "POST") {
      submitted++;
      status = "submitting";
      return route.fulfill({ status: 503, json: { error: "Resposta bancária incerta; consulte o estado." } });
    }
    const snapshot = { id: "request-e2e", status, canResume: status === "ready_to_submit" };
    if (holdNextRead) {
      holdNextRead = false;
      await new Promise<void>((resolve) => { releaseRead = resolve; });
    }
    return failRead
      ? route.fulfill({ status: 503, json: { error: "Consulta indisponível" } })
      : route.fulfill({ json: { request: snapshot } });
  });
  await page.goto("/login?next=%2Fdashboard%2Fdocuments%2Fgenerated%2Fmanage%3Fdocument%3Dreceipt-payment-e2e");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Senha").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Entrar no sistema" }).click();
  await expect(page.getByRole("heading", { name: "Fluxos e pendências", exact: true })).toBeVisible({ timeout: 180_000 });
  const resume = page.getByRole("button", { name: "Retomar envio ao Inter", exact: true });
  const confirm = page.getByRole("button", { name: "Enviar ao Inter", exact: true });
  const refresh = page.getByRole("button", { name: "Atualizar pagamento", exact: true });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(confirm).toBeVisible();
  failRead = true;
  await refresh.click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText("Não foi possível consultar o pagamento. Use Atualizar pagamento antes de enviar ou retomar.", { exact: true })).toBeVisible();
  await expect(resume).toBeDisabled();
  expect(submitted).toBe(0);
  failRead = false;
  await refresh.click();
  await expect(resume).toBeEnabled();
  holdNextRead = true;
  await refresh.click();
  await expect.poll(() => Boolean(releaseRead)).toBe(true);
  await refresh.click();
  await expect(resume).toBeEnabled();
  await resume.click();
  await confirm.click();
  await expect(page.getByText("Resposta bancária incerta; consulte o estado.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar pagamento ao Inter", exact: true })).toBeDisabled();
  expect(submitted).toBe(1);
  const staleResponse = page.waitForResponse((response) => response.url().endsWith("/receipt-payment-e2e/payment") && response.request().method() === "GET");
  releaseRead!();
  await staleResponse;
  await expect(page.getByRole("button", { name: "Enviar pagamento ao Inter", exact: true })).toBeDisabled();
  await refresh.click();
  await expect(page.getByRole("button", { name: "Enviar pagamento ao Inter", exact: true })).toBeDisabled();
  await expect(confirm).toHaveCount(0);
  expect(submitted).toBe(1);
});
