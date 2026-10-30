/**
 * Relatório semanal de faturamento e metas — cálculo e montagem do relatório semanal de faturamento e metas.
 * Módulo puro: recebe os dados já lidos e devolve números, assunto, HTML e texto.
 * Especificação: docs/engineering/weekly-revenue-goals-email.md
 */

export type SalesDay = {
  kioskId: string;
  date: string; // AAAA-MM-DD
  revenueCents: number;
  /** true quando a receita vem do contrato reconciliado dos cupons; false = soma legada dos itens. */
  reconciled: boolean;
  coupons: number | null;
  items: number;
  products: Record<string, { name: string; qty: number; cents: number }>;
};

export type GoalMonth = {
  kioskId: string;
  month: string; // AAAA-MM
  status: string;
  target: number;
  up?: number | null;
  top?: number | null;
  current: number;
  dailyProgress: Record<string, number>;
  /** Datas que recebem meta pela distribuição configurada (calendário ou dias de escala). */
  distributionDates: string[];
  distributionSource: "calendar" | "schedule";
};

export type Unit = { id: string; name: string };

export type ReportInput = {
  now: Date;
  weekStart: string;
  weekEnd: string;
  monthStart: string;
  monthEnd: string;
  units: Unit[];
  days: SalesDay[];
  goals: GoalMonth[];
  links: { goals: string; analysis: string };
  thresholds: { onTrack: number; attention: number };
};

type Aggregate = {
  cents: number; coupons: number; couponCents: number; items: number;
  have: number; expected: number; legacy: number; ticket: number | null; perDay: number;
  daily: Record<string, number>; products: Record<string, { name: string; qty: number; cents: number }>;
};

/** Nome do relatório no assunto e no cabeçalho do e-mail. */
export const REPORT_NAME = "Placar Coala";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const C = {
  ink: "#1a1b1f", muted: "#5f646c", div: "#f1eee8", border: "#e3dfd6", page: "#efece6", warm: "#f7f5f0",
  accent: "#d13670", kicker: "#f08bb1", ok: "#147337", okBg: "#e8f5ee", bad: "#a6325b", badBg: "#fbe7ef",
  warn: "#6b4500", warnBg: "#fff7e6", info: "#1d4ed8", track: "#eceae5",
};

export function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function dateRange(start: string, end: string) {
  const out: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) out.push(date);
  return out;
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const lastDayOfMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const monthOf = (date: string) => date.slice(0, 7);
const previousMonth = (month: string, back: number) => {
  const [year, m] = month.split("-").map(Number);
  const value = new Date(Date.UTC(year, m - 1 - back, 1));
  return value.toISOString().slice(0, 7);
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
const num = (value: number, digits = 0) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value: number, digits = 1) => `${num(value, digits)}%`;
const brl = (cents: number, digits = 0) => `R$ ${num(cents / 100, digits)}`;
const compactBrl = (cents: number) => cents >= 100_000 ? `R$ ${num(cents / 100_000, 1)} mil` : brl(cents);
const delta = (value: number, base: number | null | undefined) => base ? (value / base - 1) * 100 : null;
const productName = (value: string) => value.toLocaleLowerCase("pt-BR")
  .replace(/(^|\s)(\p{L})/gu, (_match, space: string, letter: string) => space + letter.toLocaleUpperCase("pt-BR"))
  .replace(/(\d)\s*ml\b/gi, "$1 ml");

/** Agrega os dias com relatório; dia sem relatório conta como ausente, nunca como zero. */
export function aggregate(byKey: Map<string, SalesDay>, firstDate: Record<string, string>, unitIds: string[], start: string, end: string): Aggregate {
  const result: Aggregate = { cents: 0, coupons: 0, couponCents: 0, items: 0, have: 0, expected: 0, legacy: 0, ticket: null, perDay: 0, daily: {}, products: {} };
  for (const unitId of unitIds) for (const date of dateRange(start, end)) {
    if (!firstDate[unitId] || date < firstDate[unitId]) continue;
    result.expected++;
    const day = byKey.get(`${unitId}|${date}`);
    if (!day) continue;
    result.have++;
    if (!day.reconciled) result.legacy++;
    result.cents += day.revenueCents;
    result.items += day.items;
    result.daily[date] = (result.daily[date] ?? 0) + day.revenueCents;
    if (day.coupons != null) { result.coupons += day.coupons; result.couponCents += day.revenueCents; }
    for (const [id, product] of Object.entries(day.products)) {
      const total = result.products[id] ??= { name: product.name, qty: 0, cents: 0 };
      total.qty += product.qty;
      total.cents += product.cents;
    }
  }
  result.ticket = result.coupons ? result.couponCents / result.coupons : null;
  result.perDay = result.have ? result.cents / result.have : 0;
  return result;
}

