/** Pure replenishment policy shared by the scheduled job and the application. */
export type SupplyMode = 'cd' | 'direct';
export type CalculationStatus = 'calculated' | 'pending' | 'partial' | 'no_dependents';
export type DemandSource = 'pdv_internal' | 'transfer_proxy' | 'none';
export type DemandDay = { date: string; quantity: number; usable: boolean };

export type ReplenishmentResult = {
  target: number | null;
  meanDaily: number | null;
  validDays: number;
  source: DemandSource;
  calculationStatus: CalculationStatus;
  sourceLimitation: string;
};

export function belemDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function historyStart(now: Date): string {
  const today = belemDate(now);
  const epoch = Date.parse(`${today}T12:00:00Z`);
  return new Date(epoch - 180 * 86_400_000).toISOString().slice(0, 10);
}

export function historyEnd(now: Date): string {
  const today = belemDate(now);
  return new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function effectiveLeadTime(mode: SupplyMode, configured: number | undefined, isSupplyUnit = false): number | null {
  if (mode === 'cd') return isSupplyUnit && Number.isFinite(configured) && (configured ?? 0) > 0 ? configured! : 2;
  return Number.isFinite(configured) && (configured ?? 0) > 0 ? configured! : null;
}

export function physicalShortage(target: number | null, available: number): number | null {
  return target === null || !Number.isFinite(target) || target < 0 || !Number.isFinite(available)
    ? null : Math.max(0, target - Math.max(0, available));
}

/** Missing days never become zeroes. One entry per valid calendar day is required. */
export function calculateReplenishment(input: {
  days: readonly DemandDay[];
  cycleDays: 15 | 30;
  unit: string;
  source: DemandSource;
  isSupplyUnit?: boolean;
  servedUnitCount?: number;
  minimumValidDays?: number;
}): ReplenishmentResult {
  if (input.isSupplyUnit && input.servedUnitCount === 0) {
    return { target: 0, meanDaily: 0, validDays: 0, source: 'none',
      calculationStatus: 'no_dependents', sourceLimitation: 'Nenhuma unidade atendida por este insumo.' };
  }
  const grouped = new Map<string, number>();
  for (const day of input.days) {
    if (!day.usable || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(day.quantity) || day.quantity < 0) continue;
    grouped.set(day.date, (grouped.get(day.date) ?? 0) + day.quantity);
  }
  const validDays = grouped.size;
  const minimum = input.minimumValidDays ?? (input.source === 'pdv_internal' ? 14 : 1);
  if (input.source === 'none' || validDays < minimum) {
    return { target: null, meanDaily: null, validDays, source: input.source,
      calculationStatus: validDays > 0 ? 'partial' : 'pending',
      sourceLimitation: input.source === 'pdv_internal'
        ? `Somente ${validDays} dias internos utilizáveis; mínimo ${minimum}. Completude externa do PDV não comprovada.`
        : 'Histórico de transferências concluídas insuficiente; consumo físico não comprovado.' };
  }
  const meanDaily = [...grouped.values()].reduce((sum, n) => sum + n, 0) / validDays;
  const raw = meanDaily * input.cycleDays * 1.3;
  const target = input.unit === 'un' ? Math.ceil(raw) : Math.round(raw * 100) / 100;
  return { target, meanDaily: Math.round(meanDaily * 10_000) / 10_000, validDays,
    source: input.source, calculationStatus: 'calculated',
    sourceLimitation: input.source === 'pdv_internal'
      ? 'Reconciliação interna somente; completude da fonte externa do PDV não comprovada.'
      : 'Transferências concluídas são proxy de abastecimento, não consumo físico.' };
}
