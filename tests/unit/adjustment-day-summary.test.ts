import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDuration, formatSignedDuration, minutesFromWorkDate, operationsHeadline, pendingOperations, summarizeAdjustmentDay,
  type AdjustmentDayContext, type DayOperation,
} from "../../src/features/dp/time-adjustments/day-summary";

const at = (time: string, date = "2026-10-26") => `${date}T${time}:00-0300`;
const marking = (receiptId: string, time: string, nsr: number, channel: "app" | "web" = "app") =>
  ({ receiptId, markedAt: at(time), nsr, executionUnitId: "u1", purpose: null, channel });
const luis: AdjustmentDayContext = {
  adjustmentId: "a1", workDate: "2026-10-26", scope: "pilot", truncated: false,
  markings: [marking("r1", "05:58", 4), marking("r2", "10:01", 5), marking("r3", "11:00", 6), marking("r4", "17:59", 7, "web")],
  treatments: [],
  shifts: [{ startTime: "06:00", endTime: "14:00", overnight: false, shiftName: "Manhã", unitName: "Tirirical", breakType: "fixed",
    breakStart: "10:00", breakEnd: "11:00", breakDurationMinutes: 60, toleranceMinutes: 10, referenceMinutes: null, expectedPunches: 4 }],
  history: { otherRequestsSameDay: 0, approvedInPrevious30Days: 1 }, relationship: "clt",
};
const swap: DayOperation[] = [{ kind: "correct", target: { receiptId: "r4", markedAt: at("17:59"), nsr: 7 }, inclusion: { markedAt: at("13:50") } }];

test("dia do Luis: 11h02 antes e 6h53 depois, com a escala de 7h", () => {
  const summary = summarizeAdjustmentDay(luis, swap);
  assert.equal(summary.before.workedMinutes, 662);
  assert.equal(summary.after.workedMinutes, 413);
  assert.equal(summary.scheduledMinutes, 420);
  assert.equal(summary.before.diffMinutes, 242);
  assert.equal(summary.after.diffMinutes, -7);
  assert.equal(summary.before.breakMinutes, 59);
  assert.equal(summary.after.breakMinutes, 59);
  assert.equal(formatDuration(662), "11h02");
  assert.equal(formatSignedDuration(-7), "−0h07");
  assert.equal(summary.shiftText, "escala 06:00–14:00 · intervalo 10:00–11:00");
});

test("o que passa da escala fica de fora e a tolerância absorve a chegada de 2 minutos", () => {
  const summary = summarizeAdjustmentDay(luis, swap);
  assert.equal(summary.before.outsideMinutes, 239);
  assert.equal(summary.after.outsideMinutes, 0);
  assert.equal(summary.before.note.tone, "warn");
  assert.match(summary.before.note.text, /^Passa 4h02 da escala; 3h59 fora do horário da escala\.$/);
  assert.equal(summary.after.note.tone, "neutral");
  assert.equal(summary.after.note.text, "0h07 a menos que a escala, dentro da tolerância cadastrada na jornada (10 min).");
  assert.equal(summary.before.segments.filter((item) => item.outside).length, 1);
});

test("a linha de depois mostra a batida incluída, a desconsiderada e o trecho que deixa de contar", () => {
  const summary = summarizeAdjustmentDay(luis, swap);
  assert.deepEqual(summary.after.markers.map((item) => [item.time, item.state]),
    [["05:58", "kept"], ["10:01", "kept"], ["11:00", "kept"], ["13:50", "included"], ["17:59", "removed"]]);
  assert.equal(summary.after.markers.find((item) => item.time === "13:50")?.label, "Fim · incluída");
  assert.equal(summary.after.markers.find((item) => item.time === "17:59")?.label, "desconsiderada");
  assert.deepEqual(summary.after.ghostSegments.map((item) => [item.start, item.end]), [[830, 1079]]);
  assert.deepEqual(summary.axis, { start: 300, end: 1140 });
  assert.deepEqual(summary.before.markers.map((item) => item.side), ["above", "above", "below", "above"]);
});