export function buildReport(input: ReportInput) {
  const { weekStart, weekEnd, monthStart, monthEnd, units } = input;
  const byKey = new Map(input.days.map(day => [`${day.kioskId}|${day.date}`, day]));
  const firstDate: Record<string, string> = {};
  for (const day of input.days) if (!firstDate[day.kioskId] || day.date < firstDate[day.kioskId]) firstDate[day.kioskId] = day.date;
  const agg = (ids: string[], start: string, end: string) => aggregate(byKey, firstDate, ids, start, end);
  const completeWeeks = (ids: string[]) => {
    const weeks: Aggregate[] = [];
    for (let index = 1; index <= 26; index++) {
      const start = addDays(weekStart, -7 * index);
      const week = agg(ids, start, addDays(start, 6));
      if (week.expected && week.have === week.expected) weeks.push(week);
    }
    return weeks;
  };
  const month = monthOf(monthStart);
  const elapsedCut = monthEnd;

  const unitReports = units.filter(unit => firstDate[unit.id]).map(unit => {
    const week = agg([unit.id], weekStart, weekEnd);
    const previous = agg([unit.id], addDays(weekStart, -7), addDays(weekStart, -1));
    const monthToDate = agg([unit.id], monthStart, monthEnd);
    const history = completeWeeks([unit.id]);
    const goal = input.goals.find(entry => entry.kioskId === unit.id && entry.month === month) ?? null;
    let goalView = null as null | {
      target: number; up: number | null; top: number | null; realized: number; expected: number; pace: number;
      projection: number; neededPerDay: number; remainingDays: number; next: { label: string; value: number } | null; source: GoalMonth["distributionSource"];
    };
    if (goal) {
      const realized = Math.round(Object.entries(goal.dailyProgress).filter(([date]) => date <= elapsedCut).reduce((sum, [, value]) => sum + value, 0) * 100);
      const distributed = goal.distributionDates.length || 1;
      const elapsed = goal.distributionDates.filter(date => date <= elapsedCut).length;
      const target = goal.target * 100;
      const expected = target * elapsed / distributed;
      const elapsedWithData = goal.distributionDates.filter(date => date <= elapsedCut && byKey.has(`${unit.id}|${date}`)).length;
      const remainingDays = distributed - elapsed;
      const projection = elapsedWithData ? realized / elapsedWithData * distributed : realized;
      const tiers = [["Meta Alvo", goal.target], ["Meta UP", goal.up], ["Meta TOP", goal.top]] as Array<[string, number | null | undefined]>;
      const next = tiers.filter((tier): tier is [string, number] => Boolean(tier[1])).find(([, value]) => projection < value * 100);
      goalView = {
        target, up: goal.up ? goal.up * 100 : null, top: goal.top ? goal.top * 100 : null, realized, expected,
        pace: expected ? realized / expected * 100 : 0, projection,
        neededPerDay: remainingDays > 0 ? Math.max(target - realized, 0) / remainingDays : 0, remainingDays,
        next: next ? { label: next[0], value: next[1] * 100 } : null, source: goal.distributionSource,
      };
    }
    const closedGoals = input.goals.filter(entry => entry.kioskId === unit.id && entry.status === "closed" && entry.month >= previousMonth(month, 5) && entry.month < month);
    const fullMonths = [1, 2, 3, 4, 5].map(back => previousMonth(month, back))
      .map(value => agg([unit.id], `${value}-01`, lastDayOfMonth(value))).filter(value => value.expected && value.have === value.expected);
    const mean = fullMonths.reduce((sum, value) => sum + value.cents, 0) / (fullMonths.length || 1);
    const variation = fullMonths.length >= 4 ? Math.sqrt(fullMonths.reduce((sum, value) => sum + (value.cents - mean) ** 2, 0) / fullMonths.length) / mean * 100 : null;
    const top = Object.entries(week.products).sort((left, right) => right[1].cents - left[1].cents).slice(0, 10).map(([id, product]) => {
      const before = previous.products[id];
      const historyQty = history.map(entry => entry.products[id]?.qty ?? 0);
      const historyPerDay = history.length ? historyQty.reduce((sum, qty) => sum + qty, 0) / (history.length * 7) : null;
      return {
        name: productName(product.name), qty: product.qty, cents: product.cents, share: week.cents ? product.cents / week.cents * 100 : 0,
        previousQty: before?.qty ?? 0,
        vsPrevious: before && week.have && previous.have ? delta(product.qty / week.have, before.qty / previous.have) : null,
        historyWeekly: historyPerDay != null ? historyPerDay * 7 : null,
        vsHistory: historyPerDay && week.have ? delta(product.qty / week.have, historyPerDay) : null,
      };
    });
    const firstTicketMonth = [5, 4, 3, 2, 1].map(back => previousMonth(month, back)).map(value => agg([unit.id], `${value}-01`, lastDayOfMonth(value))).find(value => value.ticket != null);
    return {
      ...unit, firstDate: firstDate[unit.id], partialHistory: firstDate[unit.id] > addDays(weekStart, -182),
      week, previous, monthToDate, historyWeeks: history.length, goal: goalView,
      goalsHit: closedGoals.filter(entry => entry.current >= entry.target).length, goalsClosed: closedGoals.length,
      variation, top, firstTicket: firstTicketMonth?.ticket ?? null,
    };
  });

  const ids = unitReports.map(unit => unit.id);
  const week = agg(ids, weekStart, weekEnd);
  const previous = agg(ids, addDays(weekStart, -7), addDays(weekStart, -1));
  const monthToDate = agg(ids, monthStart, monthEnd);
  const history = completeWeeks(ids);
  const historyPerDay = history.length ? history.reduce((sum, value) => sum + value.perDay, 0) / history.length : null;
  const monthDay = Number(monthEnd.slice(8, 10));
  const priorMonths = [1, 2, 3, 4, 5, 6].map(back => previousMonth(month, back))
    .map(value => agg(ids, `${value}-01`, `${value}-${String(Math.min(monthDay, Number(lastDayOfMonth(value).slice(8)))).padStart(2, "0")}`))
    .filter(value => value.expected && value.have === value.expected);
  const goalUnits = unitReports.filter(unit => unit.goal);
  const sum = (pick: (unit: typeof unitReports[number]) => number) => goalUnits.reduce((total, unit) => total + pick(unit), 0);
  const network = {
    week, previous, monthToDate, historyWeeks: history.length, historyPerDay,
    monthPriorPerDay: priorMonths.length ? priorMonths.reduce((total, value) => total + value.perDay, 0) / priorMonths.length : null,
    monthPriorCount: priorMonths.length,
    goal: goalUnits.length ? {
      target: sum(unit => unit.goal!.target),
      // Uma faixa só existe na rede quando todas as unidades com meta a configuraram.
      up: goalUnits.every(unit => unit.goal!.up) ? sum(unit => unit.goal!.up!) : null,
      top: goalUnits.every(unit => unit.goal!.top) ? sum(unit => unit.goal!.top!) : null,
      realized: sum(unit => unit.goal!.realized), expected: sum(unit => unit.goal!.expected), projection: sum(unit => unit.goal!.projection),
    } : null,
  };

  const networkProducts = week.products, previousProducts = previous.products;
  const last8 = agg(ids, addDays(weekStart, -56), addDays(weekStart, -1)).products;
  const last4 = agg(ids, addDays(weekStart, -28), addDays(weekStart, -1)).products;
  const movers = Object.entries(networkProducts)
    .filter(([id, product]) => product.qty >= 20 && (previousProducts[id]?.qty ?? 0) >= 20 && week.have && previous.have)
    .map(([id, product]) => ({ name: productName(product.name), qty: product.qty, change: delta(product.qty / week.have, previousProducts[id].qty / previous.have)! }))
    .sort((left, right) => right.change - left.change);
  const newProducts = Object.entries(networkProducts).filter(([id]) => !last8[id]).map(([, product]) => ({ name: productName(product.name), qty: product.qty }));
  const missingProducts = Object.entries(last4).filter(([id, product]) => product.qty / 4 >= 5 && !networkProducts[id]).map(([, product]) => ({ name: productName(product.name), weekly: product.qty / 4 }));

  const trend = [5, 4, 3, 2, 1, 0].map(back => previousMonth(month, back)).map(value => {
    const goals = input.goals.filter(goal => goal.month === value);
    if (value === month) {
      return { month: value, cents: network.goal?.projection ?? monthToDate.cents, projected: true, attainment: network.goal ? network.goal.projection / network.goal.target * 100 : null };
    }
    const total = agg(ids, `${value}-01`, lastDayOfMonth(value));
    const targets = goals.reduce((total, goal) => total + goal.target, 0);
    return { month: value, cents: total.cents, projected: false, attainment: targets ? goals.reduce((total, goal) => total + goal.current, 0) / targets * 100 : null };
  });

  const missingDays: string[] = [];
  for (const unit of unitReports) for (const date of dateRange(monthStart, weekEnd > monthEnd ? weekEnd : monthEnd)) {
    if (date >= unit.firstDate && !byKey.has(`${unit.id}|${date}`)) missingDays.push(`${unit.name} ${shortDate(date)}`);
  }
  const sixMonths = agg(ids, addDays(weekStart, -182), weekEnd);

  return {
    input, units: unitReports, network, movers, newProducts, missingProducts, trend, missingDays,
    quality: { weekHave: week.have, weekExpected: week.expected, monthHave: monthToDate.have, monthExpected: monthToDate.expected, historyLegacy: sixMonths.legacy, historyHave: sixMonths.have },
  };
}

