import assert from "node:assert/strict";
import test from "node:test";

import { buildCashClosureFromPdv } from "../../src/features/financial/cash-closures/build-cash-closure";
import {
  cashClosureId,
  cashClosureLineId,
  mergeBuiltClosureForPersistence,
  normalizeCashClosureWithLines,
  recalculateCountedLine,
  recalculateReportedLine,
  withPdvAutomaticClosureTotals,
} from "../../src/features/financial/cash-closures/persistence";

const context = {
  workspaceId: "ws1",
  kioskId: "tirirical",
  kioskName: "Tirirical",
  pdvFilialId: "17343",
  date: "2026-07-07",
};

function build(amount: number) {
  return buildCashClosureFromPdv([
    {
      codcupom: "1",
      usuariorecebimento_id: "10",
      dtrecebimento: "2026-07-07 12:00:00",
      valortotal: amount,
      itens: [],
      formaPgtos: [{ nome: "DINHEIRO", valortotal: amount }],
    },
  ], context);
}

function buildPix(amount: number) {
  return buildCashClosureFromPdv([
    {
      codcupom: "pix-1",
      usuariorecebimento_id: "10",
      dtrecebimento: "2026-07-07 12:00:00",
      valortotal: amount,
      itens: [],
      formaPgtos: [{ nome: "PIX", valortotal: amount }],
    },
  ], context);
}

test("IDs de fechamento e linha são determinísticos", () => {
  assert.equal(cashClosureId("tirirical", "2026-07-07"), "tirirical_2026-07-07");
  assert.equal(cashClosureLineId("10", "cash"), "10_cash");
});

test("ressincronização atualiza esperado e preserva contado e observação", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(100), now: "2026-07-08T10:00:00.000Z" });
  const countedLine = recalculateCountedLine(
    first.lines[0],
    9_500,
    "Falta conferida",
    "user-1",
    "2026-07-08T11:00:00.000Z",
  );
  const second = mergeBuiltClosureForPersistence({
    built: build(101),
    existingClosure: first.closure,
    existingLines: [countedLine],
    now: "2026-07-08T12:00:00.000Z",
  });

  assert.equal(second.lines.length, 1);
  assert.equal(second.lines[0].expectedCents, 10_100);
  assert.equal(second.lines[0].countedCents, 9_500);
  assert.equal(second.lines[0].differenceCents, -600);
  assert.equal(second.lines[0].note, "Falta conferida");
  assert.equal(second.lines[0].status, "divergent");
});

test("mantém separados o informado pelo Caixa e a conferência do Financeiro", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(100), now: "2026-07-08T10:00:00.000Z" });
  const reported = recalculateReportedLine(
    first.lines[0],
    9_500,
    "Caixa informou falta",
    "cashier-1",
    "2026-07-08T11:00:00.000Z",
  );
  const counted = recalculateCountedLine(
    reported,
    9_700,
    "Financeiro contou R$ 2,00 a mais que o Caixa",
    "finance-1",
    "2026-07-08T12:00:00.000Z",
  );

  assert.equal(counted.reportedDifferenceCents, -500);
  assert.equal(counted.conferenceDifferenceCents, 200);
  assert.equal(counted.differenceCents, -300);
  assert.equal(counted.reportedNote, "Caixa informou falta");
  assert.equal(counted.note, "Financeiro contou R$ 2,00 a mais que o Caixa");
});

test("registro legado usa o valor antigo como Caixa e exige nova conferência antes da aprovação", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(100), now: "2026-07-08T10:00:00.000Z" });
  const legacyLine = recalculateCountedLine(
    first.lines[0],
    9_500,
    "Valor legado",
    "user-1",
    "2026-07-08T11:00:00.000Z",
  );
  const legacyShape = {
    ...legacyLine,
    reportedCents: undefined,
    reportedDifferenceCents: undefined,
    conferenceDifferenceCents: undefined,
    reportedNote: undefined,
    reportedBy: undefined,
    reportedAt: undefined,
  } as unknown as typeof legacyLine;
  const normalized = normalizeCashClosureWithLines(
    { ...first.closure, status: "pending_review" },
    [legacyShape],
  );

  assert.equal(normalized.lines[0].reportedCents, 9_500);
  assert.equal(normalized.lines[0].reportedDifferenceCents, -500);
  assert.equal(normalized.lines[0].countedCents, null);
  assert.equal(normalized.lines[0].reportedNote, "Valor legado");
  assert.equal(normalized.closure.unreportedLineCount, 0);
  assert.equal(normalized.closure.pendingLineCount, 1);
});

