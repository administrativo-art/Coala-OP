import assert from "node:assert/strict";
import test from "node:test";

import { billingAlertPresentation, formatBillingBytes, formatBillingGeneratedAt } from "../../src/components/ai-management/billing-presentation";

test("OpenAI alert labels reflect the configured monthly budget status", () => {
  const unavailable = billingAlertPresentation({ basis: "openai_budget", level: "unavailable", usedPercent: null }, "openai");
  assert.equal(unavailable.pill, "Sem limite");
  assert.match(unavailable.description, /Defina um limite mensal/);

  const warning = billingAlertPresentation({ basis: "openai_budget", level: "warning", usedPercent: 80 }, "openai");
  assert.equal(warning.pillVariant, "warn");
  assert.match(warning.description, /80% do limite mensal/);

  const critical = billingAlertPresentation({ basis: "openai_budget", level: "critical", usedPercent: 101 }, "openai");
  assert.equal(critical.pillVariant, "danger");
  assert.match(critical.description, /101% do limite mensal/);
});

test("Google alert says the forecast covers panel queries, not the whole account", () => {
  const warning = billingAlertPresentation({ basis: "bigquery_panel_estimate", level: "warning", usedPercent: 82.5 }, "google");
  assert.match(warning.description, /consultas deste painel/);
  assert.match(warning.description, /até 25 consultas por dia em uma instância/);
  assert.match(warning.description, /Não mede o uso total/);
  assert.equal(warning.pill, "80% ou mais");
  const unavailable = billingAlertPresentation({ basis: "bigquery_panel_estimate", level: "unavailable", usedPercent: null }, "google");
  assert.equal(unavailable.pill, "Sem estimativa");
});

test("BigQuery estimate formats binary units and unavailable values", () => {
  assert.equal(formatBillingBytes(null), "Não disponível");
  assert.equal(formatBillingBytes(250_000_000), "238,42 MiB");
  assert.equal(formatBillingBytes(1024 ** 4), "1 TiB");
});

test("billing timestamp uses the app timezone and rejects invalid values", () => {
  assert.equal(formatBillingGeneratedAt("2026-10-08T14:25:00.000Z"), "08/10/2026, 11:25");
  assert.equal(formatBillingGeneratedAt("invalid"), null);
});