test("a tabela lista todas as batidas e diz o que o pedido faz com cada uma", () => {
  const summary = summarizeAdjustmentDay(luis, swap);
  assert.deepEqual(summary.rows.map((row) => [row.time, row.action]),
    [["05:58", "kept"], ["10:01", "kept"], ["11:00", "kept"], ["13:50", "include"], ["17:59", "discard"]]);
  assert.equal(summary.rows[0].origin, "Coala Go · seq. 4");
  assert.equal(summary.rows[4].origin, "Coala One · seq. 7");
  assert.equal(summary.rows[3].origin, "Pedido do titular");
  assert.equal(summary.rows[0].label, "Início da jornada");
});

test("tratamentos já aprovados entram em 'como está'", () => {
  const withEarlier: AdjustmentDayContext = { ...luis, scope: "official", treatments: [
    { adjustmentId: "old", type: "discard", originalReceiptId: "r4", markedAt: null },
    { adjustmentId: "old", type: "inclusion", originalReceiptId: null, markedAt: at("14:05") },
  ] };
  const summary = summarizeAdjustmentDay(withEarlier, []);
  assert.equal(summary.before.workedMinutes, 243 + 185);
  assert.deepEqual(summary.rows.map((row) => row.action), ["kept", "kept", "kept", "earlier_included", "earlier_discarded"]);
  assert.ok(summary.rows.some((row) => row.action === "earlier_discarded" && row.time === "17:59"));
  assert.ok(summary.rows.some((row) => row.action === "earlier_included" && row.time === "14:05"));
  assert.equal(summary.rows.find((row) => row.action === "earlier_included")?.origin, "Ajuste anterior");
});

test("número ímpar de batidas não soma o dia e avisa", () => {
  const odd: AdjustmentDayContext = { ...luis, markings: luis.markings.slice(0, 3) };
  const summary = summarizeAdjustmentDay(odd, []);
  assert.equal(summary.before.workedMinutes, null);
  assert.equal(summary.before.diffMinutes, null);
  assert.equal(summary.before.note.text, "Número ímpar de batidas: não é possível somar o dia.");
});

test("sem escala no dia, mostra as batidas e não compara", () => {
  const summary = summarizeAdjustmentDay({ ...luis, shifts: [] }, swap);
  assert.equal(summary.hasShift, false);
  assert.equal(summary.scheduledMinutes, null);
  assert.equal(summary.before.outsideMinutes, 0);
  assert.equal(summary.before.note.text, "Sem escala neste dia para comparar.");
  assert.equal(summary.shiftText, null);
});

test("a batida do pedido que não veio na leitura do dia ainda conta como desconsiderada, e o painel avisa", () => {
  const summary = summarizeAdjustmentDay({ ...luis, markings: luis.markings.slice(0, 3) }, swap);
  assert.equal(summary.before.workedMinutes, 662);
  assert.equal(summary.after.workedMinutes, 413);
  assert.match(summary.notice ?? "", /A batida das 17:59 citada no pedido não foi encontrada na leitura deste dia\. Confira a data e a origem\./);
});

test("dia com menos batidas que o esperado avisa, e uma batida só aparece sem rótulo de entrada", () => {
  const only = { ...luis, markings: [luis.markings[3]] };
  const summary = summarizeAdjustmentDay(only, swap);
  assert.match(summary.notice ?? "", /^Há 1 batida registrada neste dia; a escala cadastrada tem 4 marcações\. Confira o motivo informado no pedido\./);
  assert.deepEqual(summary.before.markers.map((marker) => marker.label), [null]);
  assert.equal(summarizeAdjustmentDay(luis, swap).notice, null);
  assert.match(summarizeAdjustmentDay({ ...luis, markings: [] }, []).notice ?? "", /^Não há batida registrada neste dia; a escala cadastrada tem 4 marcações\./);
});

test("a escala e o intervalo fixo viram o fundo da linha, em minutos do dia", () => {
  const band = summarizeAdjustmentDay(luis, swap).scaleBand;
  assert.deepEqual(band, { start: 360, end: 840, breakStart: 600, breakEnd: 660 });
  assert.equal(summarizeAdjustmentDay({ ...luis, shifts: [] }, swap).scaleBand, null);
});