test("duas sincronizações com a mesma fonte não duplicam linhas", () => {
  const built = build(100);
  const first = mergeBuiltClosureForPersistence({ built, now: "2026-07-08T10:00:00.000Z" });
  const second = mergeBuiltClosureForPersistence({
    built,
    existingClosure: first.closure,
    existingLines: first.lines,
    now: "2026-07-08T10:00:00.000Z",
  });

  assert.equal(second.sourceChanged, false);
  assert.equal(second.lines.length, 1);
  assert.deepEqual(second.lines, first.lines);
  assert.deepEqual(second.deletedLineIds, []);
});

test("linha removida do PDV só é apagada quando ainda não foi contada", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(100), now: "2026-07-08T10:00:00.000Z" });
  const emptyBuilt = buildCashClosureFromPdv([], context);
  const uncounted = mergeBuiltClosureForPersistence({
    built: emptyBuilt,
    existingClosure: first.closure,
    existingLines: first.lines,
    now: "2026-07-08T11:00:00.000Z",
  });
  assert.deepEqual(uncounted.deletedLineIds, ["10_cash"]);
  assert.equal(uncounted.lines.length, 0);

  const countedLine = recalculateCountedLine(first.lines[0], 10_000, null, "user-1", "2026-07-08T10:30:00.000Z");
  const counted = mergeBuiltClosureForPersistence({
    built: emptyBuilt,
    existingClosure: first.closure,
    existingLines: [countedLine],
    now: "2026-07-08T11:00:00.000Z",
  });
  assert.equal(counted.lines.length, 1);
  assert.equal(counted.lines[0].expectedCents, 0);
  assert.equal(counted.lines[0].differenceCents, 10_000);
});

test("mudança de fonte após aprovação é sinalizada", () => {
  const first = mergeBuiltClosureForPersistence({ built: build(100), now: "2026-07-08T10:00:00.000Z" });
  const second = mergeBuiltClosureForPersistence({
    built: build(101),
    existingClosure: { ...first.closure, status: "approved" },
    existingLines: first.lines,
    now: "2026-07-08T11:00:00.000Z",
  });
  assert.equal(second.closure.status, "approved");
  assert.equal(second.closure.pdvChangedAfterApproval, true);
});

test("ressincronização replica o esperado do Pix no valor conferido", () => {
  const first = mergeBuiltClosureForPersistence({ built: buildPix(100), now: "2026-07-08T10:00:00.000Z" });
  assert.equal(first.lines[0].countedCents, 10_000);
  assert.equal(first.lines[0].differenceCents, 0);
  assert.equal(first.lines[0].status, "matched");
  assert.equal(first.lines[0].countedBy, "system:pdv");

  const second = mergeBuiltClosureForPersistence({
    built: buildPix(101),
    existingClosure: first.closure,
    existingLines: [{ ...first.lines[0], countedCents: 9_500, countedBy: "user-1" }],
    now: "2026-07-08T11:00:00.000Z",
  });
  assert.equal(second.lines[0].expectedCents, 10_100);
  assert.equal(second.lines[0].countedCents, 10_100);
  assert.equal(second.lines[0].differenceCents, 0);
  assert.equal(second.lines[0].countedBy, "system:pdv");
});

test("resumo legado projeta Pix e cartões como conferidos sem contar dinheiro pendente", () => {
  const closure = mergeBuiltClosureForPersistence({
    built: buildPix(100),
    now: "2026-07-08T10:00:00.000Z",
  }).closure;
  const legacy = {
    ...closure,
    countedTotalCents: 0,
    differenceTotalCents: -10_000,
    countedByChannelCents: { ...closure.countedByChannelCents, pix: 0 },
    differenceByChannelCents: { ...closure.differenceByChannelCents, pix: -10_000 },
  };

  const projected = withPdvAutomaticClosureTotals(legacy);
  assert.equal(projected.countedTotalCents, 10_000);
  assert.equal(projected.differenceTotalCents, 0);
  assert.equal(projected.countedByChannelCents.pix, 10_000);
  assert.equal(projected.differenceByChannelCents.pix, 0);
  assert.equal(projected.countedCashCents, 0);
});
