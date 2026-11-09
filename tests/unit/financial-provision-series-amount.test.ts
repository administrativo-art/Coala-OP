import assert from "node:assert/strict";
import test from "node:test";

import { selectProvisionSeriesAmountTarget } from "@/features/financial/provision-series-amount";

const selection = {
  workspaceId: "coala",
  seriesKey: "recurring:conta-de-celular:vivo:0461855379",
  customerAccount: "0461855379",
  serviceNumber: "+5598999072739",
  fromCompetence: "2026-11",
  expectedAmountCents: 3999,
};

const forecast = {
  workspaceId: "coala",
  provisionSeriesKey: selection.seriesKey,
  provisionCompetence: "2026-11",
  provisionType: "forecast",
  provisionReconciliationStatus: "awaiting_actual",
  status: "provisioned",
  totalValue: 39.99,
  installments: [{ number: 1, value: 39.99, status: "pending" }],
  billingIdentity: { customerAccount: "0461855379", serviceNumbers: ["+5598999072739"] },
};

test("seleciona a previsão Vivo de novembro e as futuras ainda pendentes", () => {
  assert.equal(selectProvisionSeriesAmountTarget(forecast, selection)?.competence, "2026-11");
  assert.equal(selectProvisionSeriesAmountTarget({ ...forecast, provisionCompetence: "2026-12" }, selection)?.competence, "2026-12");
  assert.equal(selectProvisionSeriesAmountTarget({ ...forecast, provisionCompetence: "2026-10" }, selection), null);
  assert.equal(selectProvisionSeriesAmountTarget({ ...forecast, status: "reconciled" }, selection), null);
});

test("bloqueia mudança de espaço, conta, linha, valor ou parcela", () => {
  for (const change of [
    { workspaceId: "outro" },
    { billingIdentity: { customerAccount: "0461855378", serviceNumbers: ["+5598999072739"] } },
    { billingIdentity: { customerAccount: "0461855379", serviceNumbers: ["+5598999072738"] } },
    { totalValue: 40.89 },
    { installments: [{ number: 1, value: 39.99, status: "paid" }] },
  ]) {
    assert.throws(() => selectProvisionSeriesAmountTarget({ ...forecast, ...change }, selection));
  }
});