test("inclusão simples e desconsideração simples", () => {
  const include: DayOperation[] = [{ kind: "include", target: null, inclusion: { markedAt: at("13:50") } }];
  const discard: DayOperation[] = [{ kind: "discard", target: { receiptId: "r4", markedAt: at("17:59"), nsr: 7 }, inclusion: null }];
  const base = { ...luis, markings: luis.markings.slice(0, 3) };
  assert.equal(summarizeAdjustmentDay(base, include).after.workedMinutes, 413);
  assert.equal(summarizeAdjustmentDay(luis, discard).after.punchCount, 3);
  assert.equal(operationsHeadline(swap), "Trocar 17:59 por 13:50");
  assert.equal(operationsHeadline(include), "Incluir 13:50");
  assert.equal(operationsHeadline(discard), "Desconsiderar 17:59");
});

test("turno que passa da meia-noite usa o dia seguinte como fim da escala", () => {
  const night: AdjustmentDayContext = { ...luis, markings: [
    { ...marking("n1", "22:00", 1) }, { ...marking("n2", "06:00", 2), markedAt: at("06:00", "2026-10-27") }],
    shifts: [{ ...luis.shifts[0], startTime: "22:00", endTime: "06:00", overnight: true, breakType: "none", breakStart: null, breakEnd: null, breakDurationMinutes: null, referenceMinutes: null, expectedPunches: 2 }] };
  const summary = summarizeAdjustmentDay(night, []);
  assert.equal(minutesFromWorkDate("2026-10-26", at("06:00", "2026-10-27")), 30 * 60);
  assert.equal(summary.before.workedMinutes, 480);
  assert.equal(summary.scheduledMinutes, 480);
  assert.equal(summary.before.outsideMinutes, 0);
});

test("pendingOperations normaliza o pedido simples e o composto", () => {
  assert.equal(pendingOperations({ kind: "include", target: null, inclusion: { markedAt: at("13:50") } }).length, 1);
  assert.equal(pendingOperations({ kind: "correct", target: null, inclusion: null, operations: swap.concat(swap) }).length, 2);
});

test("estágio e aprendizagem recebem só a diferença, sem 'passa' nem 'a menos' como alerta", () => {
  for (const relationship of ["internship", "apprenticeship"] as const) {
    const summary = summarizeAdjustmentDay({ ...luis, relationship }, swap);
    assert.equal(summary.before.note.tone, "neutral");
    assert.equal(summary.before.note.text, "Diferença de +4h02 em relação à escala do dia (informativo para este vínculo).");
    assert.equal(summary.after.note.text, "Diferença de −0h07 em relação à escala do dia (informativo para este vínculo).");
  }
});

test("sem tolerância cadastrada, qualquer minuto fora da escala conta e a diferença é a conta exata", () => {
  const strict = summarizeAdjustmentDay({ ...luis, shifts: [{ ...luis.shifts[0], toleranceMinutes: null }] }, swap);
  assert.equal(strict.toleranceMinutes, 0);
  assert.equal(strict.before.outsideMinutes, 241);
  assert.equal(strict.after.outsideMinutes, 2);
  assert.equal(strict.after.note.text, "0h07 a menos que a escala.");
});

test("mais de um turno no dia é avisado e só o primeiro entra na comparação", () => {
  const summary = summarizeAdjustmentDay({ ...luis, shifts: [luis.shifts[0], { ...luis.shifts[0], startTime: "18:00", endTime: "22:00" }] }, swap);
  assert.match(summary.shiftText ?? "", /há mais 1 turno no dia, sem somar$/);
  assert.equal(summary.scheduledMinutes, 420);
});

test("os textos do painel nunca falam em hora extra, banco de horas, irregularidade ou limite legal", () => {
  const scenarios = [
    summarizeAdjustmentDay(luis, swap), summarizeAdjustmentDay({ ...luis, markings: luis.markings.slice(0, 3) }, []),
    summarizeAdjustmentDay({ ...luis, shifts: [] }, []), summarizeAdjustmentDay({ ...luis, relationship: "internship" }, swap),
    summarizeAdjustmentDay({ ...luis, markings: [] }, []),
  ];
  const texts = scenarios.flatMap((summary) => [summary.before.note.text, summary.after.note.text, summary.shiftText ?? ""]);
  for (const text of texts) assert.doesNotMatch(text, /hora extra|horas extras|banco de horas|irregular|ilegal|\blegal\b|limite/i, text);
});
