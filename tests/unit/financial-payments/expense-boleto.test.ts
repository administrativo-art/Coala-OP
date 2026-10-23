import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { expenseBoletoSchema, validateExpenseBoleto, assertExpenseBoletoTarget, expenseBoletoAttachmentId } from "../../../src/features/financial/payment-requests/expense-boleto";
import { boletoFixture } from "../../helpers/boleto-fixture";
const input = expenseBoletoSchema.parse({ barcode: boletoFixture(), amountCents: 300000, dueDate: "2026-10-10", competenceMonth: "2026-09", beneficiaryDocument: "11222333000181", documentReference: "TEST-1", confirmed: true });
const expense = { workspaceId: "coala", status: "provisioned", paymentMethod: "single", installments: [{ number: 1, status: "provisioned" }], totalValue: 3000, dueDate: new Date("2026-10-10T15:00:00Z"), competenceMonth: "2026-09" };
test("boleto direto valida código, valor, vencimento e competência distinta", () => {
  validateExpenseBoleto(input); assertExpenseBoletoTarget(expense, input, "coala");
});
test("recusa divergência em dígito, valor ou fator de vencimento", () => {
  for (const patch of [{ barcode: input.barcode.slice(0, 9) + "8" + input.barcode.slice(10) }, { amountCents: 300001 }, { dueDate: "2026-10-11" }]) assert.throws(() => validateExpenseBoleto({ ...input, ...patch }));
  assert.equal(expenseBoletoSchema.safeParse({ ...input, beneficiaryDocument: "00000000000000" }).success, false);
  assert.equal(expenseBoletoSchema.safeParse({ ...input, confirmed: false }).success, false);
  assert.equal(expenseBoletoSchema.safeParse({ ...input, dueDate: "2026-02-31" }).success, false);
});
test("não prepara despesa paga, outro workspace, parcela, vencimento ou competência divergente", () => {
  for (const patch of [{ status: "paid" }, { paymentState: "paid" }, { workspaceId: "other" }, { paymentMethod: "installments" }, { totalValue: 3001 }, { competenceMonth: "2026-10" }, { dueDate: new Date("2026-10-11") }, { financialInboxMessageId: "inbox" }, { installments: [{ status: "paid" }] }, { documentIdentity: { barcode: "other" } }]) assert.throws(() => assertExpenseBoletoTarget({ ...expense, ...patch }, input, "coala"));
});
test("valida e isola boleto por parcela da despesa", () => {
  const installmentInput = expenseBoletoSchema.parse({
    installmentNumber: 2,
    barcode: boletoFixture("2026-11-20", 111452),
    amountCents: 111452,
    dueDate: "2026-11-20",
    competenceMonth: "2026-10",
    beneficiaryDocument: "11222333000181",
    documentReference: "NF-22930-02",
    confirmed: true,
  });
  const installmentExpense = {
    workspaceId: "coala", status: "pending", paymentMethod: "installments", totalValue: 3343.56,
    competenceMonth: "2026-10", dueDate: new Date("2026-11-13T15:00:00Z"),
    installments: [
      { number: 1, value: 1114.52, dueDate: new Date("2026-11-13T15:00:00Z"), status: "pending" },
      { number: 2, value: 1114.52, dueDate: new Date("2026-11-20T15:00:00Z"), status: "pending" },
      { number: 3, value: 1114.52, dueDate: new Date("2026-11-27T15:00:00Z"), status: "pending" },
    ],
  };
  assertExpenseBoletoTarget(installmentExpense, installmentInput, "coala");
  assert.equal(expenseBoletoAttachmentId("expense_1", 2), "expense_1_installment_2");
  assert.throws(() => assertExpenseBoletoTarget(installmentExpense, { ...installmentInput, installmentNumber: 1 }, "coala"));
  assert.doesNotThrow(() => assertExpenseBoletoTarget({ ...installmentExpense, installments: installmentExpense.installments.map(item => item.number === 2 ? { ...item, paymentRequestId: "request_2" } : item) }, installmentInput, "coala"));
});
test("fluxo direto persiste documento privado, verifica fonte antes do envio e não inventa e-mail", () => {
  const service = readFileSync("src/features/financial/payment-requests/service.server.ts", "utf8");
  const attachment = readFileSync("src/features/financial/payment-requests/expense-boleto.server.ts", "utf8");
  assert.match(service, /current\.interRequestId \|\| \(current\.submissionStartedAt && !retryingDefinitiveRejection\)/);
  assert.match(service, /if \(pending\.sourceType === "financial_inbox"\) transaction\.set\(messageRef/);
  assert.match(service, /assertExpenseBoletoTarget\(data, input, WORKSPACE_ID\)/);
  assert.match(service, /request\.sourceType === "expense_boleto" && request\.installmentNumber != null/);
  assert.match(attachment, /tx\.create\(attachmentRef, attachment\)/);
  assert.match(attachment, /tx\.create\(requestRef/);
  assert.match(attachment, /tx\.update\(expenseRef/);
});
