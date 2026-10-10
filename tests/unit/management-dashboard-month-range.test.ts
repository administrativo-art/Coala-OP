import assert from "node:assert/strict";
import test from "node:test";

import { listRecentMonths, monthKeyOf, monthStartOf } from "../../src/features/management-dashboard/widgets/month-range";

test("lista os últimos meses do mais recente ao mais antigo, atravessando o ano", () => {
  const months = listRecentMonths(new Date(2026, 1, 15), 4);
  assert.deepEqual(months.map((m) => m.key), ["2026-02", "2026-01", "2025-12", "2025-11"]);
  assert.equal(months[2]!.label, "dezembro/2025");
});

test("converte entre chave e data do mês", () => {
  assert.equal(monthKeyOf(new Date(2026, 9, 31)), "2026-10");
  assert.equal(monthStartOf("2026-10").getMonth(), 9);
  assert.equal(monthStartOf("2026-10").getDate(), 1);
});
