/**
 * Estudo de fluxo de caixa (13 semanas): cálculo puro, sem acesso a banco, compartilhado
 * entre servidor (montagem) e tela (troca de cenário). Regras em docs/planos/plano-estudo-fluxo-caixa.md.
 */

export const HORIZON_WEEKS = 13;
export const HISTORY_DAYS = 90;
/** Taxas praticadas usadas para projetar vendas futuras já líquidas (Pix truncado em 0,75%). */
export const PROJECTED_FEE_RATE = { pix: 0.0075, debit_card: 0.0146, credit_card: 0.0222 } as const;
/** Dias da venda até o dinheiro estar disponível, por forma de pagamento de maquininha. */
export const CARD_SETTLEMENT_DAYS = { pix: 0, debit_card: 1, credit_card: 30 } as const;
/** Espécie: fechamento (14) + lote/boleto (7) + pagamento do boleto (3), até a unidade ter histórico. */
export const DEFAULT_CASH_LAG_DAYS = 24;
export const COUNTED_TO_BANK_DAYS = 10;
export const BOLETO_TO_BANK_DAYS = 3;
export const MIN_PAID_BATCHES_FOR_UNIT_LAG = 4;
export const SCENARIO_FACTOR = { pessimistic: 0.85, expected: 1, optimistic: 1.1 } as const;
export type Scenario = keyof typeof SCENARIO_FACTOR;

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
export type StudyExpense = {
  id: string; description: string; supplier: string | null; date: string | null; amountCents: number; provisioned: boolean;
};
export type StudyRealized = { date: string; direction: "in" | "out"; amountCents: number };

export type StudyInputs = {
  today: string;
  interBalance: { cents: number; at: string } | null;
  stone: StudyStoneParcel[];
  batches: StudyBatch[];
  closures: StudyClosure[];
  expenses: StudyExpense[];
  realized: StudyRealized[];
};

export type EntrySource = "deposit_boleto" | "deposit_counted" | "cash_open" | "stone" | "sales_projected" | "expense" | "expense_forecast";
export type StudyEntry = {
  id: string; date: string; direction: "in" | "out"; source: EntrySource;
  /** Garantido = já existe; projetado = média de vendas; a pagar/provisionada = despesa. */
  certainty: "guaranteed" | "projected" | "payable" | "provisioned";
  label: string; detail: string; amountCents: number; overdue?: boolean;
};
export type StudyStage = { key: "cash_open" | "counted" | "boleto" | "stone" | "inter"; cents: number | null; count: number; nextDate: string | null };
export type StudyUnit = {
  kioskId: string; kioskName: string; openCents: number; countedCents: number; boletoCents: number;
  batchPeriod: string | null; eta: string | null; lagDays: number | null; lagFromHistory: boolean;
};
export type StudyMonth = { month: string; inCents: number; outCents: number; partial: boolean };
export type Tone = "ok" | "warn" | "danger" | "neutral";
export type StudyIndicator = { key: string; label: string; value: string; detail: string; tone: Tone; status: string; basis: string };

