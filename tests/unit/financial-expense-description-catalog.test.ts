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
    buildFinancialDescription("salary", { competence: "2026-07", employee: "Aliny Rodrigues" }),
    "Salário - 07/2026 | Aliny Rodrigues",
  );
  assert.equal(
    buildFinancialDescription("das", { competence: "2026-07" }),
    "DAS - Única - 07/2026",
  );
  assert.equal(
    buildFinancialDescription("fgts", { competence: "2026-07", hasPayrollLoan: true }),
    "FGTS - 07/2026 | FGTS + empréstimo consignado",
  );
  assert.equal(
    buildFinancialDescription("inss", { competence: "2026-07" }),
    "INSS - 07/2026 | Folha de pagamento",
  );
  assert.equal(
    buildFinancialDescription("shopping_cart"),
    "Compra do carrinho - Shopping do Automóvel",
  );
  assert.equal(
    buildFinancialDescription("pdv_system", { unit: "Quiosque Tirirical", beneficiary: "PDV Legal" }),
    "Sistema PDV - Tirirical | PDV Legal",
  );
  assert.equal(
    buildFinancialDescription("digital_signage", { beneficiary: "Wiplay" }),
    "Publicidade digital - Signage | Wiplay",
  );
  assert.equal(
    buildFinancialDescription("pdv_implementation", { unit: "Shopping do Automóvel", beneficiary: "PDV Legal" }),
    "Implantação do Sistema PDV - Shopping do Automóvel | PDV Legal",
  );
});
