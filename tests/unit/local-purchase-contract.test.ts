import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { confirmLocalPurchaseSchema, localPurchaseExpenseId } from "../../src/features/purchasing/local-purchase";
import { mobilePurchaseExtractionPrompt } from "../../src/ai/prompts/financial/mobile-purchase-extraction";
import { localPurchaseWithdrawalDates, LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS } from "../../src/features/purchasing/local-purchase-withdrawals";
import { assertEligibleWithdrawalExpense, changeReturnIsProven, preLinkedChangeCents, withdrawalSourceId, withdrawalSources, type WithdrawalSource } from "../../src/features/financial/cash-closures/withdrawal-classification";
import type { CashClosure, CashClosureLine } from "../../src/features/financial/cash-closures/types";

const valid = {
  submissionId: "d033b3e8-dbc4-4c34-8cb7-0cdb5f61293e",
  unitId: "unit-a",
  supplierName: "Mercado Central",
  supplierTaxId: "12345678000199",
  purchaseDate: "2026-10-10",
  totalCents: 1200,
  fundingSource: "cash_withdrawal" as const,
  companyPaymentMethod: null,
  accountPlanId: "account-a",
  resultCenterId: "center-a",
  items: [{ description: "Limão", quantity: 2, unit: "un", unitPriceCents: 600, totalCents: 1200, baseItemId: null }],
};

test("local purchase confirmation requires exact item total and sangria classification", () => {
  assert.equal(confirmLocalPurchaseSchema.safeParse(valid).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, totalCents: 1300 }).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, accountPlanId: null }).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, fundingSource: "company_payment", companyPaymentMethod: "card_credit" }).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, fundingSource: "company_payment", companyPaymentMethod: null }).success, false);
});

test("local purchase identity is deterministic and workspace-bound", () => {
  const first = localPurchaseExpenseId("coala", valid.submissionId);
  assert.equal(first, localPurchaseExpenseId("coala", valid.submissionId));
  assert.notEqual(first, localPurchaseExpenseId("other", valid.submissionId));
});

test("a local purchase only matches a withdrawal from the same unit, day and exact amount", () => {
  const source = {
    workspaceId: "coala", unitId: "unit-a", competenceMonth: "2026-10", settledOn: "2026-10-10", amountCents: 1200,
  } as WithdrawalSource;
  const expense = {
    workspaceId: "coala", kioskId: "unit-a", competenceMonth: "2026-10", totalValue: 12,
    status: "pending", paymentState: "open", paymentMethod: "single", plannedPaymentMethodType: "cash",
    originModule: "local_purchase", localPurchaseDate: "2026-10-10", localPurchaseFundingSource: "cash_withdrawal",
  };
  assert.doesNotThrow(() => assertEligibleWithdrawalExpense(expense, source));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, localPurchaseDate: "2026-10-11" }, source));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, totalValue: 13 }, source));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, kioskId: "unit-b" }, source));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, localPurchaseFundingSource: "company_payment" }, source));
});

test("confirmation route declares authenticated permission, unit scope and replay protection", () => {
  const route = readFileSync("src/app/api/purchasing/local-purchases/confirm/route.ts", "utf8");
  assert.match(route, /action: "app\.localPurchase\.register"/);
  assert.match(route, /resourceScope: \{ kind: "unit" \}/);
  assert.match(route, /additionalGuarantees: \["replay-protected"\]/);
  assert.match(route, /export const POST = secureRoute/);
});

test("confirmation binds the purchase to the uploaded funding source and payment proof", () => {
  const server = readFileSync("src/features/purchasing/local-purchase.server.ts", "utf8");
  assert.match(server, /mobilePurchaseFundingSource/);
  assert.match(server, /FUNDING_SOURCE_MISMATCH/);
  assert.match(server, /PAYMENT_PROOF_REQUIRED/);
  assert.match(server, /PAYMENT_PROOF_UNEXPECTED/);
});

test("a chosen sangria is only accepted for cash purchases and with a well-formed identity", () => {
  const withdrawal = { sourceId: "a".repeat(64), date: "2026-10-09" };
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, withdrawal }).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, withdrawal: null }).success, true);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, withdrawal: { ...withdrawal, sourceId: "abc" } }).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, withdrawal: { ...withdrawal, amountCents: 1 } }).success, false);
  assert.equal(confirmLocalPurchaseSchema.safeParse({ ...valid, fundingSource: "company_payment", companyPaymentMethod: "pix", withdrawal }).success, false);
});

