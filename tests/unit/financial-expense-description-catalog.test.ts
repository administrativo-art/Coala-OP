import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFinancialDescription,
  canonicalFinancialUnit,
  displayFinancialDate,
  displayFinancialMonth,
  identifyCardStatementFinancialCharge,
  resolveCardStatementFinancialCharge,
} from "../../src/features/financial/lib/expense-description-catalog";

test("normaliza competência e nomes operacionais de unidade", () => {
  assert.equal(displayFinancialMonth("2026-08-01"), "08/2026");
  assert.equal(displayFinancialDate("2026-08-14"), "14/08/2026");
  assert.equal(canonicalFinancialUnit("Quiosque João Paulo"), "João Paulo");
  assert.equal(canonicalFinancialUnit("Centro administrativo - Renascença"), "Administrativo");
});

test("monta os padrões financeiros aprovados", () => {
  assert.equal(
    buildFinancialDescription("internet", { unit: "Quiosque Tirirical", beneficiary: "TVN" }),
    "Internet - Tirirical | TVN",
  );
  assert.equal(
    buildFinancialDescription("mobile_phone_bill", { competence: "2026-09", beneficiary: "Vivo" }),
    "Conta de celular - 09/2026 | Vivo",
  );
  assert.equal(
    buildFinancialDescription("salary", { competence: "2026-07", employee: "Aliny Rodrigues" }),
    "Salário - 07/2026 | Aliny Rodrigues",
  );
  assert.equal(
    buildFinancialDescription("salary_advance", { competence: "2026-09", employee: "Samila Silva" }),
    "Adiantamento salarial - 09/2026 | Samila Silva",
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
  assert.equal(
    buildFinancialDescription("ride_hailing", {
      transactionDate: "2026-08-14",
      beneficiary: "Uber",
      passenger: "Heucilene Ribeiro",
    }),
    "Corrida por aplicativo - 14/08/2026 | Uber - Heucilene Ribeiro",
  );
});

test("identifica e padroniza encargos financeiros importados da fatura", () => {
  const cases = [
    ["ENCARGOS ROTATIVO", "card_revolving_charge", "Encargos do crédito rotativo - 08/2026 | Banco Inter", "Juros e multas"],
    ["ROTATIVO SALDO FINANCIA", "card_financed_balance_charge", "Encargos do saldo financiado - 08/2026 | Banco Inter", "Juros e multas"],
    ["IOF", "card_iof", "IOF do cartão - 08/2026 | Banco Inter", "IOF | tarifas bancárias"],
    ["JUROS DE MORA", "card_late_interest", "Juros de mora do cartão - 08/2026 | Banco Inter", "Juros e multas"],
    ["MULTA POR ATRASO", "card_late_fee", "Multa por atraso do cartão - 08/2026 | Banco Inter", "Juros e multas"],
  ] as const;

  for (const [rawDescription, kind, description, accountPlanName] of cases) {
    assert.equal(identifyCardStatementFinancialCharge(rawDescription), kind);
    assert.deepEqual(resolveCardStatementFinancialCharge({
      rawDescription,
      competence: "2026-08",
      financialInstitution: "BANCO INTER",
    }), {
      kind,
      description,
      supplier: "Banco Inter",
      rawBankDescription: rawDescription,
      accountPlanName,
    });
  }

  assert.equal(identifyCardStatementFinancialCharge("DL*UberRides"), null);
});
