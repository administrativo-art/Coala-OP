import assert from "node:assert/strict";
import test from "node:test";

import { filterCashCountingSessions } from "../../src/features/financial/cash-counting-sessions/session-filter";
const sessions = [
  { id: "open", status: "open" as const },
  { id: "counted", status: "counted" as const },
  { id: "deposit-ready", status: "deposit_ready" as const },
  { id: "completed", status: "completed" as const },
  { id: "cancelled", status: "cancelled" as const },
];

test("filtro padrão mantém somente sessões que ainda estão ativas", () => {
  assert.deepEqual(
    filterCashCountingSessions(sessions, "active").map((session) => session.id),
    ["open", "counted", "deposit-ready"],
  );
});

test("concluídas e canceladas ficam em filtros históricos separados", () => {
  assert.deepEqual(
    filterCashCountingSessions(sessions, "completed").map((session) => session.id),
    ["completed"],
  );
  assert.deepEqual(
    filterCashCountingSessions(sessions, "cancelled").map((session) => session.id),
    ["cancelled"],
  );
});