test("the sangria list honours the cutoff date and never exceeds the day limit", () => {
  assert.deepEqual(localPurchaseWithdrawalDates("2026-10-09", "2026-10-07"), ["2026-10-09", "2026-10-08", "2026-10-07"]);
  assert.deepEqual(localPurchaseWithdrawalDates("2026-10-09", "2026-10-10"), []);
  assert.deepEqual(localPurchaseWithdrawalDates("2026-03-01", "2026-02-28"), ["2026-03-01", "2026-02-28"]);
  const unbounded = localPurchaseWithdrawalDates("2026-10-09", null);
  assert.equal(unbounded.length, LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS);
  assert.equal(localPurchaseWithdrawalDates("2026-10-09", "invalid").length, LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS);
  assert.equal(localPurchaseWithdrawalDates("2026-10-09", "2020-01-01").length, LOCAL_PURCHASE_WITHDRAWAL_MAX_DAYS);
});

test("the app list and the cash closure derive the same sangria identity", () => {
  const closure = { id: "closure-a", workspaceId: "coala", kioskId: "unit-a", pdvFilialId: "17343", date: "2026-10-09", source: {} } as CashClosure;
  const movement = { id: "9001", identitySource: "provider", kind: "withdrawal", amountCents: 5000, occurredAt: "2026-10-09T10:42:00", date: "2026-10-09",
    operatorId: "op-1", terminalId: null, paymentMethodId: "1", paymentMethodName: "Dinheiro", isCash: true, cancelled: false };
  const line = { id: "line-a", channel: "cash", operatorId: "op-1", metadata: { withdrawalCents: 5000, cashMovements: [movement] } } as unknown as CashClosureLine;
  const result = withdrawalSources(closure, [line]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.sources[0]?.sourceId, withdrawalSourceId({ workspaceId: "coala", unitId: "unit-a", pdvFilialId: "17343" }, "9001"));
  assert.notEqual(result.sources[0]?.sourceId, withdrawalSourceId({ workspaceId: "coala", unitId: "unit-b", pdvFilialId: "17343" }, "9001"));
});

test("a purchase pre-linked in the app only settles its own sangria, even on another day", () => {
  const source = {
    sourceId: "a".repeat(64), workspaceId: "coala", unitId: "unit-a", competenceMonth: "2026-10", settledOn: "2026-10-09", amountCents: 1200,
  } as WithdrawalSource;
  const expense = {
    workspaceId: "coala", kioskId: "unit-a", competenceMonth: "2026-10", totalValue: 12,
    status: "pending", paymentState: "open", paymentMethod: "single", plannedPaymentMethodType: "cash",
    originModule: "local_purchase", localPurchaseDate: "2026-10-10", localPurchaseFundingSource: "cash_withdrawal",
    localPurchaseWithdrawalSourceId: source.sourceId,
  };
  assert.doesNotThrow(() => assertEligibleWithdrawalExpense(expense, source));
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, localPurchaseWithdrawalSourceId: "b".repeat(64) }, source), /pré-vinculada/);
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, totalValue: 10 }, source));
});

