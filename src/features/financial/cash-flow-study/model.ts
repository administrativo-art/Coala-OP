/**
 * Estudo de fluxo de caixa: cálculo puro, sem acesso a banco, compartilhado entre servidor (montagem)
 * e tela (recorte por período). Regras em docs/planos/plano-estudo-fluxo-caixa.md.
 *
 * O estudo projeta de hoje até o fim do sexto mês seguinte. A tela escolhe o período e a granularidade
 * (dia, semana ou mês); o saldo é sempre calculado desde hoje.
 */

export const HORIZON_MONTHS = 6;
export const HISTORY_DAYS = 90;
/** Semanas passadas usadas para medir o acerto da média de vendas. */
export const BACKTEST_WEEKS = 8;
/** Meses fechados mostrados na aba Saúde (além do mês corrente). */
export const HEALTH_MONTHS = 6;
/** Taxas praticadas usadas para projetar vendas futuras já líquidas (Pix truncado em 0,75%). */
export const PROJECTED_FEE_RATE = { pix: 0.0075, debit_card: 0.0146, credit_card: 0.0222 } as const;
/** Dias da venda até o dinheiro estar disponível, por forma de pagamento de maquininha. */
export const CARD_SETTLEMENT_DAYS = { pix: 0, debit_card: 1, credit_card: 30 } as const;
/** Espécie: fechamento (14) + lote/boleto (7) + pagamento do boleto (3), até a unidade ter histórico. */
export const DEFAULT_CASH_LAG_DAYS = 24;
export const COUNTED_TO_BANK_DAYS = 10;
export const BOLETO_TO_BANK_DAYS = 3;
export const MIN_PAID_BATCHES_FOR_UNIT_LAG = 4;
/** Dias parado a partir dos quais um valor já vendido pede ação (aguardando contagem / contado sem boleto). */
export const STUCK_AFTER_DAYS = { cash_open: 2, counted: 3 } as const;
/** Saídas recorrentes: categoria presente em pelo menos N dos 3 meses fechados. */
export const RECURRING_MIN_MONTHS = 2;
/** Categoria com muitos lançamentos por mês vira média semanal em vez de uma data no mês. */
export const RECURRING_WEEKLY_MIN_TX = 6;
/** Resíduo abaixo desta fração da média é considerado já coberto. */
export const RECURRING_RESIDUAL_MIN_SHARE = 0.2;
export const UNCLASSIFIED_KEY = "__sem_classificacao__";

export type SalesChannel = "cash" | "pix" | "debit_card" | "credit_card";
const CHANNELS: SalesChannel[] = ["cash", "pix", "debit_card", "credit_card"];

export type StudyClosure = {
  kioskId: string; kioskName: string; date: string; status: string;
  byChannelCents: Record<SalesChannel, number>;
  depositStatus: string; depositEligibleCents: number;
};
export type StudyBatch = {
  id: string; kioskId: string; kioskName: string; status: string; totalCents: number;
  periodStartDate: string; periodEndDate: string; issuedAt: string | null; paidAt: string | null;
};
export type StudyStoneParcel = { dueDate: string; grossCents: number; netCents: number; feeCents: number | null };
export type StudyCategory = { id: string | null; name: string };
export type StudyExpense = {
  id: string; description: string; supplier: string | null; date: string | null; amountCents: number; provisioned: boolean;
  category: StudyCategory | null;
};
/** Movimento realizado da conta. `transfer` = entre contas próprias: muda o saldo, não conta como entrada nem saída. */
export type StudyRealized = { date: string; direction: "in" | "out"; amountCents: number; category: StudyCategory | null; transfer: boolean };
export type StudyAccount = { id: string; name: string; kind: "operating" | "reserve"; cents: number | null; at: string | null };

export type StudyInputs = {
  today: string;
  accounts: StudyAccount[];
  stone: StudyStoneParcel[];
  batches: StudyBatch[];
  closures: StudyClosure[];
  expenses: StudyExpense[];
  realized: StudyRealized[];
};

