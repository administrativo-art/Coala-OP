import assert from "node:assert/strict";
import test from "node:test";

import {
  getSettingsTabStructureKey,
  preserveSettingsTabSelection,
  resolveRequestedSettingsTab,
} from "../../src/lib/settings-tab-selection";

const operationalTabs = [
  { value: "forms" },
  { value: "cadastros" },
  { value: "units" },
];

test("preserva a aba escolhida quando os dados da página renderizam novamente", () => {
  const refreshedTabs = operationalTabs.map((tab) => ({ ...tab }));

  assert.equal(
    getSettingsTabStructureKey(refreshedTabs),
    getSettingsTabStructureKey(operationalTabs)
  );
  assert.deepEqual(
    preserveSettingsTabSelection(refreshedTabs, "cadastros", "cadastros"),
    { groupValue: "cadastros", leafValue: "cadastros" }
  );
});

test("usa a aba solicitada pela URL na abertura", () => {
  assert.deepEqual(resolveRequestedSettingsTab(operationalTabs, "cadastros"), {
    groupValue: "cadastros",
    leafValue: "cadastros",
  });
});

test("recua apenas quando a aba atual deixou de existir", () => {
  assert.deepEqual(
    preserveSettingsTabSelection(operationalTabs, "removida", "removida"),
    { groupValue: "forms", leafValue: "forms" }
  );
});
