// The Functions package is deployed independently. Keeping the dependency-free
// contract there lets both TypeScript projects use the exact same implementation.
export * from "../../../../functions/src/cash-closure-dre";

import { isCents, type PdvSalesSource } from "../../../../functions/src/cash-closure-dre";
import type { CashClosureLine } from "./types";

/** Only explicit source evidence can recover a legacy line, never adjusted expected. */
export function linePdvSalesSource(line: CashClosureLine): PdvSalesSource {
  if (line.pdvSales) return line.pdvSales;
  if (line.channel === "cash") {
    const { grossCashCents, changeCents, supplyCents, withdrawalCents } = line.metadata ?? {};
    if (isCents(grossCashCents) && isCents(changeCents)
      && isCents(supplyCents) && isCents(withdrawalCents)
      && isCents(line.calculatedExpectedCents)
      && grossCashCents - changeCents + supplyCents - withdrawalCents === line.calculatedExpectedCents) {
      return { version: 1, amountCents: grossCashCents - changeCents };
    }
  } else if (isCents(line.calculatedExpectedCents) && isCents(line.metadata?.paymentRowCount)
    && line.metadata.paymentRowCount > 0) {
    return { version: 1, amountCents: line.calculatedExpectedCents };
  }
  return { version: 1, amountCents: null };
}