export type Report = ReturnType<typeof buildReport>;

export function weekCoverage(report: Report) {
  return report.quality.weekExpected ? report.quality.weekHave / report.quality.weekExpected : 0;
}

function statusOf(report: Report, pace: number) {
  const { onTrack, attention } = report.input.thresholds;
  return pace >= onTrack ? "No ritmo" : pace >= attention ? "Atenção" : "Em risco";
}

export function readingLines(report: Report) {
  const { units, network, movers } = report;
  const lines: Array<{ tone: "good" | "bad" | "idea"; title: string; text: string }> = [];
  const leader = [...units].sort((left, right) => right.week.cents - left.week.cents)[0];
  if (leader && network.week.cents) lines.push({ tone: "good", title: `${leader.name} liderou a semana:`, text: `${brl(leader.week.cents)}, ${pct(leader.week.cents / network.week.cents * 100)} da rede${leader.week.ticket ? `, ticket de ${brl(leader.week.ticket, 2)}` : ""}.` });
  const onTrack = units.filter(unit => unit.goal && unit.goal.pace >= report.input.thresholds.onTrack);
  for (const unit of onTrack.slice(0, 1)) lines.push({ tone: "good", title: `${unit.name} está no ritmo da meta:`, text: `${pct(unit.goal!.pace)} do esperado até ${shortDate(report.input.monthEnd)}; projeção de ${brl(unit.goal!.projection)} para a Meta Alvo de ${brl(unit.goal!.target)}.` });
  if (movers[0] && movers[0].change > 0) lines.push({ tone: "good", title: `${movers[0].name} cresceu:`, text: `${num(movers[0].qty)} unidades na semana, +${pct(movers[0].change, 0)} por dia aberto contra a semana anterior.` });
  const dayChange = delta(network.week.perDay, network.previous.perDay);
  if (dayChange != null) lines.push({ tone: dayChange >= 0 ? "good" : "bad", title: `Venda por dia aberto ${dayChange >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(dayChange))}:`, text: `${brl(network.week.perDay)} por unidade-dia, contra ${brl(network.previous.perDay)} na semana anterior.` });
  const atRisk = units.filter(unit => unit.goal && unit.goal.pace < report.input.thresholds.attention).sort((left, right) => left.goal!.pace - right.goal!.pace);
  if (atRisk.length) lines.push({ tone: "bad", title: `${atRisk.map(unit => unit.name).join(" e ")} em risco na meta do mês:`, text: `${atRisk.map(unit => `${unit.name} em ${pct(unit.goal!.pace, 0)} do ritmo, precisa de ${brl(unit.goal!.neededPerDay)}/dia`).join("; ")}.` });
  const worst = movers[movers.length - 1];
  if (worst && worst.change < 0) lines.push({ tone: "idea", title: "Oportunidade:", text: `${worst.name} caiu ${pct(Math.abs(worst.change), 0)} por dia aberto (${num(worst.qty)} un). Vale conferir exposição e estoque.` });
  return lines;
}

export function renderSubject(report: Report) {
  const { network, units } = report;
  const change = delta(network.week.perDay, network.previous.perDay);
  const onTrack = units.filter(unit => unit.goal && unit.goal.pace >= report.input.thresholds.onTrack).length;
  const changeText = change == null ? "" : ` (${change >= 0 ? "+" : "−"}${pct(Math.abs(change))} por dia)`;
  return `${REPORT_NAME}: ${compactBrl(network.week.cents)} na semana${changeText} · ${onTrack} de ${units.filter(unit => unit.goal).length} no ritmo da meta`;
}

