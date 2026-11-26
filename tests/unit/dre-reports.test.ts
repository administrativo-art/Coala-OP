import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";
import { createDreReportPreview } from "../../src/features/financial/dre/report-preview";
import { renderDreReportPdf } from "../../src/features/financial/dre/report-pdf";
import { renderDreReportWorkbook } from "../../src/features/financial/dre/report-xlsx";
import { comparableDreMonths, describeReportMonth, dreReportPeriods } from "../../src/features/financial/dre/report";
import { assertDreReportAccess, dreReportInputSchema } from "../../src/features/financial/dre/report-access";
import { systemDocumentTemplateById } from "../../src/features/hr/documents/system-template-catalog";
import type { ServerUserContext } from "../../src/lib/auth-server";

test("12 competências atravessam ano sem truncar histórico indisponível", () => {
  assert.deepEqual(dreReportPeriods("2026-10", "twelve_months"), ["2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08","2026-09","2026-10"]);
});
test("contrato fixa CMV estoque e recusa dados calculados, escopo repetido, outra unidade e futuro", () => {
  const input = { month: "2026-10", mode: "monthly", format: "pdf", kioskIds: ["a"] };
  assert.ok(dreReportInputSchema.safeParse(input).success);
  assert.equal(dreReportInputSchema.safeParse({ ...input, criterion: "composition" }).success, false);
  assert.equal(dreReportInputSchema.safeParse({ ...input, kioskIds: ["a","a"] }).success, false);
  const actor = { isDefaultAdmin: false, permissions: { financial: { view: true, dre: true } }, userDoc: { unitAccessScope: "selected", unitAccessUnitIds: ["a"] } } as unknown as ServerUserContext;
  const parsed = dreReportInputSchema.parse(input);
  assert.doesNotThrow(() => assertDreReportAccess(actor, parsed, new Date("2026-11-17")));
  assert.throws(() => assertDreReportAccess(actor, { ...parsed, kioskIds: ["b"] }, new Date("2026-11-17")));
  assert.throws(() => assertDreReportAccess(actor, { ...parsed, month: "2027-01" }, new Date("2026-11-17")));
  assert.throws(() => assertDreReportAccess({ ...actor, permissions: {} } as ServerUserContext, parsed, new Date("2026-11-17")));
});
test("parcial não inventa comparação diária e indisponível continua distinto de zero", () => {
  const report = createDreReportPreview(); const m = report.months[0];
  const description = describeReportMonth("2026-11", m.metrics, "2026-11-17T20:00:00Z");
  assert.equal(description.partial, true); assert.equal(description.status, "Provisório");
  assert.equal(comparableDreMonths({ ...m, ...description }, report.previous), false);
  m.metrics.cmv = NaN; m.metrics.lucroLiq = NaN; m.metrics.cashSurplus = 0;
  const book = XLSX.read(renderDreReportWorkbook(report), { type: "buffer" });
  const ws = book.Sheets["DRE mensal"];
  assert.equal(ws.B5, undefined, "CMV não pode virar zero numérico");
  assert.equal(ws.B14.v, 0, "sobra conhecida zero permanece número");
});
test("Excel é ZIP XLSX com números reais, porcentagens, filtros e 12 meses; sem fórmula de texto", () => {
  const report = createDreReportPreview("twelve_months"); report.principalExpenses[0].account = "=1+1";
  const bytes = renderDreReportWorkbook(report); assert.equal(bytes.subarray(0, 2).toString(), "PK");
  const book = XLSX.read(bytes, { type: "buffer", cellNF: true });
  assert.equal(book.Sheets["DRE 12 meses"].M1.v, "jul/2027");
  assert.equal(book.Sheets["DRE mensal"].B2.t, "n"); assert.equal(book.Sheets["DRE mensal"].C2.z, "0.0%;[Red]-0.0%");
  assert.ok(book.Sheets.Quiosques["!autofilter"]);
  assert.equal(book.Sheets["Despesas principais"].A2.t, "s"); assert.equal(book.Sheets["Despesas principais"].A2.f, undefined);
  assert.equal(report.criterion, "stock_movement");
});
test("PDF usa A4 oficial em todas as páginas; catálogo contextual sem assinatura e sem titular", async () => {
  const bytes = await renderDreReportPdf(createDreReportPreview("twelve_months"));
  const pdf = await PDFDocument.load(bytes); assert.ok(pdf.getPageCount() >= 3);
  for (const page of pdf.getPages()) { assert.ok(Math.abs(page.getWidth() - 595.28) < .1); assert.ok(page.node.Resources()?.toString().includes("XObject")); }
  const template = systemDocumentTemplateById("system-financial-dre-report")!;
  assert.equal(template.generationMode, "contextual"); assert.equal(template.renderer, "dre_report");
  assert.equal(template.signatureScope, "none"); assert.equal(template.retentionPolicyId, "manual_review");
  assert.equal(template.letterheadVersion, "coala-letterhead-v2"); assert.equal(template.version, 1);
  assert.equal(template.sourceModulePath, "src/features/financial/dre/report-pdf.ts");
});

