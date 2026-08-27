import type { SalesReport, DPShiftDefinition } from '@/types';

export interface ShiftSuggestion {
  [shiftDefId: string]: number; // % sugerida (0–100)
}

export interface ShiftSuggestionOptions {
  /**
   * Unidade DP do quiosque-alvo. Quando informada, turnos cuja definição
   * pertence a OUTRA unidade (ex.: liderança ADM/CD que cobre vários quiosques)
   * não recebem meta de venda deste quiosque — ficam em 0% (monitorados).
   */
  kioskUnitId?: string;
}

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, segunda: 1, terca: 2, 'terça': 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6, 'sábado': 6,
};

/** daysOfWeek chega como número (0–6) OU nome em inglês/português — normaliza para número. */
function normalizeDays(days: Array<number | string> | undefined): Set<number> {
  const out = new Set<number>();
  for (const d of days ?? []) {
    if (typeof d === 'number') {
      if (d >= 0 && d <= 6) out.add(d);
    } else if (typeof d === 'string') {
      const n = DAY_NAME_TO_NUM[d.trim().toLowerCase()];
      if (n != null) out.add(n);
    }
  }
  return out;
}

function toMinutes(time?: string): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}

/** Janela(s) de trabalho do turno em minutos [início, fim), descontando o intervalo. */
function shiftRanges(def: DPShiftDefinition): Array<[number, number]> {
  const start = toMinutes(def.startTime);
  let end = toMinutes(def.endTime);
  if (start == null || end == null) return [];
  if (end <= start) end += 24 * 60; // segurança p/ turno que cruza a meia-noite
  const breakStart = toMinutes(def.breakStart);
  const breakEnd = toMinutes(def.breakEnd);
  if (breakStart != null && breakEnd != null && breakEnd > breakStart && breakStart >= start && breakEnd <= end) {
    return [[start, breakStart], [breakEnd, end]];
  }
  return [[start, end]];
}

/** Minutos (0–60) da hora `hour` cobertos pela janela do turno. */
function hourCoverageMinutes(ranges: Array<[number, number]>, hour: number): number {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  let covered = 0;
  for (const [a, b] of ranges) {
    covered += Math.max(0, Math.min(b, hourEnd) - Math.max(a, hourStart));
  }
  return covered;
}

/** Receita real por hora do relatório: Σ productHourlySales[sid][hora] × preço unitário. */
function reportHourRevenue(report: SalesReport): Map<number, number> {
  const revenue = new Map<number, number>();

  const productHourly = report.productHourlySales ?? {};
  if (Object.keys(productHourly).length > 0) {
    const priceBySim: Record<string, number> = {};
    for (const item of report.items ?? []) {
      if (item.simulationId && item.unitPrice != null) priceBySim[item.simulationId] = item.unitPrice;
    }
    for (const [simId, hourly] of Object.entries(productHourly)) {
      const price = priceBySim[simId] ?? 0;
      if (!price) continue;
      for (const [hourStr, qty] of Object.entries(hourly as Record<string, number>)) {
        const hour = parseInt(hourStr);
        revenue.set(hour, (revenue.get(hour) ?? 0) + (qty as number) * price);
      }
    }
    if (revenue.size > 0) return revenue;
  }

  // Fallback (relatórios antigos sem productHourlySales): hourlySales é CONTAGEM DE
  // CUPONS por hora — não é receita, mas serve como proxy da forma da distribuição.
  for (const [hourStr, coupons] of Object.entries(report.hourlySales ?? {})) {
    const hour = parseInt(hourStr);
    revenue.set(hour, (revenue.get(hour) ?? 0) + (coupons as number));
  }
  return revenue;
}

/**
 * Distribui a meta entre os turnos pela receita real gerada dentro da JANELA de cada
 * turno (start/end reais), respeitando os dias da semana. Horas cobertas por mais de
 * um turno são rateadas proporcionalmente aos minutos que cada um cobre.
 */
export function computeShiftSuggestion(
  salesReports: SalesReport[],
  shiftGroups: Array<{ id: string; def: DPShiftDefinition }>,
  options: ShiftSuggestionOptions = {}
): ShiftSuggestion | null {
  const { kioskUnitId } = options;

  const groups = shiftGroups.map(g => ({
    id: g.id,
    ranges: shiftRanges(g.def),
    days: normalizeDays(g.def.daysOfWeek),
    fromOtherUnit: Boolean(kioskUnitId && g.def.unitId && g.def.unitId !== kioskUnitId),
  }));

  // Só aplica a exclusão por unidade se sobrar ao menos um turno do próprio quiosque;
  // senão (mapeamento de unidade falhou) mantém todos para não zerar a sugestão.
  const hasOwnUnitShift = groups.some(g => !g.fromOtherUnit);
  const included = groups.map(g => ({ ...g, excluded: g.fromOtherUnit && hasOwnUnitShift }));

  const revenueByShift: Record<string, number> = {};
  for (const g of shiftGroups) revenueByShift[g.id] = 0;

  for (const report of salesReports) {
    const dow = new Date(report.year, report.month - 1, report.day ?? 1).getDay();
    const hourRevenue = reportHourRevenue(report);

    for (const [hour, revenue] of hourRevenue) {
      if (!revenue) continue;

      const coverages: Array<[string, number]> = [];
      let totalCoverage = 0;
      for (const g of included) {
        if (g.excluded || !g.days.has(dow)) continue;
        const coverage = hourCoverageMinutes(g.ranges, hour);
        if (coverage > 0) {
          coverages.push([g.id, coverage]);
          totalCoverage += coverage;
        }
      }
      if (totalCoverage === 0) continue; // receita numa hora sem turno cadastrado → não atribuída

      for (const [id, coverage] of coverages) {
        revenueByShift[id] += revenue * (coverage / totalCoverage);
      }
    }
  }

  const total = Object.values(revenueByShift).reduce((sum, v) => sum + v, 0);
  if (total < 1) return null;

  const suggestion: ShiftSuggestion = {};
  for (const g of shiftGroups) {
    suggestion[g.id] = (revenueByShift[g.id] / total) * 100;
  }
  return suggestion;
}