export function renderPreheader(report: Report) {
  const parts: string[] = [];
  const allMissing = dateRange(report.input.weekStart, report.input.weekEnd).filter(date => report.units.every(unit => date < unit.firstDate || !report.network.week.daily[date]));
  if (allMissing.length) parts.push(`${allMissing.map(shortDate).join(", ")} sem relatório nas unidades.`);
  if (report.network.goal) parts.push(`Mês em ${pct(report.network.goal.realized / report.network.goal.expected * 100)} do ritmo da Meta Alvo.`);
  return parts.join(" ");
}

// ── HTML ────────────────────────────────────────────────────────────
const arrow = (value: number | null, digits = 1) => value == null || !Number.isFinite(value)
  ? `<span style="color:${C.muted}">—</span>`
  : Math.abs(value) < 1 ? `<span style="color:${C.muted}">= ${pct(Math.abs(value), digits)}</span>`
    : `<span style="color:${value > 0 ? C.ok : C.bad};font-weight:700">${value > 0 ? "▲" : "▼"} ${pct(Math.abs(value), digits)}</span>`;
const pill = (text: string, background: string, color: string) => `<span style="display:inline-block;background:${background};color:${color};font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap">${escapeHtml(text)}</span>`;
const statusPill = (report: Report, pace: number) => {
  const label = statusOf(report, pace);
  return label === "No ritmo" ? pill(label, C.okBg, C.ok) : label === "Atenção" ? pill(label, C.warnBg, C.warn) : pill(label, C.badBg, C.bad);
};
const cell = (content: string, style = "") => `<td style="padding:8px 0;border-top:1px solid ${C.div};${style}">${content}</td>`;
const cellRight = (content: string, style = "") => `<td style="padding:8px 6px;border-top:1px solid ${C.div};text-align:right;white-space:nowrap;${style}">${content}</td>`;
const header = (labels: string[]) => `<tr style="color:${C.muted};font-size:10.5px;text-transform:uppercase;letter-spacing:.06em">${labels.map((label, index) => `<td style="padding:6px ${index ? "6px" : "0"};font-weight:700;text-align:${index ? "right" : "left"}">${label}</td>`).join("")}</tr>`;
const section = (id: string, title: string, subtitle: string) => `<tr><td id="${id}" style="padding:30px 28px 0"><div style="font-size:17px;font-weight:800">${escapeHtml(title)}</div><div style="font-size:12.5px;color:${C.muted};margin-top:2px">${escapeHtml(subtitle)}</div></td></tr>`;
const backToTop = `<tr><td style="padding:10px 28px 0;font-size:12px"><a href="#topo" style="color:${C.muted}">↑ voltar ao topo</a></td></tr>`;
const blank = (width: string, background: string, height: number, extra = "") => `<td width="${width}" style="background:${background};height:${height}px;font-size:0;line-height:0;${extra}">&nbsp;</td>`;

function progressBar(realizedPct: number, expectedPct: number, height = 12) {
  const realized = Math.min(Math.max(realizedPct, 0), 100), expected = Math.min(Math.max(expectedPct, 0), 100);
  const marker = `<td width="2" style="background:${C.ink};height:${height + 6}px;font-size:0;line-height:0">&nbsp;</td>`;
  const cells = realized >= expected
    ? `${expected > 0 ? blank(`${expected.toFixed(1)}%`, C.accent, height) : ""}${marker}${realized > expected ? blank(`${(realized - expected).toFixed(1)}%`, C.accent, height) : ""}`
    : `${realized > 0 ? blank(`${realized.toFixed(1)}%`, C.accent, height) : ""}${blank(`${(expected - realized).toFixed(1)}%`, C.track, height)}${marker}`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}<td style="background:${C.track};height:${height}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

function goalLegend(goal: { realized: number; expected: number; target: number; up: number | null; top: number | null }, cutDate: string) {
  const gap = goal.realized - goal.expected;
  const block = (label: string, value: string, sub: string, align: string, color: string = C.ink) => `<td width="33%" valign="top" style="padding-top:6px;text-align:${align}"><div style="font-size:10.5px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.06em">${label}</div><div style="font-size:14px;font-weight:800;color:${color}">${value}</div><div style="font-size:11px;color:${C.muted}">${sub}</div></td>`;
  const tiers = ([["Meta UP", goal.up], ["Meta TOP", goal.top]] as Array<[string, number | null]>).filter(tier => tier[1])
    .map(([label, value]) => `<strong style="color:${C.ink}">${label} ${brl(value!)}</strong> · ${goal.realized >= value! ? "atingida" : `faltam ${brl(value! - goal.realized)}`}`).join(" &nbsp;|&nbsp; ");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${block("Realizado", brl(goal.realized), `${pct(goal.realized / goal.target * 100)} da meta`, "left", C.accent)}${block(`Esperado até ${shortDate(cutDate)}`, brl(goal.expected), `${pct(goal.expected / goal.target * 100)} da meta`, "center")}${block("Meta Alvo", brl(goal.target), goal.realized >= goal.target ? "atingida" : `faltam ${brl(goal.target - goal.realized)}`, "right")}</tr></table>${tiers ? `<div style="font-size:11.5px;color:${C.muted};margin-top:6px;text-align:right">${tiers}</div>` : ""}<div style="font-size:11px;color:${C.muted};margin-top:2px;text-align:right">Percentuais, esperado e status usam a Meta Alvo.</div><div style="font-size:12px;margin-top:6px;color:${gap >= 0 ? C.ok : C.bad};font-weight:700">${gap >= 0 ? `${brl(gap)} acima do esperado` : `${brl(-gap)} abaixo do esperado`}</div>`;
}

function dayStrip(report: Report, daily: Record<string, number>) {
  const dates = dateRange(report.input.weekStart, report.input.weekEnd);
  const present = dates.filter(date => daily[date] != null);
  const max = Math.max(...present.map(date => daily[date]), 1), min = Math.min(...present.map(date => daily[date]));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="2" style="font-size:10.5px;text-align:center"><tr>${dates.map(date => {
    const value = daily[date];
    if (value == null) return `<td style="background:#ffffff;border:1px dashed ${C.border};color:${C.muted};padding:6px 0;border-radius:4px">${WEEKDAYS[weekday(date)]}<br><strong>sem dado</strong></td>`;
    const ratio = value / max;
    const [background, color] = ratio > .85 ? [C.accent, "#ffffff"] : ratio > .65 ? ["#ec9ab8", "#ffffff"] : ratio > .45 ? ["#f5c6d7", C.bad] : [C.badBg, C.bad];
    return `<td style="background:${background};color:${color};padding:6px 0;border-radius:4px">${WEEKDAYS[weekday(date)]}<br><strong>${num(value / 100)}</strong>${value === max ? " ★" : value === min ? " ▾" : ""}</td>`;
  }).join("")}</tr></table>`;
}

