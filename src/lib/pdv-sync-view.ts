import { eachDayOfInterval, endOfMonth, format, startOfMonth, startOfYear, subDays } from 'date-fns';

export type SyncDiagnostics = {
  couponsReceived: number;
  couponsCancelled: number;
  couponsWithoutItems: number;
  itemsSeen: number;
  itemsCancelled: number;
  itemsMapped: number;
  itemsUnmapped: number;
  itemsZeroValue: number;
  unmappedSkus: { sku: string; name: string; count: number }[];
};

export type SyncLog = {
  date: string;
  kioskName: string;
  status: 'pending' | 'loading' | 'success' | 'error';
  revenue?: number;
  errorMessage?: string;
  errorCode?: string;
  diagnostics?: SyncDiagnostics;
  warnings?: string[];
};

export type SyncPreset = 'week' | '90days' | 'month' | 'year';

const ISO = 'yyyy-MM-dd';

export const SYNC_PRESETS: ReadonlyArray<{ id: SyncPreset; label: (now: Date) => string }> = [
  { id: 'week', label: () => 'Últimos 7 dias' },
  { id: 'month', label: () => 'Mês atual' },
  { id: '90days', label: () => 'Últimos 90 dias' },
  { id: 'year', label: (now) => `Desde jan/${now.getFullYear()}` },
];

/** Intervalo (datas ISO) de cada atalho de período. */
export function syncPresetRange(preset: SyncPreset, now: Date): { start: string; end: string } {
  switch (preset) {
    case 'week':
      return { start: format(subDays(now, 7), ISO), end: format(now, ISO) };
    case 'month':
      return { start: format(startOfMonth(now), ISO), end: format(endOfMonth(now), ISO) };
    case '90days':
      return { start: format(subDays(now, 90), ISO), end: format(now, ISO) };
    case 'year':
      return { start: format(startOfYear(now), ISO), end: format(now, ISO) };
  }
}

/** Valida o intervalo; devolve a mensagem para o campo ou `null`. */
export function validateSyncRange(startDate: string, endDate: string): string | null {
  if (!startDate || !endDate) return 'Informe a data inicial e a final.';
  if (new Date(`${startDate}T12:00:00Z`) > new Date(`${endDate}T12:00:00Z`)) {
    return 'A data inicial não pode ser maior que a final.';
  }
  return null;
}

/** Dias do intervalo, no mesmo critério usado pela sincronização (meio-dia UTC). */
export function syncRangeDays(startDate: string, endDate: string): Date[] {
  return eachDayOfInterval({ start: new Date(`${startDate}T12:00:00Z`), end: new Date(`${endDate}T12:00:00Z`) });
}

export function summarizeSyncLogs(logs: SyncLog[]) {
  const done = logs.filter((log) => log.status === 'success' || log.status === 'error');
  const errorDays = done.filter((log) => log.status === 'error').length;
  const warnDays = done.filter((log) => !!log.warnings?.length).length;
  return {
    finished: done.length,
    revenue: done.reduce((sum, log) => sum + (log.revenue ?? 0), 0),
    coupons: done.reduce((sum, log) => sum + (log.diagnostics?.couponsReceived ?? 0), 0),
    mapped: done.reduce((sum, log) => sum + (log.diagnostics?.itemsMapped ?? 0), 0),
    unmapped: done.reduce((sum, log) => sum + (log.diagnostics?.itemsUnmapped ?? 0), 0),
    errorDays,
    warnDays,
    healthy: errorDays === 0 && warnDays === 0,
  };
}

/** Pendência = falha ou alerta; o filtro "Com pendências" do andamento usa esta regra. */
export function logHasIssue(log: SyncLog): boolean {
  return log.status === 'error' || (log.status === 'success' && !!log.warnings?.length);
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
