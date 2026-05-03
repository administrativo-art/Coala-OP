import type { SalesReport, DPShiftDefinition } from '@/types';

type ShiftClass = 'manha' | 'tarde' | 'domingo';

export interface ShiftSuggestion {
  [shiftDefId: string]: number; // % sugerida (0–100)
}

export function classifyShiftDef(def: DPShiftDefinition): ShiftClass {
  const sundayOnly =
    def.daysOfWeek.length > 0 && def.daysOfWeek.every(d => d === 0);
  if (sundayOnly) return 'domingo';
  const startHour = parseInt(def.startTime?.split(':')[0] ?? '0');
  return startHour < 14 ? 'manha' : 'tarde';
}

export function computeShiftSuggestion(
  salesReports: SalesReport[],
  shiftGroups: Array<{ id: string; def: DPShiftDefinition }>
): ShiftSuggestion | null {
  const stats = { manha: 0, tarde: 0, domingo: 0 };

  for (const report of salesReports) {
    const isSunday =
      new Date(report.year, report.month - 1, report.day ?? 1).getDay() === 0;

    // Preferência: hourlySales já contém receita total por hora (mais simples e confiável)
    if (report.hourlySales && Object.keys(report.hourlySales).length > 0) {
      for (const [hourStr, revenue] of Object.entries(report.hourlySales)) {
        if (isSunday) stats.domingo += revenue;
        else if (parseInt(hourStr) < 14) stats.manha += revenue;
        else stats.tarde += revenue;
      }
    } else {
      // Fallback: productHourlySales × preço unitário
      const priceMap = Object.fromEntries(
        (report.items ?? [])
          .filter(i => i.simulationId && i.unitPrice != null)
          .map(i => [i.simulationId, i.unitPrice!])
      );
      for (const [simId, hourly] of Object.entries(report.productHourlySales ?? {})) {
        const price = priceMap[simId] ?? 0;
        for (const [hourStr, qty] of Object.entries(hourly)) {
          const revenue = (qty as number) * price;
          if (isSunday) stats.domingo += revenue;
          else if (parseInt(hourStr) < 14) stats.manha += revenue;
          else stats.tarde += revenue;
        }
      }
    }
  }

  const total = stats.manha + stats.tarde + stats.domingo;
  if (total < 1) return null;

  const byClass: Record<ShiftClass, string[]> = { manha: [], tarde: [], domingo: [] };
  for (const g of shiftGroups) {
    byClass[classifyShiftDef(g.def)].push(g.id);
  }

  const suggestion: ShiftSuggestion = {};
  for (const cls of ['manha', 'tarde', 'domingo'] as ShiftClass[]) {
    const ids = byClass[cls];
    if (ids.length === 0) continue;
    const classPct = (stats[cls] / total) * 100;
    const perGroup = classPct / ids.length;
    for (const id of ids) suggestion[id] = perGroup;
  }

  return suggestion;
}