export function renderHtml(report: Report) {
  const { input, network, units } = report;
  const cut = shortDate(input.monthEnd);
  const subject = renderSubject(report), preheader = renderPreheader(report);
  const tone = { good: ["✓", C.ok], bad: ["!", C.bad], idea: ["→", C.info] } as const;
  const weekChange = delta(network.week.perDay, network.previous.perDay);
  const coverage = report.quality.weekHave < report.quality.weekExpected
    ? `<tr><td style="padding:16px 28px 0"><div style="background:${C.warnBg};border:1px solid #f5d9a3;border-radius:10px;padding:10px 12px;font-size:12.5px;color:${C.warn}"><strong>Semana com ${report.quality.weekHave} de ${report.quality.weekExpected} dias de dados.</strong> Os totais somam só os dias com relatório e as comparações usam a média por dia aberto. <a href="#qualidade" style="color:${C.warn}">Ver detalhes</a></div></td></tr>`
    : "";
  const goal = network.goal;
  const summaryRows: Array<[string, string, string]> = [
    ["Pedidos", num(network.week.coupons), num(network.monthToDate.coupons)],
    ["Ticket médio", network.week.ticket ? brl(network.week.ticket, 2) : "—", network.monthToDate.ticket ? brl(network.monthToDate.ticket, 2) : "—"],
    ["Itens vendidos", num(network.week.items), num(network.monthToDate.items)],
    ["Itens por pedido", network.week.coupons ? num(network.week.items / network.week.coupons, 2) : "—", network.monthToDate.coupons ? num(network.monthToDate.items / network.monthToDate.coupons, 2) : "—"],
    ["Média por dia aberto", brl(network.week.perDay), brl(network.monthToDate.perDay)],
    ["Meta Alvo (UP · TOP)", "sem meta semanal", goal ? `${brl(goal.target)}${goal.up || goal.top ? ` <span style="color:${C.muted}">(${[goal.up, goal.top].filter((value): value is number => Boolean(value)).map(value => brl(value)).join(" · ")})</span>` : ""}` : "—"],
    ["Atingimento da Alvo", "—", goal ? `${pct(goal.realized / goal.target * 100)} <span style="color:${C.muted}">(esperado ${pct(goal.expected / goal.target * 100)})</span>` : "—"],
    ["Unidades no ritmo", "—", `${units.filter(unit => unit.goal && unit.goal.pace >= input.thresholds.onTrack).length} de ${units.filter(unit => unit.goal).length}`],
  ];
  let html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:20px 12px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.border}">
