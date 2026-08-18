import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinancialDescription,
  canonicalFinancialUnit,
  displayFinancialMonth,
} from "../../src/features/financial/lib/expense-description-catalog";

test("normaliza competência e nomes operacionais de unidade", () => {
  assert.equal(displayFinancialMonth("2026-08-01"), "08/2026");
  assert.equal(canonicalFinancialUnit("Quiosque João Paulo"), "João Paulo");
  assert.equal(canonicalFinancialUnit("Centro administrativo - Renascença"), "Administrativo");
});

test("monta os padrões financeiros aprovados", () => {
  assert.equal(
    buildFinancialDescription("internet", { unit: "Quiosque Tirirical", beneficiary: "TVN" }),
    "Internet - Tirirical | TVN",
  );
  assert.equal(
    buildFinancialDescription("salary", { month: "2026-07", employee: "Aliny Rodrigues" }),
    "Salário - 07/2026 | Aliny Rodrigues",
  );
  assert.equal(
    buildFinancialDescription("fgts", { month: "2026-08", hasPayrollLoan: true }),
    "FGTS - 08/2026 | FGTS + empréstimo consignado",
  );
  assert.equal(
    buildFinancialDescription("inss", { month: "2026-08" }),
    "INSS - 08/2026 | Folha de pagamento",
  );
  assert.equal(
    buildFinancialDescription("shopping_cart"),
    "Compra do carrinho - Shopping do Automóvel",
  );
});
