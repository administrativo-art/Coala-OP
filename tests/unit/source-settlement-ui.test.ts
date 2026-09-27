import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("classification complements both existing counting entries without another counting workflow", async () => {
  for (const path of ["cash-closures/components/cash-closure-day-page.tsx", "cash-counting-sessions/components/cash-counting-dialog.tsx"]) {
    const code = await readFile(`src/features/financial/${path}`, "utf8");
    assert.match(code, /<CashWithdrawalsPanel/);
  }
  const panel = await readFile("src/features/financial/cash-closures/components/cash-withdrawals-panel.tsx", "utf8");
  assert.match(panel, /useAuthenticatedApi/);
  assert.match(panel, /AccountPlanTreeSelect/);
  assert.match(panel, /limit\(501\)/);
  assert.match(panel, /limit\(51\)/);
  assert.match(panel, /Confirmar desvinculação/);
  assert.doesNotMatch(panel, /setInterval|onSnapshot/);
});

test("source-settled expense has origin evidence and does not offer a misleading bank-payment editor", async () => {
  const summary = await readFile("src/features/financial/components/expenses/expense-financial-summary.tsx", "utf8");
  assert.match(summary, /if \(expense\.sourceSettlement\) return <SourceSettlementNotice/);
  const form = await readFile("src/features/financial/components/expenses/expense-form.tsx", "utf8");
  assert.match(form, /if \(editId && sourceSettlement\) return <SourceSettlementNotice/);
  const page = await readFile("src/features/financial/pages/expenses-page.tsx", "utf8");
  for (const action of ["canPay", "canDelete", "canEdit"]) {
    assert.match(page, new RegExp(`${action}=\\{[^\\n]+!expense.sourceSettlement`));
  }
});