<tr><td id="topo" style="background:${C.ink};padding:24px 28px"><div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${C.kicker}">Coala One · Metas</div><div style="font-size:26px;font-weight:800;color:#ffffff;margin-top:6px">${REPORT_NAME}</div><div style="font-size:13px;color:#c9c7cf;margin-top:4px">Semana de ${shortDate(input.weekStart)} a ${shortDate(input.weekEnd)} · mês de ${shortDate(input.monthStart)} a ${cut}</div></td></tr>
<tr><td style="padding:12px 28px;background:${C.warm};border-bottom:1px solid ${C.border};font-size:12.5px">${[["resumo", "Resumo"], ["unidades", "Unidades"], ["produtos", "Produtos"], ["tendencia", "6 meses"], ["qualidade", "Qualidade dos dados"]].map(([anchor, label]) => `<a href="#${anchor}" style="color:${C.bad};font-weight:700;text-decoration:none">${label}</a>`).join(` <span style="color:#b8b4ab">·</span> `)}</td></tr>
${coverage}
<tr><td style="padding:22px 28px 0"><div style="font-size:17px;font-weight:800">Em 30 segundos</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px;margin-top:8px">${readingLines(report).map(line => `<tr><td width="22" valign="top" style="padding:6px 0;color:${tone[line.tone][1]};font-weight:800">${tone[line.tone][0]}</td><td style="padding:6px 0"><strong>${escapeHtml(line.title)}</strong> ${escapeHtml(line.text)}</td></tr>`).join("")}</table></td></tr>`;

  html += section("resumo", "Resumo da rede", `Soma das ${units.length} unidades. A meta é mensal de faturamento; metas de ticket e produto ficam em cada unidade.`);
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="50%" valign="top" style="padding-right:6px"><div style="background:${C.badBg};border-radius:12px;padding:14px 16px"><div style="font-size:11.5px;font-weight:800;color:${C.bad};text-transform:uppercase;letter-spacing:.08em">Semana · ${network.week.have}/${network.week.expected} dias</div><div style="font-size:26px;font-weight:800;margin-top:4px">${brl(network.week.cents)}</div><div style="font-size:12.5px;margin-top:2px">${arrow(weekChange)} <span style="color:${C.muted}">por dia vs. semana anterior</span></div><div style="font-size:12.5px">${arrow(delta(network.week.perDay, network.historyPerDay))} <span style="color:${C.muted}">por dia vs. média de ${network.historyWeeks} semanas</span></div></div></td>
<td width="50%" valign="top" style="padding-left:6px"><div style="background:${C.warm};border-radius:12px;padding:14px 16px"><div style="font-size:11.5px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.08em">Mês até ${cut} · ${network.monthToDate.have}/${network.monthToDate.expected} dias</div><div style="font-size:26px;font-weight:800;margin-top:4px">${brl(network.monthToDate.cents)}</div><div style="font-size:12.5px;margin-top:2px">${arrow(delta(network.monthToDate.perDay, network.monthPriorPerDay))} <span style="color:${C.muted}">por dia vs. mesmos dias de ${network.monthPriorCount} meses</span></div>${goal ? `<div style="font-size:12.5px;color:${C.muted}">Projeção de fechamento: ${brl(goal.projection)}</div>` : ""}</div></td></tr></table></td></tr>`;
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${header(["Indicador", "Semana", `Mês até ${cut}`])}${summaryRows.map(row => `<tr>${cell(row[0])}${cellRight(row[1])}${cellRight(row[2])}</tr>`).join("")}</table></td></tr>`;
  if (goal) {
    html += `<tr><td style="padding:14px 28px 0"><div style="font-size:12px;font-weight:700;color:${C.muted};margin-bottom:6px">Meta mensal da rede · ${statusPill(report, goal.realized / goal.expected * 100)}</div>${progressBar(goal.realized / goal.target * 100, goal.expected / goal.target * 100)}${goalLegend(goal, input.monthEnd)}<div style="font-size:11.5px;color:${C.muted};margin-top:2px">Projeção de fechamento: ${brl(goal.projection)} · a marca preta na barra é o esperado até ${cut}</div></td></tr>`;
  }
  html += `<tr><td style="padding:14px 28px 0"><a href="${escapeHtml(input.links.goals)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:11px 18px;border-radius:9px">Abrir metas no Coala One</a></td></tr>`;

  const ranked = [...units].sort((left, right) => right.week.cents - left.week.cents);
  html += section("unidades", "Unidades lado a lado", "Ordem pelo faturamento da semana. Barra = participação na rede. Comparação por dia aberto.");
  html += `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${header(["Unidade", "Semana", "vs. sem. ant.", "Ticket", "Mês"])}${ranked.map(unit => {
    const share = network.week.cents ? unit.week.cents / network.week.cents * 100 : 0;
    return `<tr>${cell(`<strong>${escapeHtml(unit.name)}</strong>`, "padding-bottom:4px")}${cellRight(brl(unit.week.cents), "padding-bottom:4px")}${cellRight(arrow(delta(unit.week.perDay, unit.previous.perDay)), "padding-bottom:4px")}${cellRight(unit.week.ticket ? brl(unit.week.ticket, 2) : "—", "padding-bottom:4px")}${cellRight(unit.goal ? statusPill(report, unit.goal.pace) : "sem meta", "padding-bottom:4px;padding-right:0")}</tr><tr><td colspan="5" style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${blank(`${share.toFixed(1)}%`, C.accent, 6, "border-radius:3px")}<td style="font-size:11px;color:${C.muted};padding-left:6px">${pct(share)}${unit.partialHistory ? " · histórico parcial" : ""}</td></tr></table></td></tr>`;
  }).join("")}</table></td></tr>`;

  for (const unit of units) {
    const bestDay = Object.entries(unit.week.daily).sort((left, right) => right[1] - left[1])[0];
    const share = network.week.cents ? unit.week.cents / network.week.cents * 100 : 0;
    html += `<tr><td style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px">
<tr><td style="padding:14px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:800">${escapeHtml(unit.name)}</td><td align="right">${unit.goal ? statusPill(report, unit.goal.pace) : ""}</td></tr></table><div style="font-size:12px;color:${C.muted};margin-top:2px">${pct(share)} da rede${unit.top[0] ? ` · produto líder: ${escapeHtml(unit.top[0].name)}` : ""}${unit.partialHistory ? ` · histórico desde ${shortDate(unit.firstDate)}` : ""}</div></td></tr>
<tr><td style="padding:10px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">${header(["", "Semana", `Mês até ${cut}`])}
<tr>${cell("Faturamento")}${cellRight(`<strong>${brl(unit.week.cents)}</strong>`)}${cellRight(`<strong>${brl(unit.monthToDate.cents)}</strong>`)}</tr>
<tr>${cell("Pedidos · ticket")}${cellRight(`${num(unit.week.coupons)} · ${unit.week.ticket ? brl(unit.week.ticket, 2) : "—"}`)}${cellRight(`${num(unit.monthToDate.coupons)} · ${unit.monthToDate.ticket ? brl(unit.monthToDate.ticket, 2) : "—"}`)}</tr>
<tr>${cell("Itens · por pedido")}${cellRight(`${num(unit.week.items)} · ${unit.week.coupons ? num(unit.week.items / unit.week.coupons, 2) : "—"}`)}${cellRight(`${num(unit.monthToDate.items)} · ${unit.monthToDate.coupons ? num(unit.monthToDate.items / unit.monthToDate.coupons, 2) : "—"}`)}</tr>
<tr>${cell("Média por dia aberto")}${cellRight(`${brl(unit.week.perDay)} ${arrow(delta(unit.week.perDay, unit.previous.perDay))}`)}${cellRight(brl(unit.monthToDate.perDay))}</tr>
<tr>${cell("Meta do mês")}${cellRight("sem meta semanal", `color:${C.muted}`)}${cellRight(unit.goal ? `Alvo ${brl(unit.goal.target)} · faltam ${brl(Math.max(unit.goal.target - unit.goal.realized, 0))}` : "sem meta")}</tr></table></td></tr>`;
    if (unit.goal) {
      const g = unit.goal;
      html += `<tr><td style="padding:10px 16px 0">${progressBar(g.realized / g.target * 100, g.expected / g.target * 100, 10)}${goalLegend(g, input.monthEnd)}<div style="font-size:11.5px;color:${C.muted};margin-top:2px">Ritmo ${pct(g.pace, 0)} do esperado · projeção ${brl(g.projection)}${g.remainingDays ? ` · precisa de ${brl(g.neededPerDay)}/dia nos ${g.remainingDays} dias restantes` : ""}${g.next ? ` · próximo patamar: ${g.next.label} (${brl(g.next.value)})` : " · projeção acima da Meta TOP"}${g.source === "calendar" ? " · distribuição pelos dias do calendário" : ""}</div></td></tr>`;
    }
    html += `<tr><td style="padding:10px 16px 0"><div style="font-size:11px;font-weight:700;color:${C.muted};margin-bottom:4px">A semana dia a dia (R$)${bestDay ? ` · melhor dia: ${WEEKDAYS[weekday(bestDay[0])]} ${shortDate(bestDay[0])}` : ""}</div>${dayStrip(report, unit.week.daily)}</td></tr>
<tr><td style="padding:12px 16px 14px"><div style="font-size:11px;font-weight:700;color:${C.muted};margin-bottom:2px">10 produtos com maior faturamento na semana</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px">${header(["Produto", "Qtd.", "Faturamento", "vs. sem. ant.", "vs. 6 meses"])}${unit.top.map((product, index) => `<tr>${cell(`<span style="color:${C.muted}">${index + 1}.</span> ${escapeHtml(product.name)}<div style="font-size:10.5px;color:${C.muted}">${pct(product.share)} da unidade · sem. ant. ${num(product.previousQty)} un${product.historyWeekly != null ? ` · média ${num(product.historyWeekly)} un/sem.` : ""}</div>`)}${cellRight(num(product.qty))}${cellRight(brl(product.cents))}${cellRight(arrow(product.vsPrevious, 0))}${cellRight(product.vsHistory == null ? `<span style="color:${C.muted}">novo</span>` : arrow(product.vsHistory, 0), "padding-right:0")}</tr>`).join("")}</table><div style="font-size:10.5px;color:${C.muted};margin-top:6px">Comparações por dia aberto: a semana teve ${unit.week.have} dias com dado; a anterior, ${unit.previous.have}. Média de 6 meses = ${unit.historyWeeks} semanas completas.</div><div style="font-size:12px;margin-top:8px"><a href="${escapeHtml(input.links.analysis)}" style="color:${C.bad};font-weight:700">Ver análise de ${escapeHtml(unit.name)}</a></div></td></tr></table></td></tr>`;
  }
  html += backToTop;

  html += section("produtos", "Produtos da rede", "Altas e quedas por dia aberto, só com pelo menos 20 unidades nas duas semanas.");
  const moverBox = (title: string, list: Report["movers"], color: string, background: string) => `<div style="background:${background};border-radius:10px;padding:10px 12px"><div style="font-size:11px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:.08em">${title}</div>${list.length ? list.map(item => `<div style="margin-top:4px">${escapeHtml(item.name)} <strong style="color:${color}">${item.change > 0 ? "+" : "−"}${pct(Math.abs(item.change), 0)}</strong> <span style="color:${C.muted}">· ${num(item.qty)} un</span></div>`).join("") : `<div style="margin-top:4px;color:${C.muted}">Nenhum</div>`}</div>`;
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px"><tr><td width="50%" valign="top" style="padding-right:6px">${moverBox("Maiores altas", report.movers.filter(item => item.change > 0).slice(0, 3), C.ok, C.okBg)}</td><td width="50%" valign="top" style="padding-left:6px">${moverBox("Maiores quedas", report.movers.filter(item => item.change < 0).slice(-3).reverse(), C.bad, C.badBg)}</td></tr></table>
<div style="font-size:12px;color:${C.muted};margin-top:8px">Novos, sem comparação: ${report.newProducts.length ? escapeHtml(report.newProducts.map(item => `${item.name} (${num(item.qty)} un)`).join(", ")) : "nenhum"}. Sem venda na semana, mas vendiam: ${report.missingProducts.length ? escapeHtml(report.missingProducts.map(item => `${item.name} (média de ${num(item.weekly)} un/semana)`).join(", ")) : "nenhum"}.</div></td></tr>`;
  html += backToTop;

  const maxMonth = Math.max(...report.trend.map(entry => entry.cents), 1);
  const bestMonth = [...report.trend].filter(entry => !entry.projected).sort((left, right) => right.cents - left.cents)[0]?.month;
  html += section("tendencia", "Últimos 6 meses", "Faturamento mensal da rede. O mês atual é projeção.");
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px">${report.trend.map(entry => `<tr><td width="40" style="padding:4px 0;color:${C.muted}">${MONTHS[Number(entry.month.slice(5)) - 1]}</td><td style="padding:4px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${blank(`${(entry.cents / maxMonth * 78).toFixed(1)}%`, entry.projected ? C.track : entry.month === bestMonth ? C.accent : "#f5c6d7", 14, `border-radius:3px;${entry.projected ? `border:1px dashed ${C.accent};` : ""}`)}<td style="padding-left:6px;white-space:nowrap">${compactBrl(entry.cents)}${entry.attainment != null ? ` · <span style="color:${entry.attainment >= 100 ? C.ok : C.bad}">${pct(entry.attainment, 0)}</span>` : ""}${entry.projected ? " · proj." : entry.month === bestMonth ? " ★" : ""}</td></tr></table></td></tr>`).join("")}</table><div style="font-size:11.5px;color:${C.muted};margin-top:6px">% = atingimento da Meta Alvo somada das unidades com meta no mês. ★ melhor mês.</div></td></tr>`;
  html += `<tr><td style="padding:14px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">${header(["Unidade", "Ticket", "Bateu a Alvo", "Variação mensal"])}${units.map(unit => `<tr>${cell(`<strong>${escapeHtml(unit.name)}</strong>`)}${cellRight(unit.firstTicket && unit.monthToDate.ticket ? `${brl(unit.firstTicket, 2)} → ${brl(unit.monthToDate.ticket, 2)}` : "—")}${cellRight(`${unit.goalsHit} de ${unit.goalsClosed} meses`)}${cellRight(unit.variation == null ? `<span style="color:${C.muted}">Histórico parcial</span>` : unit.variation < 10 ? `Estável (${pct(unit.variation, 0)})` : `<span style="color:${C.warn};font-weight:700">Oscila (${pct(unit.variation, 0)})</span>`, "padding-right:0")}</tr>`).join("")}</table><div style="font-size:11px;color:${C.muted};margin-top:6px">Ticket a partir do primeiro mês com contagem de cupons nos relatórios.</div></td></tr>`;
  html += backToTop;

  const q = report.quality;
  const qualityRows: Array<[string, string, string]> = [
    ["Dias da semana com relatório", `${q.weekHave} de ${q.weekExpected}`, q.weekHave < q.weekExpected ? C.warn : C.ok],
    ["Dias do mês com relatório", `${q.monthHave} de ${q.monthExpected}`, q.monthHave < q.monthExpected ? C.warn : C.ok],
    ["Dias sem relatório", report.missingDays.join(", ") || "nenhum", report.missingDays.length ? C.warn : C.ok],
    ["Dias do histórico de 6 meses em formato legado", `${q.historyLegacy} de ${q.historyHave}`, q.historyLegacy ? C.warn : C.ok],
    ["Unidades sem 6 meses completos", units.filter(unit => unit.partialHistory).map(unit => unit.name).join(", ") || "nenhuma", C.muted],
    ["Unidades sem meta no mês", units.filter(unit => !unit.goal).map(unit => unit.name).join(", ") || "nenhuma", units.some(unit => !unit.goal) ? C.warn : C.ok],
  ];
  html += section("qualidade", "Qualidade dos dados", "O que sustenta os números acima.");
  html += `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">${qualityRows.map(row => `<tr>${cell(row[0], "padding:7px 0")}${cellRight(row[1], `padding:7px 0;color:${row[2]};font-weight:700;white-space:normal`)}</tr>`).join("")}</table></td></tr>`;
  html += `<tr><td style="padding:26px 28px 24px"><div style="border-top:1px solid ${C.border};padding-top:14px;font-size:11.5px;line-height:1.6;color:${C.muted}">${footerLines(report).map(escapeHtml).join("<br>")}</div></td></tr></table></td></tr></table></body></html>`;
  return html;
}