export type EntrySource = "deposit_boleto" | "deposit_counted" | "cash_open" | "stone" | "sales_projected" | "expense" | "expense_forecast" | "expense_recurring";
/** Etapa do dinheiro já vendido até chegar à conta. */
export type EntryStage = "cash_open" | "counted" | "boleto" | "stone" | "projected";
export type EntryCertainty = "guaranteed" | "projected" | "payable" | "provisioned" | "recurring";
export type StudyEntry = {
  id: string; date: string; direction: "in" | "out"; source: EntrySource;
  /** Garantido = já existe; projetado/recorrente = média de 3 meses; a pagar/provisionada = despesa lançada. */
  certainty: EntryCertainty;
  label: string; detail: string; amountCents: number; overdue?: boolean;
  stage?: EntryStage;
  unit?: { id: string; name: string };
  /** Desde quando o valor espera a próxima etapa (data da venda, do lote ou da emissão). */
  sinceDate?: string;
  /** Data em que devia ter caído; o valor é contado hoje. */
  lateFrom?: string;
};
export type StudyUnit = {
  kioskId: string; kioskName: string; openCents: number; countedCents: number; boletoCents: number;
  batchPeriod: string | null; eta: string | null; lagDays: number | null; lagFromHistory: boolean;
};

export type HealthMonth = { month: string; inCents: number; outCents: number; endBalanceCents: number | null; partial: boolean };
export type HealthLagUnit = { kioskId: string; kioskName: string; paidBatches: number; avgDays: number; maxDays: number };
export type HealthAccuracyWeek = { weekStart: string; predictedCents: number; actualCents: number };
export type HealthPayment = { channel: SalesChannel; shareRatio: number; feeRate: number; settlementDays: number };
export type StudyHealth = {
  months: HealthMonth[];
  weeklyOutCents: number | null;
  runwayWeeks: number | null;
  runwayWithReserveWeeks: number | null;
  surplusCents: number | null;
  outInRatio: number | null;
  cashLagDays: number | null;
  lagUnits: HealthLagUnit[];
  accuracy: HealthAccuracyWeek[];
  accuracyAvg: number | null;
  payments: HealthPayment[];
  monthlySalesCents: number;
  feeRate: number | null;
};

export type StudyResult = {
  asOf: string;
  horizonEnd: string;
  accounts: StudyAccount[];
  /** Saldo das contas operacionais lidas; nulo quando nenhuma pôde ser lida. */
  startBalanceCents: number | null;
  /** Soma das contas de reserva (investimento); fora do caixa por padrão. */
  reserveCents: number;
  balanceAt: string | null;
  minimumCents: number | null;
  entries: StudyEntry[];
  units: StudyUnit[];
  health: StudyHealth;
  gaps: string[];
};

