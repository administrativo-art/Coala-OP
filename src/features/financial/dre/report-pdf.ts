import { summarizeCmvReconciliation } from "./cmv-reconciliation";
import { PDFDocument, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import { applyCoalaLetterheadToPdf } from "@/features/hr/documents/letterhead-pdf.server";
import { DRE_REPORT_LINES, formatDrePeriod, formatDreDateTime, comparableDreMonths, reportRatio, reportVariation, type DreReport } from "./report";
const money = (v: number) => Number.isFinite(v) ? (Object.is(v, -0) ? 0 : v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "Indisponível";
const percentage = (v: number | null) => v === null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`;
/** PDF authoring stays within the official A4 letterhead safe area. */
export async function renderDreReportPdf(report: DreReport): Promise<Buffer> {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.12, .14, .18), muted = rgb(.38, .41, .46), accent = rgb(.77, .17, .44);
  let page: PDFPage; let y = 0;
  const safe = (value: string) => [...value.replace(/[\r\n\t]/g, " ")].filter(c => { try { font.encodeText(c); return true; } catch { return false; } }).join("");
  const draw = (text: string, x: number, yy: number, size = 9, strong = false, color = ink) => page.drawText(safe(text), { x, y: yy, size, font: strong ? bold : font, color });
  const addPage = () => { page = pdf.addPage([595.28, 841.89]); y = 780;
    draw("COALA SHAKES  /  FINANCEIRO", 40, y, 9, true, accent); y -= 24;
    draw(report.mode === "monthly" ? "Demonstrativo de resultado" : "DRE · evolução em 12 meses", 40, y, 19, true); y -= 17;
    draw(`${formatDrePeriod(report.months[0].period)} a ${formatDrePeriod(report.selectedMonth)} · CMV ${"por movimentação de estoque"}`, 40, y, 9, false, muted); y -= 24;
  };
  const ensure = (height: number) => { if (y - height < 105) addPage(); };
  const paragraph = (value: string, size = 9) => {
    const words = safe(value).split(/\s+/); let line = "";
    for (const word of words) { const next = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(next, size) > 510 && line) { ensure(14); draw(line, 40, y, size); y -= 14; line = word; } else line = next; }
    if (line) { ensure(14); draw(line, 40, y, size); y -= 14; } y -= 4;
  };
  const heading = (text: string) => { ensure(65); y -= 8; draw(text, 40, y, 12, true); y -= 19; };
  const table = (headers: string[], rows: string[][], widths: number[]) => {
    const header = () => { ensure(32); page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 19, color: rgb(.94, .94, .95) }); let x = 44; headers.forEach((h, i) => { draw(h, x, y, 8, true); x += widths[i]; }); y -= 23; };
    header(); rows.forEach((cells, index) => { if (y < 123) { addPage(); header(); }
      if (index % 2 === 0) page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 19, color: rgb(.985, .981, .976) });
      let x = 44; cells.forEach((cell, i) => { let text = safe(cell); let size = 8;
        if (i > 0) while (font.widthOfTextAtSize(text, size) > widths[i] - 8 && size > 6) size -= .25;
        if (font.widthOfTextAtSize(text, size) > widths[i] - 8) { while (font.widthOfTextAtSize(text + "…", size) > widths[i] - 8 && text.length > 2) text = text.slice(0, -1); text += "…"; }
        draw(text, x, y, size); x += widths[i]; }); y -= 20; }); y -= 7;
  };
  const chart = (title: string, values: Array<number | null>, percent = false) => {
    ensure(140); heading(title); const top = y; const baseline = top - 72; const valid = values.filter((v): v is number => v !== null);
    if (!valid.length) { paragraph("Sem valores disponíveis para este gráfico."); return; }
    const low = Math.min(0, ...valid), high = Math.max(0, ...valid), range = high - low || 1;
    const yy = (v: number) => baseline + (v - low) / range * 66; const dx = 440 / Math.max(1, values.length - 1);
    page.drawLine({ start: { x: 90, y: yy(0) }, end: { x: 540, y: yy(0) }, thickness: .5, color: muted });
    draw(percent ? percentage(high) : money(high), 40, yy(high) - 3, 7, false, muted);
    draw(percent ? percentage(low) : money(low), 40, yy(low) - 3, 7, false, muted);
    if (low < 0 && high > 0) draw(percent ? "0,0%" : "0,00", 40, yy(0) - 3, 7, false, muted);
    values.forEach((v, i) => { const x = 95 + i * dx; if (v !== null) { page.drawCircle({ x, y: yy(v), size: 2, color: accent });
      if (i && values[i - 1] !== null) page.drawLine({ start: { x: x - dx, y: yy(values[i - 1]!) }, end: { x, y: yy(v) }, color: accent, thickness: 1.5 }); }
      draw(formatDrePeriod(report.months[i].period, true), x - 10, baseline - 14, 7, false, muted); });
    y = baseline - 32;
  };
  addPage(); paragraph(`Unidades: ${report.scope}`); paragraph(`Gerado em ${formatDreDateTime(report.generatedAt)} · horário de Belém. Valores em R$.`);
  const latest = report.months.at(-1)!; paragraph(`${formatDrePeriod(latest.period)}: ${latest.status}. ${latest.partial ? "Competência em andamento." : ""}`);
  if (report.mode === "monthly") {
    heading("Resultado mensal e comparação"); if (latest.partial) paragraph(report.comparisonNote, 8); const compare = comparableDreMonths(latest, report.previous);
    table(["Linha", "R$ atual", "AV", "R$ anterior", "AH"], DRE_REPORT_LINES.map(([key, label, sign]) => [label, money(sign * latest.metrics[key]), percentage(reportRatio(sign * latest.metrics[key], latest.metrics.recLiq)), report.previous ? money(sign * report.previous.metrics[key]) : "—", compare ? percentage(reportVariation(sign * latest.metrics[key], sign * report.previous!.metrics[key])) : "—"]), [218, 88, 48, 88, 69]);
  } else {
    for (let offset = 0; offset < report.months.length; offset += 6) {
      if (offset) addPage();
      const block = report.months.slice(offset, offset + 6);
      heading(`DRE comparativa · ${formatDrePeriod(block[0].period)} a ${formatDrePeriod(block.at(-1)!.period)}`);
      table(["Linha (R$)", ...block.map(m => formatDrePeriod(m.period, true))], DRE_REPORT_LINES.map(([key, label, sign]) => [label, ...block.map(m => money(sign * m.metrics[key]))]), [185, ...block.map(() => 55)]);
    }
    addPage(); heading("Evolução mensal");
    table(["Competência", "Receita líquida", "Lucro líquido", "Margem", "Situação"], report.months.map(m => [formatDrePeriod(m.period), money(m.metrics.recLiq), money(m.metrics.lucroLiq), percentage(reportRatio(m.metrics.lucroLiq, m.metrics.recLiq)), m.status === "Fontes sem pendências de cálculo" ? "Sem pendências" : m.status]), [85, 115, 115, 65, 131]);
    chart("Receita líquida · R$", report.months.map(m => Number.isFinite(m.metrics.recLiq) ? m.metrics.recLiq : null));
    chart("Lucro líquido · R$", report.months.map(m => Number.isFinite(m.metrics.lucroLiq) ? m.metrics.lucroLiq : null));
    chart("Margem líquida", report.months.map(m => reportRatio(m.metrics.lucroLiq, m.metrics.recLiq)), true);
  }
  if (report.cmvReconciliation) {
    addPage(); heading("CMV · movimentações e fichas");
    const c = report.cmvReconciliation; paragraph("O resultado da DRE usa movimentação de estoque. A composição abaixo é referência analítica; a diferença não é automaticamente perda.");
    if (!c.available || !c.totals) paragraph(`Conciliação indisponível. ${c.reasons.join(" ")}`);
    else {
      paragraph(c.basis); const t = c.totals;
      table(["Referência / componente", "R$"], [["CMV por estoque (DRE)", money(c.stockTotal!)], ["CMV pelas fichas", money(c.compositionTotal!)],
        ["Diferença de quantidade comparável", money(t.quantityEffect)], ["Diferença de preço", money(t.priceEffect)],
        ["Consumo sem quantidade prevista na mesma loja", money(t.unplannedValue)], ["Descartes registrados", money(t.discardedValue)],
        ["Divergências negativas registradas", money(t.adjustedValue)], ["Diferença total conciliada", money(t.difference)]], [390, 125]);
      heading("Conciliação por quiosque");
      table(["Unidade", "Estoque", "Fichas", "Diferença"], [...new Set(c.rows.map(r => r.kioskId))].map(id => { const r = summarizeCmvReconciliation(c.rows.filter(r => r.kioskId === id));
        return [report.months.at(-1)!.units.find(u => u.id === id)?.name ?? id, money(r.consumedValue + r.discardedValue + r.adjustedValue), money(r.expectedValue), money(r.difference)]; }), [230, 95, 95, 95]);
      heading("Maiores diferenças por insumo e quiosque");
      const qty = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
      table(["Insumo / unidade", "Medida", "Esperado", "Consumo", "Dif. R$"], c.rows.slice(0, 10).map(r => [r.name + " / " + (report.months.at(-1)!.units.find(u => u.id === r.kioskId)?.name ?? r.kioskId), r.unit, qty(r.expectedQty), qty(r.consumedQty), money(r.difference)]), [260, 45, 70, 70, 70]);
      paragraph("Diferença total inclui consumo, descartes e divergências; quantidades da tabela são só consumo versus fichas. Não foram relacionados insumos diferentes por nome. Troca de embalagens é hipótese a conferir, não equivalência assumida.", 8);
      heading("Referências do CMV");
      for (const reference of c.references.filter(r => r.kind === "composition")) {
        const unit = report.months.at(-1)!.units.find(u => u.id === reference.kioskId)?.name ?? reference.kioskId;
        paragraph(`${unit}: ${reference.source}, revisão ${reference.revision ?? "não informada"}, referência ${formatDreDateTime(reference.referenceAt)} (Belém).`, 8);
        if (reference.sourceFingerprint) paragraph(`Fingerprint da referência: ${reference.sourceFingerprint}`, 7);
        if (reference.salesFingerprint) paragraph(`Fingerprint das vendas: ${reference.salesFingerprint}`, 7);
        const costs = c.references.filter(r => r.kind === "stock_cost" && r.kioskId === reference.kioskId);
        const dated = costs.filter(r => r.referenceAt).sort((a, b) => a.referenceAt!.localeCompare(b.referenceAt!));
        paragraph(`Custos: ${costs.length} referência(s); histórico de ${formatDreDateTime(dated[0]?.referenceAt)} a ${formatDreDateTime(dated.at(-1)?.referenceAt)}. Referência auditável: ${costs[0]?.referenceId ?? "não informada"}. Relação completa na aba Fontes CMV do Excel.`, 8);
      }
      if (c.rows.some(r => r.overridePrice)) {
        paragraph("Há preços manuais nas fichas; confirmar preço e unidade antes de interpretar a diferença.");
        c.rows.filter(r => r.overridePrice).slice(0, 4).forEach(r => paragraph(`${r.name}: preço(s) manual(is) equivalente(s) R$${r.manualPrices.map(money).join("; R$")}/${r.unit}.`, 8));
      }
      if (t.initialCostValue > 0) paragraph(`${c.rows.reduce((sum, r) => sum + r.initialCostCount, 0)} saída(s), R$${money(t.initialCostValue)}, usam custo inicial por falta de histórico anterior; validade histórica não comprovada.`);
      paragraph("Método: preço de referência ponderado=valor teórico/quantidade teórica por quiosque e ID de insumo; efeito quantidade ao preço de referência e efeito preço sobre o consumo. Quando não há quantidade teórica, o consumo é separado. Detalhamento completo no Excel.", 8);
    }
  }
  addPage(); heading("Análise e limites de comparação"); paragraph(report.comparisonNote);
  report.analysis.forEach(text => paragraph(text));
  heading("Comparação de quiosques");
  table(["Unidade", "Mês", "Rec. líquida", "Lucro líquido", "Margem", "Situação"], report.months.flatMap(m => m.units.map(u => [u.name, formatDrePeriod(m.period, true), money(u.metrics.recLiq), money(u.metrics.lucroLiq), percentage(reportRatio(u.metrics.lucroLiq, u.metrics.recLiq)), u.metrics.resultState.status === "unavailable" ? "Indisponível" : m.partial || u.metrics.resultState.status !== "complete" ? "Provisório" : "Sem pendências"])), [170, 52, 85, 85, 48, 75]);
  heading(`Principais despesas · ${formatDrePeriod(report.selectedMonth)}`);
  if (report.principalExpenses.length) table(["Conta", "R$"], report.principalExpenses.map(e => [e.account, money(e.amount)]), [390, 125]);
  else paragraph("Detalhes não disponíveis no escopo/permissões deste relatório.");
  heading("Fontes, cobertura e situação");
  for (const m of report.months) { paragraph(`${formatDrePeriod(m.period)} · ${m.status}. Caixa comprovado: ${m.metrics.revenueSource.cashDifferenceCoveredDays}/${m.metrics.revenueSource.cashDifferenceTotalDays} dias-unidade.`);
    for (const warning of m.warnings) paragraph(warning, 8); }
  if (report.permissionsNote) paragraph(report.permissionsNote);
  paragraph("Legenda: indisponível não é zero. AV usa receita líquida positiva; AH usa módulo do mês anterior e não existe com base zero. Resultados provisórios podem mudar.", 8);
  const pages = pdf.getPages(); pages.forEach((p, i) => p.drawText(`DRE v1 · ${i + 1}/${pages.length}`, { x: 40, y: 87, size: 8, font, color: muted }));
  pdf.setTitle("DRE · Coala Shakes"); pdf.setProducer("Coala One · DRE v1"); pdf.setCreationDate(new Date(report.generatedAt));
  return applyCoalaLetterheadToPdf(Buffer.from(await pdf.save()));
}
