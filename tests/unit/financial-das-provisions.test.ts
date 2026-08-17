import assert from "node:assert/strict";
import test from "node:test";

import {
  consultDasProvision,
  DAS_PROVISION_SERIES_KEY,
} from "../../src/features/financial/lib/das-provisions";

const provision = {
  id: "das-provision-2026-08",
  provisionSeriesKey: DAS_PROVISION_SERIES_KEY,
  provisionType: "forecast",
  provisionCompetence: "2026-08",
  status: "provisioned",
  totalValue: 3_921.78,
};

test("encontra a provisão do DAS pela competência e calcula a diferença", () => {
  const actual = {
    id: "das-actual-2026-08",
    accountPlanName: "DAS",
    provisionSeriesKey: DAS_PROVISION_SERIES_KEY,
    provisionType: "actual",
    provisionCompetence: "2026-08",
    totalValue: 4_100,
  };

  assert.deepEqual(consultDasProvision(actual, [actual, provision]), {
    status: "matched",
    competence: "2026-08",
    provision,
    actualValue: 4_100,
    provisionedValue: 3_921.78,
    variance: 178.22,
  });
});

test("não oferece uma provisão de outra competência", () => {
  const actual = {
    accountPlanName: "DAS",
    provisionSeriesKey: DAS_PROVISION_SERIES_KEY,
    provisionType: "actual",
    provisionCompetence: "2026-09",
    totalValue: 4_100,
  };
  assert.deepEqual(consultDasProvision(actual, [provision]), { status: "missing", competence: "2026-09" });
});

test("preserva a consulta da provisão já conciliada", () => {
  const actual = {
    accountPlanName: "DAS",
    provisionSeriesKey: DAS_PROVISION_SERIES_KEY,
    provisionType: "actual",
    provisionCompetence: "2026-08",
    reconciledProvisionId: provision.id,
    totalValue: 3_800,
  };
  assert.equal(consultDasProvision(actual, [provision]).status, "already_reconciled");
});
