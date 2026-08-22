import assert from "node:assert/strict";
import test from "node:test";

import {
  consultExpenseProvision,
  expenseProvisionIdentity,
  inferExpenseProvisionSeriesKey,
} from "../../src/features/financial/lib/expense-provisions";

test("infere séries recorrentes pela descrição canônica", () => {
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "Internet - João Paulo | TVN" }),
    "recurring:internet:joao-paulo:tvn",
  );
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "Honorário contábil - Administrativo | Maximus" }),
    "recurring:honorario-contabil:administrativo:maximus",
  );
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "GPT/Codex | Tiago Brasil" }),
    "recurring:gpt-codex:tiago-brasil",
  );
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "Publicidade digital - Signage | Wiplay" }),
    "recurring:publicidade-digital:signage:wiplay",
  );
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "Sistema PDV - Shopping do Automóvel | PDV Legal" }),
    "recurring:sistema-pdv:shopping-do-automovel:pdv-legal",
  );
  assert.equal(
    inferExpenseProvisionSeriesKey({ description: "Implantação do Sistema PDV - Shopping do Automóvel | PDV Legal" }),
    "one-time:implantacao-sistema-pdv:shopping-do-automovel:pdv-legal",
  );
});

test("distingue a mesma mensalidade de PDV por unidade", () => {
  const tirirical = {
    id: "forecast-tirirical",
    description: "Sistema PDV - Tirirical | PDV Legal",
    provisionType: "forecast",
    provisionCompetence: "2026-08",
    status: "provisioned",
    totalValue: 189.47,
  };
  const joaoPaulo = {
    id: "forecast-joao-paulo",
    description: "Sistema PDV - João Paulo | PDV Legal",
    provisionType: "forecast",
    provisionCompetence: "2026-08",
    status: "provisioned",
    totalValue: 189.47,
  };

  const consultation = consultExpenseProvision({
    id: "actual-tirirical",
    description: "Sistema PDV - Tirirical | PDV Legal",
    provisionType: "actual",
    provisionCompetence: "2026-08",
    totalValue: 189.47,
  }, [tirirical, joaoPaulo]);

  assert.equal(consultation.status, "matched");
  if (consultation.status === "matched") assert.equal(consultation.provision.id, "forecast-tirirical");
});

test("atribui identidade real e competência ao documento canônico", () => {
  assert.deepEqual(expenseProvisionIdentity({
    description: "Sistema RH - Bizneo",
    competenceDate: new Date("2026-09-01T12:00:00-03:00"),
  }), {
    provisionSeriesKey: "recurring:sistema-rh:bizneo",
    provisionType: "actual",
    provisionCompetence: "2026-09",
  });
});

test("identifica a série da provisão salarial pelo colaborador individualizado", () => {
  assert.deepEqual(expenseProvisionIdentity({
    description: "Salário - 08/2026 | Heucilene Oliveira Ribeiro",
    competenceDate: new Date("2026-08-01T12:00:00-03:00"),
    personAllocations: [
      { employeeId: "employee-heucilene" },
      { employeeId: "employee-heucilene" },
    ],
  }), {
    provisionSeriesKey: "payroll-salary:employee-heucilene",
    provisionType: "actual",
    provisionCompetence: "2026-08",
  });
});

test("concilia previsão e real pela mesma série e competência", () => {
  const forecast = {
    id: "forecast",
    description: "Aluguel - Tirirical | Mateus Supermercados",
    provisionSeriesKey: "recurring:aluguel:tirirical:mateus-supermercados",
    provisionType: "forecast",
    provisionCompetence: "2026-09",
    status: "provisioned",
    totalValue: 1479.33,
  };
  assert.deepEqual(consultExpenseProvision({
    id: "actual",
    description: "Aluguel - Tirirical | Mateus Supermercados",
    provisionType: "actual",
    provisionCompetence: "2026-09",
    totalValue: 1500,
  }, [forecast]), {
    status: "matched",
    competence: "2026-09",
    seriesKey: "recurring:aluguel:tirirical:mateus-supermercados",
    provision: forecast,
    actualValue: 1500,
    provisionedValue: 1479.33,
    variance: 20.67,
  });
});
