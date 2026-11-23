import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { E2E_USER } from "../support/global-setup";
import { assertFirestoreEmulatorSafety } from "../../helpers/firestore-emulator-safety.mjs";

test("despesa real prepara Pix separado da baixa manual e mostra erro seguro", async ({ page }) => {
  test.setTimeout(420_000);
  assertFirestoreEmulatorSafety({ projectId: "demo-coala-e2e" });
  const app = getApps().find((item) => item.name === "expense-supplier-pix-ui-e2e")
    ?? initializeApp({ projectId: "demo-coala-e2e" }, "expense-supplier-pix-ui-e2e");
  const db = getFirestore(app, "coala-financeiro");
  const financialUser = db.collection("users").doc(E2E_USER.uid);
  const previousFinancialUser = await financialUser.get();
  const expense = db.collection("expenses").doc("expense-supplier-pix-ui-e2e");
  const account = db.collection("accounts").doc("pix-ui-account-e2e");
  const now = new Date();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate() + 1, 27), 12);
  const competence = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  let calls = 0;
  try {
    await financialUser.set({ active: true, permissions: { view: true, expenses: { view: true, edit: true, create: true, pay: true } } });
    await account.set({ name: "Serviços E2E", active: true, isGroup: false, group: "administrativo" });
    await expense.set({
      workspaceId: "coala", description: "Serviço Pix de teste E2E", supplier: "Pessoa fictícia E2E",
      supplierId: "pix-ui-entity-e2e", billingIdentity: { supplierTaxId: "52998224725" },
      unitId: "loja-e2e", accountPlan: "pix-ui-account-e2e", referenceResultCenterId: "loja-e2e",
      competenceDate: Timestamp.fromDate(competence), dueDate: Timestamp.fromDate(due),
      status: "pending", provisionType: "actual", paymentMethod: "single", totalValue: 50,
      installments: [{ number: 1, dueDate: Timestamp.fromDate(due), value: 50, status: "pending" }],
      createdAt: Timestamp.now(),
    });
    await page.route(`**/api/financial/expenses/${expense.id}/supplier-pix`, async (route) => {
      calls += 1;
      expect(route.request().postDataJSON()).toEqual({ supplierEntityId: "pix-ui-entity-e2e", amountCents: 5000 });
      await route.fulfill(calls === 1
        ? { status: 409, contentType: "application/json", body: JSON.stringify({ error: "Revise o perfil Pix do favorecido." }) }
        : { status: 200, contentType: "application/json", body: JSON.stringify({ request: { id: "demo-request", status: "awaiting_financial_authorization" } }) });
    });
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(E2E_USER.email);
    await page.getByLabel("Senha").fill(E2E_USER.password);
    await page.getByRole("button", { name: "Entrar no sistema" }).click();
    await expect(page.getByRole("button", { name: "Entrar no sistema" })).toBeHidden();
    await page.goto(`/dashboard/financial/expenses?expense=${expense.id}&competence=all`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Solicitar Pix de R$ 50,00" })).toBeVisible();
    await expect(dialog.getByText("A data acima vale apenas para a baixa manual", { exact: false })).toBeVisible();
    await dialog.screenshot({ path: ".ai-work/development-technology/2026-11-23-pix-chaves/pay-expense-pix-e2e.png" });
    await dialog.getByRole("spinbutton", { name: "Juros" }).fill("1");
    await expect(dialog.getByRole("button", { name: "Solicitar Pix de R$ 50,00" })).toBeDisabled();
    await dialog.getByRole("spinbutton", { name: "Juros" }).fill("0");
    await dialog.getByRole("button", { name: "Solicitar Pix de R$ 50,00" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Revise o perfil Pix");
    await dialog.getByRole("button", { name: "Solicitar Pix de R$ 50,00" }).click();
    await expect(page.getByRole("button", { name: "Solicitar Pix de R$ 50,00" })).toBeHidden();
    expect(calls).toBe(2);
    expect((await expense.get()).get("status")).toBe("pending");
    await page.goto(`/dashboard/financial/expenses/new?edit=${expense.id}`);
    await expect(page.locator('[data-supplier-id="pix-ui-entity-e2e"]')).toBeVisible({ timeout: 60_000 });
    await page.locator('button[role="combobox"]').filter({ hasText: "Pessoa fictícia E2E" }).click();
    await page.getByPlaceholder("Buscar ou digitar...").fill("Fornecedor em texto livre");
    await expect(page.getByText("Texto livre não vincula um cadastro", { exact: false })).toBeVisible();
    await page.getByRole("navigation", { name: "Etapas do cadastro" }).getByRole("button", { name: /Revisão/ }).click();
    await page.getByRole("button", { name: "Atualizar despesa" }).click();
    await expect.poll(async () => (await expense.get()).get("supplierId")).toBeNull();
    const saved = (await expense.get()).data()!;
    expect(saved.billingIdentity.supplierTaxId).toBeNull();
    expect(saved.unitId).toBe("loja-e2e");
    expect(saved.supplier).toBe("Fornecedor em texto livre");

    await expense.update({
      supplierId: "pix-ui-entity-e2e", billingIdentity: { supplierTaxId: "52998224725" },
      netPayableValue: 45,
    });
    await page.goto(`/dashboard/financial/expenses?expense=${expense.id}&competence=all`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(page.getByRole("dialog").getByText("Pix indisponível: o valor líquido", { exact: false })).toContainText("R$ 45,00");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Solicitar Pix de R$ 50,00" })).toHaveCount(0);
    expect(calls).toBe(2);
    expect((await expense.get()).get("status")).toBe("pending");

    await expense.update({ netPayableValue: 50, paymentRequestId: "active-request-e2e" });
    await page.goto(`/dashboard/financial/expenses?expense=${expense.id}&competence=all`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const linkedDialog = page.getByRole("dialog");
    await linkedDialog.getByRole("spinbutton", { name: "Valor" }).fill("50");
    await expect(linkedDialog.getByRole("button", { name: "Confirmar pagamento manual" })).toBeDisabled();
    await expect(linkedDialog.getByText("Esta despesa tem uma solicitação bancária vinculada", { exact: false })).toBeVisible();
    await expect(linkedDialog.getByRole("button", { name: "Solicitar Pix de R$ 50,00" })).toHaveCount(0);
    await linkedDialog.screenshot({ path: ".ai-work/development-technology/2026-11-23-pix-chaves/pay-expense-pix-linked-e2e.png" });
    expect((await expense.get()).get("status")).toBe("pending");

    await expense.update({
      paymentRequestId: FieldValue.delete(), netPayableValue: FieldValue.delete(),
      originModule: "financial_inbox", financialInboxMessageId: "synthetic-inbox-e2e",
      supplierId: "canonical-inbox-entity", billingIdentity: { supplierTaxId: null },
    });
    await page.goto(`/dashboard/financial/expenses/new?edit=${expense.id}`);
    await expect(page.getByText("Fornecedor e documento fiscal mantidos conforme a origem", { exact: false })).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('button[role="combobox"]').filter({ hasText: "Fornecedor em texto livre" })).toBeDisabled();
    await page.getByRole("navigation", { name: "Etapas do cadastro" }).getByRole("button", { name: /Revisão/ }).click();
    await page.getByRole("button", { name: "Atualizar despesa" }).click();
    await expect(page.getByText("Despesa atualizada.")).toBeVisible();
    const protectedSaved = (await expense.get()).data()!;
    expect(protectedSaved.supplierId).toBe("canonical-inbox-entity");
    expect(protectedSaved.billingIdentity.supplierTaxId).toBeNull();

    await expense.update({
      financialInboxMessageId: FieldValue.delete(), originModule: "generated_receipt",
      generatedReceiptId: "synthetic-receipt-e2e",
      beneficiaryReference: { sourceType: "entity", sourceId: "canonical-inbox-entity" },
      netPayableValue: 45,
    });
    await page.goto(`/dashboard/financial/expenses?expense=${expense.id}&competence=all`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const legacyDialog = page.getByRole("dialog");
    await expect(legacyDialog.getByRole("button", { name: "Solicitar Pix via Banco Inter" })).toBeDisabled();
    await expect(legacyDialog.getByText("Pix indisponível: o valor líquido", { exact: false })).toContainText("R$ 45,00");
    await expense.update({ netPayableValue: 50 });
    await page.goto(`/dashboard/financial/expenses?expense=${expense.id}&competence=all`);
    await page.getByRole("button", { name: "Registrar pagamento" }).click();
    const legacyEqualDialog = page.getByRole("dialog");
    await expect(legacyEqualDialog.getByRole("button", { name: "Solicitar Pix via Banco Inter" })).toBeEnabled();
    await legacyEqualDialog.getByRole("spinbutton", { name: "Juros" }).fill("1");
    await expect(legacyEqualDialog.getByRole("button", { name: "Solicitar Pix via Banco Inter" })).toBeDisabled();
  } finally {
    await Promise.all([expense.delete(), account.delete()]);
    if (previousFinancialUser.exists) await financialUser.set(previousFinancialUser.data()!);
    else await financialUser.delete();
  }
});
