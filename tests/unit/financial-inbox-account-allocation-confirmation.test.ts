import assert from "node:assert/strict";
import test from "node:test";

import { forecastAllocationsMatchConfirmedAmount, parseConfirmedAccountAllocations } from "../../src/features/financial/inbox/account-allocation-confirmation";

test("componentes reais da guia substituem previsão somente quando fecham em centavos", () => {
  const ids = ["das-componente-irpj", "das-componente-csll", "das-componente-cofins",
    "das-componente-pis", "das-componente-cpp", "das-componente-icms"];
  const components = [23989, 15266, 55568, 12038, 183192, 146117]
    .map((amountCents, index) => ({ accountPlanId: ids[index]!, amountCents }));
  assert.deepEqual(parseConfirmedAccountAllocations(components, 436170), components);
  assert.throws(() => parseConfirmedAccountAllocations(components, 392178), /somar/);
  assert.throws(() => parseConfirmedAccountAllocations([...components.slice(0, 5), { accountPlanId: ids[0], amountCents: 146117 }], 436170), /distintas/);
  assert.throws(() => parseConfirmedAccountAllocations([{ accountPlanId: ids[0], amountCents: 436170 }], 436170), /inválidas/);
});

test("previsão com apropriações antigas não pode ser copiada para despesa de outro valor", () => {
  const forecast = { hasAccountAllocations: true, accountAllocations: [
    { accountPlanId: "irpj", amount: 2000 }, { accountPlanId: "icms", amount: 1921.78 },
  ] };
  assert.equal(forecastAllocationsMatchConfirmedAmount(forecast, 436170), false);
  assert.equal(forecastAllocationsMatchConfirmedAmount(forecast, 392178), true);
  assert.equal(forecastAllocationsMatchConfirmedAmount({ ...forecast, accountAllocations: [{ accountPlanId: "irpj", amount: 2000 }] }, 200000), false);
  assert.equal(forecastAllocationsMatchConfirmedAmount({ hasAccountAllocations: false }, 436170), true);
});