function footerLines(report: Report) {
  const { onTrack, attention } = report.input.thresholds;
  return [
    "Relatório automático de toda segunda-feira. Nenhuma meta, venda ou lançamento financeiro é alterado.",
    "Receita = vendas do PDV comprovadas nos cupons; não inclui recebimentos da Stone nem entradas bancárias. Dia sem relatório não conta como zero.",
    `Status do mês: No ritmo ≥ ${num(onTrack)}% do esperado · Atenção ${num(attention)}–${num(onTrack - 1)}% · Em risco < ${num(attention)}%.`,
  ];
}

export function renderText(report: Report) {
  const { input, network, units } = report;
  const cut = shortDate(input.monthEnd);
  const lines = [renderSubject(report), `Semana de ${shortDate(input.weekStart)} a ${shortDate(input.weekEnd)} · mês de ${shortDate(input.monthStart)} a ${cut}`, ""];
  if (report.quality.weekHave < report.quality.weekExpected) lines.push(`Atenção: semana com ${report.quality.weekHave} de ${report.quality.weekExpected} dias de dados. Comparações por dia aberto.`, "");
  lines.push("EM 30 SEGUNDOS", ...readingLines(report).map(line => `- ${line.title} ${line.text}`), "");
  lines.push("RESUMO DA REDE", `Semana: ${brl(network.week.cents)} · ${num(network.week.coupons)} pedidos · ticket ${network.week.ticket ? brl(network.week.ticket, 2) : "—"}`, `Mês até ${cut}: ${brl(network.monthToDate.cents)}`);
  if (network.goal) lines.push(`Meta Alvo: ${brl(network.goal.target)} · realizado ${brl(network.goal.realized)} · esperado ${brl(network.goal.expected)} · projeção ${brl(network.goal.projection)}`, [network.goal.up ? `Meta UP ${brl(network.goal.up)}` : "", network.goal.top ? `Meta TOP ${brl(network.goal.top)}` : ""].filter(Boolean).join(" · "));
  lines.push(`Abrir metas: ${input.links.goals}`, "");
  for (const unit of units) {
    lines.push(unit.name.toLocaleUpperCase("pt-BR"), `Semana: ${brl(unit.week.cents)} · ${num(unit.week.coupons)} pedidos · ticket ${unit.week.ticket ? brl(unit.week.ticket, 2) : "—"} · ${unit.week.have}/${unit.week.expected} dias`);
    if (unit.goal) lines.push(`Meta: ${statusOf(report, unit.goal.pace)} · realizado ${brl(unit.goal.realized)} de ${brl(unit.goal.target)} (esperado ${brl(unit.goal.expected)}) · projeção ${brl(unit.goal.projection)}`);
    lines.push("10 produtos:", ...unit.top.map((product, index) => `  ${index + 1}. ${product.name}: ${num(product.qty)} un · ${brl(product.cents)}`), "");
  }
  lines.push("QUALIDADE DOS DADOS", `Dias da semana com relatório: ${report.quality.weekHave} de ${report.quality.weekExpected}`, `Dias sem relatório: ${report.missingDays.join(", ") || "nenhum"}`, "", ...footerLines(report));
  return lines.join("\n");
}
