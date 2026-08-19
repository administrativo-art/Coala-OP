import assert from "node:assert/strict";
import test from "node:test";

import {
  getImportAuditProgress,
  getImportAuditSourceBalance,
  groupImportAuditItems,
} from "../../src/features/financial/lib/import-audit-list";
import type { ImportSessionItem } from "../../src/features/financial/types/import";

function item(id: string, date: string, amount: number, bankStatementData?: Record<string, unknown>) {
  return { id, date, amount, bankStatementData } as ImportSessionItem;
}

test("agrupa a auditoria por dia preservando a ordem recebida", () => {
  const groups = groupImportAuditItems([
    item("a", "2026-08-12", -100),
    item("b", "2026-08-12", 40),
    item("c", "2026-08-13", -20),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "12/08");
  assert.equal(groups[0].weekday, "Quarta-feira");
  assert.equal(groups[0].netAmount, -60);
  assert.deepEqual(groups[0].items.map((entry) => entry.id), ["a", "b"]);
  assert.equal(groups[1].label, "13/08");
});

test("usa somente o saldo informado pela fonte bancária", () => {
  assert.equal(
    getImportAuditSourceBalance(item("a", "2026-08-12", -100, { detalhes: { saldoAposLancamento: "R$ 1.234,56" } })),
    1234.56,
  );
  assert.equal(
    getImportAuditSourceBalance(item("b", "2026-08-12", 40, { runningBalance: "1,234.56" })),
    1234.56,
  );
  assert.equal(getImportAuditSourceBalance(item("c", "2026-08-12", 40, { valor: 40 })), null);
});

test("progresso considera auditadas, efetivadas e ignoradas como tratadas", () => {
  assert.deepEqual(
    getImportAuditProgress({ total: 10, pending: 3, audited: 2, completed: 4, ignored: 1 }),
    { total: 10, treated: 7, percentage: 70 },
  );
  assert.deepEqual(
    getImportAuditProgress({ total: 0, pending: 0, audited: 0, completed: 0, ignored: 0 }),
    { total: 0, treated: 0, percentage: 0 },
  );
});