test("subconjunto de centros não absorve outras unidades nem renormaliza rateio e conserva centavos", async () => {
  const { calculateDreReportExpenses } = await import("../../src/features/financial/dre/report-expenses");
  const input = { monthKey: "2026-10", accounts: { op: { name: "Operacional", drePosition: "despesas_operacionais", isDreAccount: true } },
    resultCenterNames: { a: "A", b: "B", c: "C" }, expenses: [
      { id: "direct-a", accountingContractVersion: 1, accountPlan: "op", status: "pending", competenceMonth: "2026-10", competenceDate: "2026-10-01", totalValue: 100, resultCenter: "a" },
      { id: "direct-c", accountingContractVersion: 1, accountPlan: "op", status: "pending", competenceMonth: "2026-10", competenceDate: "2026-10-01", totalValue: 900, resultCenter: "c" },
      { id: "shared", accountingContractVersion: 1, accountPlan: "op", status: "pending", competenceMonth: "2026-10", competenceDate: "2026-10-01", totalValue: .01, isApportioned: true, apportionments: [{ resultCenter: "a", percentage: 33.33 }, { resultCenter: "b", percentage: 33.33 }, { resultCenter: "c", percentage: 33.34 }] },
    ] };
  const ab = calculateDreReportExpenses({ ...input, centers: ["A", "B"] });
  const c = calculateDreReportExpenses({ ...input, centers: ["C"] });
  const all = calculateDreReportExpenses({ ...input, centers: [null] });
  assert.equal(ab.totalsByPosition.despesas_operacionais, 100);
  assert.equal(c.totalsByPosition.despesas_operacionais, 900.01);
  assert.equal(Math.round((ab.totalsByPosition.despesas_operacionais + c.totalsByPosition.despesas_operacionais) * 100), Math.round(all.totalsByPosition.despesas_operacionais * 100));
  assert.equal(calculateDreReportExpenses({ ...input, centers: ["A", "A"] }).totalsByPosition.despesas_operacionais, 100);
});
test("núcleo compartilhado reproduz EBIT e lucro e propaga estoque desconhecido", async () => {
  const { calculateDreMetrics } = await import("../../src/features/financial/dre/metrics");
  const base = createDreReportPreview().months[0].metrics;
  const input = { expenseCalculation: { totalsByPosition: { impostos_deducoes: 2305.59, pessoal: 16513.86, despesas_operacionais: 12161.71, ocupacao: 7431.78, despesas_financeiras: 223.80, impostos_resultado: 392.55 }, detailsByPosition: {}, issues: [] },
    revenueSource: { ...base.revenueSource, revenueCents: 6379950, cashShortageCents: 61600, cashSurplusCents: 9593 },
    compositionPeriods: [], compositionCmv: 16265.56, cmvCriterion: "stock_movement" as const, stockCmvBreakdown: { ...base.stockCmvBreakdown, totalCmv: 19944.60 } };
  const m = calculateDreMetrics(input); assert.equal(Math.round(m.recLiq * 100), 6149391); assert.equal(Math.round(m.resOp * 100), 492189); assert.equal(Math.round(m.lucroLiq * 100), 430554);
  const unknown = calculateDreMetrics({ ...input, stockCmvBreakdown: { ...input.stockCmvBreakdown, totalCmv: NaN, coverage: "unavailable" } });
  assert.ok(Number.isNaN(unknown.lucroLiq)); assert.equal(unknown.resultState.status, "unavailable");
});

test("competência anterior à cobertura não exibe despesas zero falsamente conhecidas", async () => {
  const { restrictDreReportCoverage } = await import("../../src/features/financial/dre/report");
  const report = createDreReportPreview("twelve_months");
  report.months[0].metrics = restrictDreReportCoverage("2026-07", report.months[0].metrics);
  const book = XLSX.read(renderDreReportWorkbook(report), { type: "buffer" });
  assert.equal(book.Sheets["DRE 12 meses"].B3, undefined, "impostos sem cobertura não são zero");
  assert.equal(book.Sheets["DRE 12 meses"].B9, undefined, "pessoal sem cobertura não é zero");
  assert.equal(report.months[0].metrics.resultState.status, "unavailable");
});

test("competências e data de geração são brasileiras e Fontes CMV preserva referências completas", async () => {
  const { formatDrePeriod, formatDreDateTime } = await import("../../src/features/financial/dre/report");
  assert.equal(formatDrePeriod("2026-10"), "outubro de 2026"); assert.equal(formatDrePeriod("2026-10", true), "out/2026");
  assert.equal(formatDreDateTime("2026-11-17T20:04:00Z"), "17/11/2026 17:04");
  const book = XLSX.read(renderDreReportWorkbook(createDreReportPreview()), { type: "buffer" });
  assert.equal(book.Sheets.Contexto.B3.v, "01/08/2027 12:00");
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(book.Sheets["Fontes CMV"], { header: 1 });
  assert.ok(rows.some(r => r.includes("demo-source-fingerprint"))); assert.ok(rows.some(r => r.includes("demo-sales-fingerprint")));
  assert.ok(rows.some(r => r.includes("demo-effective-cost") && r.includes("01/06/2027 12:00")));
});
