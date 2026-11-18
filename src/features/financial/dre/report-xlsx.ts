import { summarizeCmvReconciliation } from "./cmv-reconciliation";
import * as XLSX from "xlsx";
import { DRE_REPORT_LINES, formatDrePeriod, formatDreDateTime, comparableDreMonths, reportNumber, reportRatio, reportVariation, type DreReport } from "./report";
export function renderDreReportWorkbook(report: DreReport): Buffer {
  const book = XLSX.utils.book_new();
  const sheet = (name: string, rows: Array<Array<string | number | null>>, moneyStart = 1) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = Array.from({ length: Math.max(...rows.map(r => r.length)) }, (_, i) => ({ wch: i === 0 ? 42 : 21 }));
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: Math.max(0, rows[0].length - 1) } }) };
    for (const key of Object.keys(ws)) if (!key.startsWith("!") && ws[key].t === "n" && XLSX.utils.decode_cell(key).c >= moneyStart) ws[key].z = '#,##0.00;[Red]-#,##0.00;0.00';
    XLSX.utils.book_append_sheet(book, ws, name); return ws;
  };
  const latest = report.months.at(-1)!;
  sheet("Contexto", [["Campo", "Valor"], ["Documento", "DRE Coala Shakes · versão 1"], ["Geração (Belém)", formatDreDateTime(report.generatedAt)],
    ["Período", `${formatDrePeriod(report.months[0].period)} a ${formatDrePeriod(latest.period)}`], ["Unidades", report.scope], ["Critério CMV", "Movimentação de estoque"],
    ["Comparação", report.comparisonNote], ["Legenda", "Célula vazia = indisponível, nunca zero. Zero numérico = valor conhecido. Valores em R$. Percentuais são razões numéricas formatadas."],
    ["AV", "Valor da linha dividido pela receita líquida, quando positiva."], ["AH", "(Atual − anterior) / abs(anterior), somente competências comparáveis e base diferente de zero."],
 ["Permissões", report.permissionsNote ?? "Totais e detalhes autorizados."]]);
  const monthlyRows: Array<Array<string | number | null>> = [["Linha", "Valor R$", "AV %", "Anterior R$", "AH %"]];
  const compare = comparableDreMonths(latest, report.previous);
  for (const [key, label, sign] of DRE_REPORT_LINES) monthlyRows.push([label, reportNumber(sign * latest.metrics[key]), reportRatio(sign * latest.metrics[key], latest.metrics.recLiq),
    report.previous ? reportNumber(sign * report.previous.metrics[key]) : null, compare ? reportVariation(sign * latest.metrics[key], sign * report.previous!.metrics[key]) : null]);
  const monthly = sheet("DRE mensal", monthlyRows);
  for (let i = 1; i < monthlyRows.length; i++) for (const c of [2, 4]) if (monthly[XLSX.utils.encode_cell({ r: i, c })]?.t === "n") monthly[XLSX.utils.encode_cell({ r: i, c })].z = '0.0%;[Red]-0.0%';
  if (report.mode === "twelve_months") sheet("DRE 12 meses", [["Linha", ...report.months.map(m => formatDrePeriod(m.period, true))], ...DRE_REPORT_LINES.map(([key, label, sign]) => [label, ...report.months.map(m => reportNumber(sign * m.metrics[key]))])]);
  const trend = sheet("Evolução", [["Competência", "Receita líquida", "Lucro líquido", "Margem líquida", "CMV estoque", "Situação"], ...report.months.map(m => [formatDrePeriod(m.period), reportNumber(m.metrics.recLiq), reportNumber(m.metrics.lucroLiq), reportRatio(m.metrics.lucroLiq, m.metrics.recLiq), reportNumber(m.metrics.stockCmvBreakdown.totalCmv), m.status])]);
  for (let r = 1; r <= report.months.length; r++) if (trend[`D${r + 1}`]?.t === "n") trend[`D${r + 1}`].z = '0.0%;[Red]-0.0%';
  const units = sheet("Quiosques", [["Unidade", "Competência", "Receita líquida", "CMV", "EBIT", "Lucro líquido", "Margem líquida", "Situação"],
    ...report.months.flatMap(m => m.units.map(u => [u.name, formatDrePeriod(m.period), reportNumber(u.metrics.recLiq), reportNumber(u.metrics.cmv), reportNumber(u.metrics.resOp), reportNumber(u.metrics.lucroLiq), reportRatio(u.metrics.lucroLiq, u.metrics.recLiq), u.metrics.resultState.status === "complete" && !m.partial ? "Fontes sem pendências" : u.metrics.resultState.status === "unavailable" ? "Indisponível" : "Provisório"]))], 2);
  for (let r = 1; r <= report.months.reduce((s, m) => s + m.units.length, 0); r++) if (units[`G${r + 1}`]?.t === "n") units[`G${r + 1}`].z = '0.0%;[Red]-0.0%';
  sheet("Despesas principais", [[`Conta (${formatDrePeriod(report.selectedMonth)})`, "Valor R$"], ...report.principalExpenses.map(e => [e.account, e.amount])]);
  sheet("Análise e fontes", [["Competência / tema", "Observação"], ...report.analysis.map(text => ["Análise", text]),
    ...report.months.flatMap(m => [[formatDrePeriod(m.period), m.status], ...m.warnings.map(w => [formatDrePeriod(m.period), w]), [formatDrePeriod(m.period), `Caixa comprovado ${m.metrics.revenueSource.cashDifferenceCoveredDays}/${m.metrics.revenueSource.cashDifferenceTotalDays} dias-unidade; contagens pendentes ${m.metrics.revenueSource.pendingOperatorCount ?? "desconhecidas"}.`]])]);
  const reconciliation = report.cmvReconciliation;
  if (reconciliation) {
    const totals = reconciliation.totals;
    sheet("Ponte CMV", [["Componente", "R$"], ["Referência", reconciliation.basis],
      ["CMV estoque (DRE)", reconciliation.stockTotal], ["CMV fichas (analítico)", reconciliation.compositionTotal],
      ["Quantidade comparável", totals?.quantityEffect ?? null], ["Preço histórico versus ficha", totals?.priceEffect ?? null],
      ["Consumo sem quantidade prevista na mesma unidade", totals?.unplannedValue ?? null], ["Descartes", totals?.discardedValue ?? null],
      ["Divergências negativas", totals?.adjustedValue ?? null], ["Diferença", totals?.difference ?? null],
      ["Residual da ponte", reconciliation.residual], ["Situação", reconciliation.available ? "Conciliado; diferenças não determinam causas físicas" : reconciliation.reasons.join(" ")],
      ["Método", "Por unidade/ID-base: preço de referência=valor teórico/quantidade teórica. Quantidade=(consumo−teórico)×preço; preço=custo consumo−consumo×preço. Sem quantidade teórica, consumo em categoria separada. Sem equivalência por nome."],
      ["Custos iniciais", totals?.initialCostValue ?? null]]);
    sheet("Fontes CMV", [["Unidade", "Tipo", "ID base", "ID referência", "Data/hora (Belém)", "Origem", "Revisão", "Fingerprint snapshot/fichas", "Fingerprint vendas", "Preço aplicado", "Unidade medida"],
      ...reconciliation.references.map(r => [latest.units.find(u => u.id === r.kioskId)?.name ?? r.kioskId, r.kind, r.baseProductId, r.referenceId, formatDreDateTime(r.referenceAt), r.source, r.revision, r.sourceFingerprint, r.salesFingerprint, r.appliedPrice, r.unit])], 9);
    const unitRows = [...new Set(reconciliation.rows.map(r => r.kioskId))].map(id => ({ id, ...summarizeCmvReconciliation(reconciliation.rows.filter(r => r.kioskId === id)) }));
    const unitName = (id: string) => latest.units.find(u => u.id === id)?.name ?? id;
    sheet("CMV por unidade", [["Unidade", "Estoque", "Fichas", "Quantidade", "Preço", "Sem previsão", "Descartes", "Divergências", "Diferença"],
      ...unitRows.map(r => [unitName(r.id), r.consumedValue + r.discardedValue + r.adjustedValue, r.expectedValue, r.quantityEffect, r.priceEffect, r.unplannedValue, r.discardedValue, r.adjustedValue, r.difference])]);
    const ingredientsSheet = sheet("CMV insumos", [["Unidade", "ID base", "Insumo", "Unidade de medida", "Qtd esperada", "Qtd consumo", "Qtd descarte", "Qtd divergência", "Fichas R$", "Consumo R$", "Descarte R$", "Divergência R$", "Efeito quantidade R$", "Efeito preço R$", "Sem previsão R$", "Diferença R$", "Custo inicial R$", "Preço manual na ficha", "Preços manuais por unidade base"],
      ...reconciliation.rows.map(r => [unitName(r.kioskId), r.baseProductId, r.name, r.unit, r.expectedQty, r.consumedQty, r.discardedQty, r.adjustedQty, r.expectedValue, r.consumedValue, r.discardedValue, r.adjustedValue, r.quantityEffect, r.priceEffect, r.unplannedValue, r.difference, r.initialCostValue, r.overridePrice ? "Sim" : "Não", r.manualPrices.join("; ")])], 4);
    for (let row = 1; row <= reconciliation.rows.length; row++) for (let col = 4; col <= 7; col++) {
      const cell = ingredientsSheet[XLSX.utils.encode_cell({ r: row, c: col })]; if (cell?.t === "n") cell.z = '#,##0.000;[Red]-#,##0.000;0.000';
    }
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true });
}