// ---------- datas (YYYY-MM-DD, sem fuso) ----------
const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number) => new Date(toTime(date) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY);
const weekday = (date: string) => new Date(toTime(date)).getUTCDay();
export function weekStart(date: string) {
  const day = weekday(date);
  return addDays(date, day === 0 ? -6 : 1 - day);
}
export function addMonths(month: string, count: number) {
  const [year, value] = month.split("-").map(Number);
  const index = year * 12 + (value - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
export const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);
export const horizonEndFor = (today: string) => monthEnd(addMonths(today.slice(0, 7), HORIZON_MONTHS));
const maxDate = (a: string, b: string) => (a > b ? a : b);
const clampToToday = (date: string, today: string) => maxDate(date, today);

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
const sumChannels = (by: Record<SalesChannel, number>) => CHANNELS.reduce((sum, channel) => sum + (by[channel] ?? 0), 0);

// ---------- prazo do espécie ----------
function batchLagDays(batch: StudyBatch) {
  if (batch.status !== "paid" || !batch.paidAt) return null;
  const midpoint = addDays(batch.periodStartDate, Math.floor(daysBetween(batch.periodStartDate, batch.periodEndDate) / 2));
  const lag = daysBetween(midpoint, batch.paidAt.slice(0, 10));
  return lag >= 0 && lag < 365 ? lag : null;
}
export function cashLagByUnit(batches: StudyBatch[]) {
  const lags = new Map<string, number[]>();
  const names = new Map<string, string>();
  for (const batch of batches) {
    const lag = batchLagDays(batch);
    if (lag === null) continue;
    lags.set(batch.kioskId, [...(lags.get(batch.kioskId) ?? []), lag]);
    names.set(batch.kioskId, batch.kioskName);
  }
  const all = [...lags.values()].flat();
  return {
    of(kioskId: string) {
      const list = lags.get(kioskId) ?? [];
      return list.length >= MIN_PAID_BATCHES_FOR_UNIT_LAG
        ? { days: Math.round(mean(list)!), fromHistory: true }
        : { days: DEFAULT_CASH_LAG_DAYS, fromHistory: false };
    },
    units: [...lags.entries()].map(([kioskId, list]): HealthLagUnit => ({
      kioskId, kioskName: names.get(kioskId) ?? kioskId, paidBatches: list.length, avgDays: Math.round(mean(list)!), maxDays: Math.max(...list),
    })).sort((a, b) => a.kioskName.localeCompare(b.kioskName, "pt-BR")),
    network: all.length ? Math.round(mean(all)!) : null,
    paidCount: all.length,
  };
}

const OPEN_CLOSURE = new Set(["not_synced", "draft", "pending_review", "reopened", "sync_error"]);
const BOLETO_BATCH = new Set(["issuing", "issued"]);
const COUNTED_BATCH = new Set(["open", "locked", "failed"]);

// ---------- média de vendas por dia da semana ----------
/** Média por dia da semana dos 90 dias anteriores a `asOf` (exclusivo). */
export function weekdaySalesAverage(closures: StudyClosure[], asOf: string) {
  const from = addDays(asOf, -HISTORY_DAYS);
  const byDate = new Map<string, Record<SalesChannel, number>>();
  for (const closure of closures) {
    if (closure.date < from || closure.date >= asOf) continue;
    const day = byDate.get(closure.date) ?? { cash: 0, pix: 0, debit_card: 0, credit_card: 0 };
    for (const channel of CHANNELS) day[channel] += Math.max(0, closure.byChannelCents[channel] ?? 0);
    byDate.set(closure.date, day);
  }
  const sums = Array.from({ length: 7 }, () => ({ cash: 0, pix: 0, debit_card: 0, credit_card: 0, days: 0 }));
  for (const [date, totals] of byDate) {
    const bucket = sums[weekday(date)];
    bucket.days += 1;
    for (const channel of CHANNELS) bucket[channel] += totals[channel];
  }
  return {
    days: byDate.size,
    of(date: string): Record<SalesChannel, number> {
      const bucket = sums[weekday(date)];
      if (!bucket.days) return { cash: 0, pix: 0, debit_card: 0, credit_card: 0 };
      return Object.fromEntries(CHANNELS.map(channel => [channel, Math.round(bucket[channel] / bucket.days)])) as Record<SalesChannel, number>;
    },
  };
}

/** Quanto a média previa para cada semana passada e quanto as vendas de fato somaram. */
export function backtestSalesAccuracy(closures: StudyClosure[], today: string): HealthAccuracyWeek[] {
  const thisWeek = weekStart(today);
  const result: HealthAccuracyWeek[] = [];
  for (let back = BACKTEST_WEEKS; back >= 1; back -= 1) {
    const start = addDays(thisWeek, -7 * back);
    const average = weekdaySalesAverage(closures, start);
    if (average.days < 28) continue;
    let predicted = 0;
    for (let offset = 0; offset < 7; offset += 1) predicted += sumChannels(average.of(addDays(start, offset)));
    const days = new Map<string, number>();
    for (const closure of closures) {
      if (closure.date < start || closure.date > addDays(start, 6)) continue;
      days.set(closure.date, (days.get(closure.date) ?? 0) + sumChannels(closure.byChannelCents));
    }
    if (days.size < 5 || predicted <= 0) continue;
    result.push({ weekStart: start, predictedCents: predicted, actualCents: [...days.values()].reduce((sum, value) => sum + value, 0) });
  }
  return result;
}

const CHANNEL_LABEL: Record<SalesChannel, string> = { cash: "espécie", pix: "Pix", debit_card: "débito", credit_card: "crédito" };
const categoryKey = (category: StudyCategory | null) => (category ? category.id ?? `nome:${category.name.trim().toLowerCase()}` : UNCLASSIFIED_KEY);

// ---------- saídas recorrentes pela média ----------
type CategoryHistory = { key: string; name: string; months: Map<string, { cents: number; count: number; days: number[] }> };

/**
 * Para cada categoria que saiu em pelo menos 2 dos 3 últimos meses fechados, projeta a média no que ainda
 * não está coberto por despesa lançada (ou já paga neste mês). Categoria com muitos lançamentos vira média semanal.
 */
export function projectRecurringOutflows(input: Pick<StudyInputs, "today" | "realized" | "expenses">, horizonEnd: string): StudyEntry[] {
  const { today } = input;
  const currentMonth = today.slice(0, 7);
  const window = [-3, -2, -1].map(offset => addMonths(currentMonth, offset));
  const categories = new Map<string, CategoryHistory>();
  for (const row of input.realized) {
    if (row.direction !== "out" || row.transfer) continue;
    const month = row.date.slice(0, 7);
    if (!window.includes(month)) continue;
    const key = categoryKey(row.category);
    const history = categories.get(key) ?? { key, name: row.category?.name ?? "Saídas sem classificação", months: new Map() };
    const bucket = history.months.get(month) ?? { cents: 0, count: 0, days: [] };
    bucket.cents += row.amountCents; bucket.count += 1; bucket.days.push(Number(row.date.slice(8, 10)));
    history.months.set(month, bucket);
    categories.set(key, history);
  }
  const monthsWithData = window.filter(month => [...categories.values()].some(history => history.months.has(month))).length;
  if (!monthsWithData) return [];

  const launched = input.expenses.filter(expense => expense.date && expense.amountCents > 0)
    .map(expense => ({ key: categoryKey(expense.category), date: clampToToday(expense.date!, today), cents: expense.amountCents }));
  const paidThisMonth = input.realized.filter(row => row.direction === "out" && !row.transfer && row.date.startsWith(currentMonth) && row.date <= today)
    .map(row => ({ key: categoryKey(row.category), date: row.date, cents: row.amountCents }));
  const inRange = (list: Array<{ key: string; date: string; cents: number }>, key: string, from: string, to: string) =>
    list.filter(item => item.key === key && item.date >= from && item.date <= to).reduce((sum, item) => sum + item.cents, 0);

  const entries: StudyEntry[] = [];
  for (const history of categories.values()) {
    if (history.months.size < RECURRING_MIN_MONTHS) continue;
    const total = [...history.months.values()].reduce((sum, bucket) => sum + bucket.cents, 0);
    const average = total / monthsWithData;
    if (average <= 0) continue;
    const perMonthCount = [...history.months.values()].reduce((sum, bucket) => sum + bucket.count, 0) / history.months.size;
    const detail = "Média dos últimos 3 meses · ainda sem despesa lançada";
    if (perMonthCount >= RECURRING_WEEKLY_MIN_TX) {
      const weekly = average / (52 / 12);
      for (let start = weekStart(today); start <= horizonEnd; start = addDays(start, 7)) {
        const end = addDays(start, 6);
        const covered = inRange(launched, history.key, start, end) + inRange(paidThisMonth, history.key, start, end);
        const residual = Math.round(weekly - covered);
        if (residual < weekly * RECURRING_RESIDUAL_MIN_SHARE) continue;
        const date = clampToToday(addDays(start, 2), today);
        if (date > horizonEnd) continue;
        entries.push({ id: `recurring:${history.key}:${start}`, date, direction: "out", source: "expense_recurring", certainty: "recurring", label: history.name, detail, amountCents: residual });
      }
      continue;
    }
    const days = [...history.months.values()].flatMap(bucket => bucket.days).sort((a, b) => a - b);
    const typicalDay = Math.min(28, days[Math.floor(days.length / 2)]);
    for (let month = currentMonth; `${month}-01` <= horizonEnd; month = addMonths(month, 1)) {
      const covered = inRange(launched, history.key, `${month}-01`, monthEnd(month)) + (month === currentMonth ? inRange(paidThisMonth, history.key, `${month}-01`, today) : 0);
      const residual = Math.round(average - covered);
      if (residual < average * RECURRING_RESIDUAL_MIN_SHARE) continue;
      const date = clampToToday(`${month}-${String(typicalDay).padStart(2, "0")}`, today);
      if (date > horizonEnd) continue;
      entries.push({ id: `recurring:${history.key}:${month}`, date, direction: "out", source: "expense_recurring", certainty: "recurring", label: history.name, detail, amountCents: residual });
    }
  }
  return entries;
}

// ---------- saúde ----------
function buildHealth(input: StudyInputs, lag: ReturnType<typeof cashLagByUnit>, startBalance: number | null, reserveCents: number): StudyHealth {
  const { today } = input;
  const currentMonth = today.slice(0, 7);
  const monthKeys = Array.from({ length: HEALTH_MONTHS + 1 }, (_, index) => addMonths(currentMonth, index - HEALTH_MONTHS));
  const months: HealthMonth[] = monthKeys.map(month => ({ month, inCents: 0, outCents: 0, endBalanceCents: null, partial: month === currentMonth }));
  for (const row of input.realized) {
    if (row.transfer) continue;
    const bucket = months.find(item => item.month === row.date.slice(0, 7));
    if (!bucket) continue;
    if (row.direction === "in") bucket.inCents += row.amountCents; else bucket.outCents += row.amountCents;
  }
  if (startBalance !== null) {
    for (const bucket of months) {
      const end = monthEnd(bucket.month);
      if (end >= today) { bucket.endBalanceCents = bucket.partial ? startBalance : null; continue; }
      const after = input.realized.filter(row => row.date > end && row.date <= today).reduce((sum, row) => sum + (row.direction === "in" ? row.amountCents : -row.amountCents), 0);
      bucket.endBalanceCents = startBalance - after;
    }
  }
  const full = months.filter(month => !month.partial && (month.inCents > 0 || month.outCents > 0));
  const last3 = full.slice(-3);
  const weeklyOutCents = last3.length ? Math.round(last3.reduce((sum, month) => sum + month.outCents, 0) / (last3.length * 52 / 12)) : null;
  const totalIn = last3.reduce((sum, month) => sum + month.inCents, 0);
  const totalOut = last3.reduce((sum, month) => sum + month.outCents, 0);

  const sales = new Map<SalesChannel, number>(CHANNELS.map(channel => [channel, 0]));
  const salesFrom = addDays(today, -HISTORY_DAYS);
  const salesDays = new Set<string>();
  for (const closure of input.closures) {
    if (closure.date < salesFrom || closure.date >= today) continue;
    salesDays.add(closure.date);
    for (const channel of CHANNELS) sales.set(channel, (sales.get(channel) ?? 0) + Math.max(0, closure.byChannelCents[channel] ?? 0));
  }
  const salesTotal = [...sales.values()].reduce((sum, value) => sum + value, 0);
  const cashLag = lag.network ?? DEFAULT_CASH_LAG_DAYS;
  const payments: HealthPayment[] = salesTotal > 0 ? CHANNELS.map(channel => ({
    channel, shareRatio: (sales.get(channel) ?? 0) / salesTotal,
    feeRate: channel === "cash" ? 0 : PROJECTED_FEE_RATE[channel],
    settlementDays: channel === "cash" ? cashLag : CARD_SETTLEMENT_DAYS[channel],
  })) : [];
  const accuracy = backtestSalesAccuracy(input.closures, today);
  const accuracyErrors = accuracy.map(week => (week.actualCents - week.predictedCents) / week.predictedCents);

  return {
    months, weeklyOutCents,
    runwayWeeks: startBalance !== null && weeklyOutCents ? startBalance / weeklyOutCents : null,
    runwayWithReserveWeeks: startBalance !== null && weeklyOutCents ? (startBalance + reserveCents) / weeklyOutCents : null,
    surplusCents: last3.length ? Math.round((totalIn - totalOut) / last3.length) : null,
    outInRatio: totalIn > 0 ? totalOut / totalIn : null,
    cashLagDays: lag.network, lagUnits: lag.units,
    accuracy, accuracyAvg: accuracyErrors.length ? mean(accuracyErrors) : null,
    payments, monthlySalesCents: Math.round(salesTotal / (HISTORY_DAYS / 30)),
    feeRate: payments.length ? payments.reduce((sum, item) => sum + item.shareRatio * item.feeRate, 0) : null,
  };
}

// ---------- montagem ----------
export function buildCashFlowStudy(input: StudyInputs): StudyResult {
  const { today } = input;
  const horizonEnd = horizonEndFor(today);
  const inHorizon = (date: string) => date <= horizonEnd;
  const entries: StudyEntry[] = [];
  const gaps: string[] = [];
  const lag = cashLagByUnit(input.batches);

  const units = new Map<string, StudyUnit>();
  const unit = (kioskId: string, kioskName: string) => {
    const existing = units.get(kioskId);
    if (existing) return existing;
    const unitLag = lag.of(kioskId);
    const created: StudyUnit = { kioskId, kioskName, openCents: 0, countedCents: 0, boletoCents: 0, batchPeriod: null, eta: null,
      lagDays: unitLag.days, lagFromHistory: unitLag.fromHistory };
    units.set(kioskId, created);
    return created;
  };

  // Espécie com boleto emitido ou ainda sem boleto (lotes).
  for (const batch of input.batches) {
    if (batch.totalCents <= 0) continue;
    const owner = { id: batch.kioskId, name: batch.kioskName };
    if (BOLETO_BATCH.has(batch.status)) {
      const issuedOn = (batch.issuedAt ?? today).slice(0, 10);
      const expected = addDays(issuedOn, BOLETO_TO_BANK_DAYS);
      const date = clampToToday(expected, today);
      const row = unit(batch.kioskId, batch.kioskName);
      row.boletoCents += batch.totalCents;
      row.batchPeriod = `${batch.periodStartDate}|${batch.periodEndDate}`;
      row.eta = row.eta && row.eta < date ? row.eta : date;
      if (inHorizon(date)) entries.push({ id: `batch:${batch.id}`, date, direction: "in", source: "deposit_boleto", certainty: "guaranteed", stage: "boleto", unit: owner, sinceDate: issuedOn,
        ...(expected < today ? { lateFrom: expected } : {}),
        label: `Boleto de depósito · ${batch.kioskName}`, detail: `Espécie · vendas de ${batch.periodStartDate} a ${batch.periodEndDate}`, amountCents: batch.totalCents });
    } else if (COUNTED_BATCH.has(batch.status)) {
      const date = addDays(today, COUNTED_TO_BANK_DAYS);
      unit(batch.kioskId, batch.kioskName).countedCents += batch.totalCents;
      if (inHorizon(date)) entries.push({ id: `batch:${batch.id}`, date, direction: "in", source: "deposit_counted", certainty: "guaranteed", stage: "counted", unit: owner, sinceDate: batch.periodEndDate,
        label: `Espécie contado, sem boleto · ${batch.kioskName}`, detail: `Lote de ${batch.periodStartDate} a ${batch.periodEndDate}`, amountCents: batch.totalCents });
    }
  }

  // Fechamentos: espécie aprovado e não alocado (contado) ou vendido e ainda aguardando a contagem.
  const closedDates = new Set<string>();
  for (const closure of input.closures) {
    closedDates.add(closure.date);
    if (closure.date > today) continue;
    const owner = { id: closure.kioskId, name: closure.kioskName };
    if (closure.status === "approved" && closure.depositStatus === "not_allocated" && closure.depositEligibleCents > 0) {
      const date = addDays(today, COUNTED_TO_BANK_DAYS);
      unit(closure.kioskId, closure.kioskName).countedCents += closure.depositEligibleCents;
      if (inHorizon(date)) entries.push({ id: `closure:${closure.kioskId}:${closure.date}`, date, direction: "in", source: "deposit_counted", certainty: "guaranteed", stage: "counted", unit: owner, sinceDate: closure.date,
        label: `Espécie contado, sem lote · ${closure.kioskName}`, detail: `Fechamento de ${closure.date}`, amountCents: closure.depositEligibleCents });
    } else if (OPEN_CLOSURE.has(closure.status) && (closure.byChannelCents.cash ?? 0) > 0) {
      const row = unit(closure.kioskId, closure.kioskName);
      const cents = closure.byChannelCents.cash;
      const date = clampToToday(addDays(closure.date, row.lagDays ?? DEFAULT_CASH_LAG_DAYS), today);
      row.openCents += cents;
      if (inHorizon(date)) entries.push({ id: `closure:${closure.kioskId}:${closure.date}`, date, direction: "in", source: "cash_open", certainty: "guaranteed", stage: "cash_open", unit: owner, sinceDate: closure.date,
        label: `Espécie aguardando contagem · ${closure.kioskName}`, detail: `Vendas de ${closure.date}`, amountCents: cents });
    }
  }

  // Carteira Stone: parcelas abertas no vencimento, líquidas.
  for (const parcel of input.stone) {
    if (parcel.netCents <= 0) continue;
    const date = clampToToday(parcel.dueDate, today);
    if (!inHorizon(date)) continue;
    entries.push({ id: `stone:${date}`, date, direction: "in", source: "stone", certainty: "guaranteed", stage: "stone",
      label: "Cartão já vendido · Stone", detail: "Carteira Stone sincronizada", amountCents: parcel.netCents });
  }

  // Vendas projetadas pela média de 3 meses, por dia da semana; uma linha por dia e forma de pagamento.
  const average = weekdaySalesAverage(input.closures, today);
  if (average.days < 28) gaps.push("Menos de 4 semanas de fechamentos nos últimos 3 meses: as vendas projetadas ficam pouco confiáveis.");
  const networkCashLag = lag.network ?? DEFAULT_CASH_LAG_DAYS;
  for (let date = today; date <= horizonEnd; date = addDays(date, 1)) {
    if (closedDates.has(date)) continue;
    const sales = average.of(date);
    for (const channel of CHANNELS) {
      const gross = sales[channel];
      if (gross <= 0) continue;
      const net = channel === "cash" ? gross : Math.round(gross * (1 - PROJECTED_FEE_RATE[channel]));
      const land = addDays(date, channel === "cash" ? networkCashLag : CARD_SETTLEMENT_DAYS[channel]);
      if (!inHorizon(land)) continue;
      entries.push({ id: `sales:${channel}:${date}`, date: land, direction: "in", source: "sales_projected", certainty: "projected", stage: "projected",
        label: `Venda futura · ${CHANNEL_LABEL[channel]}`, detail: "Média dos últimos 3 meses para o dia da semana", amountCents: net });
    }
  }

  // Despesas abertas e provisionadas no vencimento; vencidas contam hoje.
  let undated = 0;
  for (const expense of input.expenses) {
    if (expense.amountCents <= 0) continue;
    if (!expense.date) { undated += 1; continue; }
    const overdue = expense.date < today;
    const date = overdue ? today : expense.date;
    if (!inHorizon(date)) continue;
    entries.push({ id: `expense:${expense.id}`, date, direction: "out", source: expense.provisioned ? "expense_forecast" : "expense",
      certainty: expense.provisioned ? "provisioned" : "payable", label: expense.description,
      detail: [expense.supplier, overdue ? `vencida em ${expense.date}` : null].filter(Boolean).join(" · "), amountCents: expense.amountCents, overdue });
  }
  if (undated) gaps.push(`${undated} despesa(s) aberta(s) sem vencimento nem competência ficaram fora da projeção.`);

  entries.push(...projectRecurringOutflows(input, horizonEnd));
  if (!input.realized.length) gaps.push("Sem movimentação realizada no Inter nos últimos meses: saídas recorrentes, mínimo de caixa e indicadores de saúde ficam indisponíveis.");

  // Saldo das contas.
  const operating = input.accounts.filter(account => account.kind === "operating");
  const readable = operating.filter(account => account.cents !== null);
  const startBalanceCents = readable.length ? readable.reduce((sum, account) => sum + account.cents!, 0) : null;
  const reserveCents = input.accounts.filter(account => account.kind === "reserve").reduce((sum, account) => sum + (account.cents ?? 0), 0);
  if (startBalanceCents === null) gaps.push("O saldo do Inter não foi lido agora; a projeção mostra só as variações.");
  else if (readable.length < operating.length) gaps.push("Nem todas as contas puderam ser lidas; o saldo soma só as lidas.");
  const balanceAt = readable.map(account => account.at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

  const health = buildHealth(input, lag, startBalanceCents, reserveCents);
  const minimumCents = health.weeklyOutCents ? health.weeklyOutCents * 2 : null;

  return {
    asOf: today, horizonEnd, accounts: input.accounts, startBalanceCents, reserveCents, balanceAt, minimumCents,
    entries: mergeStoneEntries(entries).sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction) || b.amountCents - a.amountCents),
    units: [...units.values()].sort((a, b) => a.kioskName.localeCompare(b.kioskName, "pt-BR")),
    health, gaps,
  };
}

/** Agrupa as parcelas Stone do mesmo dia numa linha, com a contagem. */
function mergeStoneEntries(entries: StudyEntry[]) {
  const merged = new Map<string, StudyEntry & { count?: number }>();
  const rest: StudyEntry[] = [];
  for (const entry of entries) {
    if (entry.source !== "stone") { rest.push(entry); continue; }
    const current = merged.get(entry.id);
    if (current) { current.amountCents += entry.amountCents; current.count = (current.count ?? 1) + 1; }
    else merged.set(entry.id, { ...entry, count: 1 });
  }
  return [...rest, ...[...merged.values()].map(({ count, ...entry }) => ({ ...entry, detail: `${count} parcela(s) da carteira Stone` }))];
}

export function moneyLabel(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