test("pre-linking revalidates the sangria in the PDV and allows one purchase per sangria", () => {
  const server = readFileSync("src/features/purchasing/local-purchase.server.ts", "utf8");
  assert.match(server, /resolveLocalPurchaseWithdrawal/);
  assert.match(server, /WITHDRAWAL_AMOUNT_EXCEEDED/);
  assert.match(server, /WITHDRAWAL_ALREADY_LINKED/);
  assert.match(server, /transaction\.create\(withdrawalLinkRef/);
  const route = readFileSync("src/app/api/purchasing/local-purchases/withdrawals/route.ts", "utf8");
  assert.match(route, /action: "app\.localPurchase\.register"/);
  assert.match(route, /export const GET = secureRoute/);
});

test("the AI may only suggest a category from the accounts offered, and never decides it", () => {
  const rendered = mobilePurchaseExtractionPrompt.render({ fundingSource: "cash_withdrawal", accounts: [{ id: "acc-clean", name: "Material de limpeza" }] });
  assert.match(rendered, /acc-clean — Material de limpeza/);
  assert.match(rendered, /não há frete/);
  assert.match(rendered, /apenas uma sugestão/);
  assert.match(mobilePurchaseExtractionPrompt.render({ fundingSource: "cash_withdrawal" }), /nenhuma categoria disponível/);
  const extraction = readFileSync("src/features/financial/inbox/mobile-purchase-extraction.server.ts", "utf8");
  assert.match(extraction, /accounts\.find\(\(account\) => account\.id === raw\.suggestedAccountId\)\?\.id \?\? null/);
  const context = readFileSync("src/app/api/purchasing/local-purchases/context/route.ts", "utf8");
  assert.match(context, /listLocalPurchaseAccounts\(\)/);
});

test("a pre-linked purchase smaller than the sangria settles only with the change returned as a supply", () => {
  const source = {
    sourceId: "a".repeat(64), workspaceId: "coala", unitId: "unit-a", competenceMonth: "2026-10", settledOn: "2026-10-09", amountCents: 5000,
  } as WithdrawalSource;
  const expense = {
    workspaceId: "coala", kioskId: "unit-a", competenceMonth: "2026-10", totalValue: 40,
    status: "pending", paymentState: "open", paymentMethod: "single", plannedPaymentMethodType: "cash",
    originModule: "local_purchase", localPurchaseDate: "2026-10-09", localPurchaseFundingSource: "cash_withdrawal",
    localPurchaseWithdrawalSourceId: source.sourceId,
  };
  assert.equal(preLinkedChangeCents(expense, source), 1000);
  assert.equal(preLinkedChangeCents({ ...expense, totalValue: 50 }, source), 0);
  assert.equal(preLinkedChangeCents({ ...expense, totalValue: 60 }, source), 0);
  assert.equal(preLinkedChangeCents({ ...expense, localPurchaseWithdrawalSourceId: undefined }, source), 0);
  assert.equal(preLinkedChangeCents({ ...expense, originModule: "manual" }, source), 0);
  assert.throws(() => assertEligibleWithdrawalExpense(expense, source));
  assert.doesNotThrow(() => assertEligibleWithdrawalExpense(expense, source, undefined, 1000));
  assert.throws(() => assertEligibleWithdrawalExpense(expense, source, undefined, 500));
  // A manual expense can never borrow the change rule to close a sangria of another amount.
  assert.throws(() => assertEligibleWithdrawalExpense({ ...expense, originModule: "manual", localPurchaseWithdrawalSourceId: undefined }, source, undefined, 1000));
});

test("returned change is proven per day and amount, one supply per accepted change", () => {
  const supply = (amountCents: number, extra: Record<string, unknown> = {}) => ({ kind: "supply", amountCents, date: "2026-10-09", cancelled: false, ...extra });
  const lines = [{ metadata: { cashMovements: [supply(1000), supply(1000), supply(700, { cancelled: true }), supply(300, { date: "2026-10-10" }), { ...supply(1000), kind: "withdrawal" }] } },
    { metadata: {} }] as unknown as CashClosureLine[];
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 1000, 0), true);
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 1000, 1), true);
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 1000, 2), false);
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 700, 0), false);
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 300, 0), false);
  assert.equal(changeReturnIsProven(lines, "2026-10-09", 999, 0), false);
});

test("automatic reconciliation can only confirm the link the operator made in the app", () => {
  const server = readFileSync("src/features/financial/cash-closures/withdrawal-classification.server.ts", "utf8");
  assert.match(server, /if \(action !== "link"\) withdrawalFailure\("FORBIDDEN"/);
  assert.match(server, /authorization === "app-pre-link" && oldExpense\.localPurchaseWithdrawalSourceId !== source\.sourceId/);
  assert.match(server, /CHANGE_NOT_RETURNED/);
  assert.match(server, /withdrawal_expense_linked_by_app/);
  assert.match(server, /sourceSettlementSummary\(source\.amountCents - changeReturnedCents\)/);
  assert.match(readFileSync("src/features/financial/cash-closures/service.server.ts", "utf8"), /autoLinkAppPreLinks\(result\.closure\.id, input\.context\)/);
  const purchase = readFileSync("src/features/purchasing/local-purchase.server.ts", "utf8");
  assert.match(purchase, /autoLinkAppPreLinks\(cashClosureId\(unitId, withdrawalDate\), actor\)/);
  assert.match(purchase, /LINK_UNAVAILABLE/);
  assert.match(readFileSync("src/app/api/purchasing/local-purchases/link-withdrawal/route.ts", "utf8"), /action: "app\.localPurchase\.register"/);
});
