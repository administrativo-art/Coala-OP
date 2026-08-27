import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldArchiveDocument,
  shouldKeepExpenseActive,
} from "../../scripts/cutover-financial-2026-08.mjs";

const cutoff = new Date("2026-08-01T00:00:00-03:00");

test("mantém ativa apenas despesa de compra não cancelada com vencimento a partir do corte", () => {
  assert.equal(
    shouldKeepExpenseActive(
      { originModule: "purchasing", status: "pending", dueDate: new Date("2026-08-01T00:00:00-03:00") },
      cutoff,
    ),
    true,
  );
  assert.equal(
    shouldKeepExpenseActive(
      { originModule: "purchasing", status: "pending", dueDate: new Date("2026-07-31T23:59:59-03:00") },
      cutoff,
    ),
    false,
  );
  assert.equal(
    shouldKeepExpenseActive(
      { originModule: "purchasing", status: "cancelled", dueDate: new Date("2026-08-10T00:00:00-03:00") },
      cutoff,
    ),
    false,
  );
});

test("arquiva despesa manual futura para recadastro revisado", () => {
  assert.equal(
    shouldArchiveDocument(
      "expenses",
      { originModule: null, status: "pending", dueDate: new Date("2027-03-05T00:00:00-03:00") },
      cutoff,
    ),
    true,
  );
});

test("arquiva rascunhos descartados e antigos, preservando rascunho novo aberto", () => {
  assert.equal(
    shouldArchiveDocument(
      "importDrafts",
      { status: "discarded", createdAt: new Date("2026-08-10T00:00:00-03:00") },
      cutoff,
    ),
    true,
  );
  assert.equal(
    shouldArchiveDocument(
      "importDrafts",
      { status: "open", createdAt: new Date("2026-07-20T00:00:00-03:00") },
      cutoff,
    ),
    true,
  );
  assert.equal(
    shouldArchiveDocument(
      "importDrafts",
      { status: "open", createdAt: new Date("2026-08-10T00:00:00-03:00") },
      cutoff,
    ),
    false,
  );
});