export type StudyResult = {
  asOf: string;
  weekStarts: string[];
  startBalanceCents: number | null;
  balanceAt: string | null;
  minimumCents: number | null;
  entries: StudyEntry[];
  stages: StudyStage[];
  units: StudyUnit[];
  months: StudyMonth[];
  indicators: StudyIndicator[];
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
const maxDate = (a: string, b: string) => (a > b ? a : b);
const clampToToday = (date: string, today: string) => maxDate(date, today);

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// ---------- prazo do espécie ----------
function batchLagDays(batch: StudyBatch) {
  if (batch.status !== "paid" || !batch.paidAt) return null;
  const midpoint = addDays(batch.periodStartDate, Math.floor(daysBetween(batch.periodStartDate, batch.periodEndDate) / 2));
  const lag = daysBetween(midpoint, batch.paidAt.slice(0, 10));
  return lag >= 0 && lag < 365 ? lag : null;
}
export function cashLagByUnit(batches: StudyBatch[]) {
  const lags = new Map<string, number[]>();
  for (const batch of batches) {
    const lag = batchLagDays(batch);
    if (lag === null) continue;
    lags.set(batch.kioskId, [...(lags.get(batch.kioskId) ?? []), lag]);
  }
  const all = [...lags.values()].flat();
  return {
    of(kioskId: string) {
      const list = lags.get(kioskId) ?? [];
      return list.length >= MIN_PAID_BATCHES_FOR_UNIT_LAG
        ? { days: Math.round(mean(list)!), fromHistory: true }
        : { days: DEFAULT_CASH_LAG_DAYS, fromHistory: false };
    },
    network: all.length ? Math.round(mean(all)!) : null,
    paidCount: all.length,
  };
}

const OPEN_CLOSURE = new Set(["not_synced", "draft", "pending_review", "reopened", "sync_error"]);
const BOLETO_BATCH = new Set(["issuing", "issued"]);
const COUNTED_BATCH = new Set(["open", "locked", "failed"]);

// ---------- média de vendas por dia da semana ----------
export function weekdaySalesAverage(closures: StudyClosure[], today: string) {
  const from = addDays(today, -HISTORY_DAYS);
  const byDate = new Map<string, Record<SalesChannel, number>>();
  for (const closure of closures) {
    if (closure.date < from || closure.date >= today) continue;
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

const CHANNEL_LABEL: Record<SalesChannel, string> = { cash: "espécie", pix: "Pix", debit_card: "débito", credit_card: "crédito" };

// ---------- montagem ----------
export function buildCashFlowStudy(input: StudyInputs): StudyResult {
  const { today } = input;
  const firstWeek = weekStart(today);
  const weekStarts = Array.from({ length: HORIZON_WEEKS }, (_, index) => addDays(firstWeek, index * 7));
  const horizonEnd = addDays(firstWeek, HORIZON_WEEKS * 7 - 1);
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
  const stage = { cash_open: { cents: 0, count: 0, next: null as string | null }, counted: { cents: 0, count: 0, next: null as string | null },
    boleto: { cents: 0, count: 0, next: null as string | null }, stone: { cents: 0, count: 0, next: null as string | null } };
  const bump = (key: keyof typeof stage, cents: number, date: string) => {
    stage[key].cents += cents; stage[key].count += 1;
    if (!stage[key].next || date < stage[key].next!) stage[key].next = date;
  };

  // Espécie com boleto emitido ou ainda sem boleto (lotes).
  for (const batch of input.batches) {
    if (batch.totalCents <= 0) continue;
    if (BOLETO_BATCH.has(batch.status)) {
      const date = clampToToday(addDays((batch.issuedAt ?? today).slice(0, 10), BOLETO_TO_BANK_DAYS), today);
      const row = unit(batch.kioskId, batch.kioskName);
      row.boletoCents += batch.totalCents;
      row.batchPeriod = `${batch.periodStartDate}|${batch.periodEndDate}`;
      row.eta = row.eta && row.eta < date ? row.eta : date;
      bump("boleto", batch.totalCents, date);
      if (inHorizon(date)) entries.push({ id: `batch:${batch.id}`, date, direction: "in", source: "deposit_boleto", certainty: "guaranteed",
        label: `Boleto de depósito · ${batch.kioskName}`, detail: `Espécie · vendas de ${batch.periodStartDate} a ${batch.periodEndDate}`, amountCents: batch.totalCents });
    } else if (COUNTED_BATCH.has(batch.status)) {
      const date = addDays(today, COUNTED_TO_BANK_DAYS);
      unit(batch.kioskId, batch.kioskName).countedCents += batch.totalCents;
      bump("counted", batch.totalCents, date);
      entries.push({ id: `batch:${batch.id}`, date, direction: "in", source: "deposit_counted", certainty: "guaranteed",
        label: `Espécie contado, sem boleto · ${batch.kioskName}`, detail: `Lote de ${batch.periodStartDate} a ${batch.periodEndDate}`, amountCents: batch.totalCents });
    }
  }

  // Fechamentos: espécie aprovado e não alocado (contado) ou vendido e ainda não fechado.
  const closedDates = new Set<string>();
  for (const closure of input.closures) {
    closedDates.add(closure.date);
    if (closure.date > today) continue;
    if (closure.status === "approved" && closure.depositStatus === "not_allocated" && closure.depositEligibleCents > 0) {
      const date = addDays(today, COUNTED_TO_BANK_DAYS);
      unit(closure.kioskId, closure.kioskName).countedCents += closure.depositEligibleCents;
      bump("counted", closure.depositEligibleCents, date);
      entries.push({ id: `closure:${closure.kioskId}:${closure.date}`, date, direction: "in", source: "deposit_counted", certainty: "guaranteed",
        label: `Espécie contado, sem lote · ${closure.kioskName}`, detail: `Fechamento de ${closure.date}`, amountCents: closure.depositEligibleCents });
    } else if (OPEN_CLOSURE.has(closure.status) && (closure.byChannelCents.cash ?? 0) > 0) {
      const row = unit(closure.kioskId, closure.kioskName);
      const cents = closure.byChannelCents.cash;
      const date = clampToToday(addDays(closure.date, row.lagDays ?? DEFAULT_CASH_LAG_DAYS), today);
      row.openCents += cents;
      bump("cash_open", cents, date);
      if (inHorizon(date)) entries.push({ id: `closure:${closure.kioskId}:${closure.date}`, date, direction: "in", source: "cash_open", certainty: "guaranteed",
        label: `Espécie vendido, não fechado · ${closure.kioskName}`, detail: `Vendas de ${closure.date}`, amountCents: cents });
    }
  }

  // Carteira Stone: parcelas abertas no vencimento, líquidas.
  for (const parcel of input.stone) {
    if (parcel.netCents <= 0) continue;
    const date = clampToToday(parcel.dueDate, today);
    bump("stone", parcel.netCents, date);
    if (!inHorizon(date)) continue;
    entries.push({ id: `stone:${date}`, date, direction: "in", source: "stone", certainty: "guaranteed",
      label: "Stone · parcelas de cartão", detail: "Carteira Stone sincronizada", amountCents: parcel.netCents });
  }

  // Vendas projetadas pela média de 3 meses, por dia da semana; uma linha por semana e forma de pagamento.
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
      entries.push({ id: `sales:${channel}:${date}`, date: land, direction: "in", source: "sales_projected", certainty: "projected",
        label: `Vendas projetadas · ${CHANNEL_LABEL[channel]}`, detail: "Média dos últimos 3 meses para o dia da semana", amountCents: net });
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
  if (!input.interBalance) gaps.push("O saldo do Inter não foi lido agora; a projeção mostra só as variações.");

  // Realizado por mês (aba Saúde) e mínimo de caixa.
  const currentMonth = today.slice(0, 7);
  const monthKeys: string[] = [];
  for (let back = 3; back >= 0; back -= 1) {
    const [year, month] = currentMonth.split("-").map(Number);
    const index = year * 12 + (month - 1) - back;
    monthKeys.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  const months: StudyMonth[] = monthKeys.map(month => ({ month, inCents: 0, outCents: 0, partial: month === currentMonth }));
  for (const row of input.realized) {
    const bucket = months.find(month => month.month === row.date.slice(0, 7));
    if (!bucket) continue;
    if (row.direction === "in") bucket.inCents += row.amountCents; else bucket.outCents += row.amountCents;
  }
  const full = months.filter(month => !month.partial);
  const fullWithData = full.filter(month => month.inCents > 0 || month.outCents > 0);
  const totalOut = fullWithData.reduce((sum, month) => sum + month.outCents, 0);
  const totalIn = fullWithData.reduce((sum, month) => sum + month.inCents, 0);
  const weeklyOut = fullWithData.length ? totalOut / (fullWithData.length * 52 / 12) : null;
  const minimumCents = weeklyOut ? Math.round(weeklyOut * 2) : null;
  if (!fullWithData.length) gaps.push("Sem movimentação realizada no Inter nos últimos 3 meses: mínimo de caixa e indicadores ficam indisponíveis.");

  const stoneFee = input.stone.reduce((acc, parcel) => parcel.feeCents === null ? acc
    : { fee: acc.fee + parcel.feeCents, gross: acc.gross + parcel.grossCents }, { fee: 0, gross: 0 });
  const indicators: StudyIndicator[] = [];
  const balance = input.interBalance?.cents ?? null;
  if (balance !== null && weeklyOut) {
    const weeks = balance / weeklyOut;
    indicators.push({ key: "runway", label: "Fôlego", value: `${weeks.toFixed(1).replace(".", ",")} semanas`,
      detail: "Quantas semanas de saídas médias o saldo de hoje paga sem nenhuma entrada.", basis: "meta: 4 semanas",
      ...(weeks >= 4 ? { tone: "ok" as const, status: "Confortável" } : weeks >= 2 ? { tone: "warn" as const, status: "Atenção" } : { tone: "danger" as const, status: "Curto" }) });
  }
  if (fullWithData.length) {
    const surplus = (totalIn - totalOut) / fullWithData.length;
    indicators.push({ key: "surplus", label: "Sobra do mês", value: signedMoney(surplus),
      detail: "Média dos meses fechados: entrou menos saiu no Inter (sem transferências).", basis: `${fullWithData.length} meses`,
      ...(surplus > 0 ? { tone: "ok" as const, status: "Positiva" } : { tone: "danger" as const, status: "Negativa" }) });
    const ratio = totalIn > 0 ? totalOut / totalIn : null;
    if (ratio !== null) indicators.push({ key: "ratio", label: "Saídas ÷ entradas", value: `${Math.round(ratio * 100)}%`,
      detail: "Quanto do que entra já sai no mesmo período. Acima de 90% sobra pouca margem.", basis: `${fullWithData.length} meses`,
      ...(ratio < 0.9 ? { tone: "ok" as const, status: "Saudável" } : ratio < 1 ? { tone: "warn" as const, status: "Apertado" } : { tone: "danger" as const, status: "Consome caixa" }) });
  }
  if (lag.network !== null) indicators.push({ key: "cash_lag", label: "Prazo do espécie", value: `${lag.network} dias`,
    detail: "Da venda (meio do período do lote) até o boleto cair no Inter.", basis: `${lag.paidCount} lote(s) pago(s) · meta 14 dias`,
    ...(lag.network <= 14 ? { tone: "ok" as const, status: "Bom" } : lag.network <= 30 ? { tone: "warn" as const, status: "Atenção" } : { tone: "danger" as const, status: "Alto" }) });
  if (stoneFee.gross > 0) indicators.push({ key: "stone_fee", label: "Custo das taxas Stone", value: `${(stoneFee.fee / stoneFee.gross * 100).toFixed(2).replace(".", ",")}%`,
    detail: "Taxa média das parcelas de cartão a receber.", basis: "carteira aberta", tone: "neutral", status: "Informativo" });

  const stages: StudyStage[] = [
    { key: "cash_open", cents: stage.cash_open.cents, count: stage.cash_open.count, nextDate: stage.cash_open.next },
    { key: "counted", cents: stage.counted.cents, count: stage.counted.count, nextDate: stage.counted.next },
    { key: "boleto", cents: stage.boleto.cents, count: stage.boleto.count, nextDate: stage.boleto.next },
    { key: "stone", cents: stage.stone.cents, count: stage.stone.count, nextDate: stage.stone.next },
    { key: "inter", cents: balance, count: 0, nextDate: null },
  ];

  return {
    asOf: today, weekStarts, startBalanceCents: balance, balanceAt: input.interBalance?.at ?? null, minimumCents,
    entries: mergeStoneEntries(entries).sort((a, b) => a.date.localeCompare(b.date) || a.direction.localeCompare(b.direction) || b.amountCents - a.amountCents),
    stages, units: [...units.values()].sort((a, b) => a.kioskName.localeCompare(b.kioskName, "pt-BR")),
    months, indicators, gaps,
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

function signedMoney(cents: number) {
  return `${cents < 0 ? "−" : "+"}${moneyLabel(Math.abs(cents))}`;
}
export function moneyLabel(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------- semanas (usado também na tela para trocar o cenário) ----------
export type StudyWeek = {
  index: number; start: string; end: string; openingCents: number; inCents: number; outCents: number; closingCents: number;
  guaranteedInCents: number; projectedInCents: number; heaviest: string | null;
  status: "comfortable" | "normal" | "below_minimum" | "negative";
};
export function scaleEntry(entry: StudyEntry, scenario: Scenario) {
  return entry.certainty === "projected" ? Math.round(entry.amountCents * SCENARIO_FACTOR[scenario]) : entry.amountCents;
}
export function buildWeeks(result: Pick<StudyResult, "weekStarts" | "entries" | "startBalanceCents" | "minimumCents">, scenario: Scenario): StudyWeek[] {
  let balance = result.startBalanceCents ?? 0;
  const minimum = result.minimumCents;
  return result.weekStarts.map((start, index) => {
    const end = addDays(start, 6);
    const inWeek = result.entries.filter(entry => entry.date >= start && entry.date <= end);
    const incoming = inWeek.filter(entry => entry.direction === "in");
    const outgoing = inWeek.filter(entry => entry.direction === "out");
    const inCents = incoming.reduce((sum, entry) => sum + scaleEntry(entry, scenario), 0);
    const outCents = outgoing.reduce((sum, entry) => sum + entry.amountCents, 0);
    const opening = balance;
    balance = opening + inCents - outCents;
    const heaviest = outgoing.length ? [...outgoing].sort((a, b) => b.amountCents - a.amountCents)[0].label : null;
    return {
      index, start, end, openingCents: opening, inCents, outCents, closingCents: balance,
      guaranteedInCents: incoming.filter(entry => entry.certainty === "guaranteed").reduce((sum, entry) => sum + entry.amountCents, 0),
      projectedInCents: incoming.filter(entry => entry.certainty === "projected").reduce((sum, entry) => sum + scaleEntry(entry, scenario), 0),
      heaviest,
      status: balance < 0 ? "negative" : minimum !== null && balance < minimum ? "below_minimum"
        : minimum !== null && balance >= minimum * 2 ? "comfortable" : "normal",
    };
  });
}
