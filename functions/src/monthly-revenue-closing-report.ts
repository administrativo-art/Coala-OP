/**
 * Placar Coala — fechamento mensal de faturamento e metas.
 * Módulo puro: recebe os dados já lidos (mesmo `ReportInput` do semanal, com a janela do mês fechado)
 * e devolve números, assunto, HTML e texto. Reaproveita agregação e componentes visuais do semanal.
 * Especificação: docs/engineering/monthly-revenue-closing-email.md
 */
import {
  C, MONTHS, REPORT_NAME, WEEKDAYS, addDays, aggregate, arrow, backToTop, blank, brl, cell, cellRight, compactBrl, dateRange, delta,
  escapeHtml, header, lastDayOfMonth, localDate, monthOf, num, pct, pill, previousMonth, productName, progressBar, section, shortDate, weekday,
  type Aggregate, type GoalMonth, type ReportInput, type SalesDay,
} from "./weekly-revenue-goals-report.js";

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5)) - 1]}/${month.slice(0, 4)}`;

/** Mês civil anterior à data local de envio, completo (do dia 1 ao último dia). */
export function closingWindow(now: Date) {
  const month = previousMonth(localDate(now).slice(0, 7), 1);
  const monthEnd = lastDayOfMonth(month);
  return { weekStart: addDays(monthEnd, -6), weekEnd: monthEnd, monthStart: `${month}-01`, monthEnd };
}

type Tier = "Meta TOP" | "Meta UP" | "Meta Alvo" | null;

export function buildClosingReport(input: ReportInput) {
  const { monthStart, monthEnd, units } = input;
  const month = monthOf(monthStart);
  const byKey = new Map<string, SalesDay>(input.days.map(day => [`${day.kioskId}|${day.date}`, day]));
  const firstDate: Record<string, string> = {};
  for (const day of input.days) if (!firstDate[day.kioskId] || day.date < firstDate[day.kioskId]) firstDate[day.kioskId] = day.date;
  const agg = (ids: string[], start: string, end: string) => aggregate(byKey, firstDate, ids, start, end);
  const fullMonth = (ids: string[], value: string) => agg(ids, `${value}-01`, lastDayOfMonth(value));
  const previous = previousMonth(month, 1);
  const prior = (ids: string[]) => [2, 3, 4, 5, 6].map(back => fullMonth(ids, previousMonth(month, back))).filter(value => value.expected && value.have === value.expected);
  const average = (values: Aggregate[]) => values.length ? values.reduce((total, value) => total + value.perDay, 0) / values.length : null;

  const goalOf = (unitId: string) => input.goals.find(entry => entry.kioskId === unitId && entry.month === month) ?? null;
  const tierOf = (realized: number, goal: GoalMonth): Tier =>
    goal.top && realized >= goal.top * 100 ? "Meta TOP" : goal.up && realized >= goal.up * 100 ? "Meta UP" : realized >= goal.target * 100 ? "Meta Alvo" : null;
  const streak = (unitId: string) => {
    let count = 0;
    for (let back = 1; back <= 6; back++) {
      const entry = input.goals.find(goal => goal.kioskId === unitId && goal.month === previousMonth(month, back) && goal.status === "closed");
      if (!entry || entry.current < entry.target) break;
      count++;
    }
    return count;
  };

  const unitReports = units.filter(unit => firstDate[unit.id] && firstDate[unit.id] <= monthEnd).map(unit => {
    const current = agg([unit.id], monthStart, monthEnd);
    const before = fullMonth([unit.id], previous);
    const goal = goalOf(unit.id);
    const closed = goal?.status === "closed";
    const realized = goal ? Math.round((closed ? goal.current : Object.entries(goal.dailyProgress).filter(([date]) => date <= monthEnd).reduce((total, [, value]) => total + value, 0)) * 100) : 0;
    const days = Object.entries(current.daily).sort((left, right) => right[1] - left[1]);
    const byWeekday = WEEKDAYS.map((label, index) => {
      const values = dateRange(monthStart, monthEnd).filter(date => weekday(date) === index && byKey.has(`${unit.id}|${date}`)).map(date => byKey.get(`${unit.id}|${date}`)!.revenueCents);
      return { label, average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null };
    });
    const top = Object.entries(current.products).sort((left, right) => right[1].cents - left[1].cents).slice(0, 5)
      .map(([, product]) => ({ name: productName(product.name), qty: product.qty, cents: product.cents, share: current.cents ? product.cents / current.cents * 100 : 0 }));
    return {
      ...unit, firstDate: firstDate[unit.id], current, before, priorPerDay: average(prior([unit.id])), top, byWeekday,
      bestDay: days[0] ?? null, worstDay: days.length > 1 ? days[days.length - 1] : null,
      goal: goal ? { target: goal.target * 100, up: goal.up ? goal.up * 100 : null, top: goal.top ? goal.top * 100 : null, realized, closed, tier: tierOf(realized, goal), hit: realized >= goal.target * 100, streak: closed ? streak(unit.id) : 0 } : null,
    };
  });

  const ids = unitReports.map(unit => unit.id);
  const current = agg(ids, monthStart, monthEnd);
  const before = fullMonth(ids, previous);
  const goalUnits = unitReports.filter(unit => unit.goal);
  const sum = (pick: (unit: typeof unitReports[number]) => number) => goalUnits.reduce((total, unit) => total + pick(unit), 0);
  const network = {
    current, before, priorPerDay: average(prior(ids)), priorCount: prior(ids).length,
    goal: goalUnits.length ? {
      target: sum(unit => unit.goal!.target), realized: sum(unit => unit.goal!.realized),
      up: goalUnits.every(unit => unit.goal!.up) ? sum(unit => unit.goal!.up!) : null,
      top: goalUnits.every(unit => unit.goal!.top) ? sum(unit => unit.goal!.top!) : null,
      hit: goalUnits.filter(unit => unit.goal!.hit).length, total: goalUnits.length, allClosed: goalUnits.every(unit => unit.goal!.closed),
    } : null,
  };

  const beforeProducts = before.products;
  const movers = Object.entries(current.products)
    .filter(([id, product]) => product.qty >= 30 && (beforeProducts[id]?.qty ?? 0) >= 30 && current.have && before.have)
    .map(([id, product]) => ({ name: productName(product.name), qty: product.qty, change: delta(product.qty / current.have, beforeProducts[id].qty / before.have)! }))
    .sort((left, right) => right.change - left.change);
  const productsByCents = Object.entries(current.products).sort((left, right) => right[1].cents - left[1].cents).slice(0, 5)
    .map(([, product]) => ({ name: productName(product.name), qty: product.qty, cents: product.cents, share: current.cents ? product.cents / current.cents * 100 : 0 }));
  const productsByQty = Object.entries(current.products).sort((left, right) => right[1].qty - left[1].qty).slice(0, 5)
    .map(([, product]) => ({ name: productName(product.name), qty: product.qty, cents: product.cents }));
  const newProducts = Object.entries(current.products).filter(([id]) => !fullMonth(ids, previous).products[id] && !prior(ids).some(value => value.products[id])).map(([, product]) => ({ name: productName(product.name), qty: product.qty }));
  const missingProducts = Object.entries(beforeProducts).filter(([id, product]) => product.qty >= 30 && !current.products[id]).map(([, product]) => ({ name: productName(product.name), qty: product.qty }));

  const weekdayNetwork = WEEKDAYS.map((label, index) => {
    const values = dateRange(monthStart, monthEnd).filter(date => weekday(date) === index && current.daily[date] != null).map(date => current.daily[date]);
    return { label, average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : null };
  });

  const trend = [5, 4, 3, 2, 1, 0].map(back => previousMonth(month, back)).map(value => {
    const total = fullMonth(ids, value);
    const goals = input.goals.filter(goal => goal.month === value && ids.includes(goal.kioskId));
    const targets = goals.reduce((acc, goal) => acc + goal.target, 0);
    const realized = goals.reduce((acc, goal) => acc + (goal.status === "closed" || value !== month ? goal.current : Object.values(goal.dailyProgress).reduce((x, y) => x + y, 0)), 0);
    return { month: value, cents: total.cents, attainment: targets ? realized / targets * 100 : null };
  });

  const missingDays: string[] = [];
  for (const unit of unitReports) for (const date of dateRange(monthStart, monthEnd)) {
    if (date >= unit.firstDate && !byKey.has(`${unit.id}|${date}`)) missingDays.push(`${unit.name} ${shortDate(date)}`);
  }
  return {
    input, month, units: unitReports, network, movers, productsByCents, productsByQty, newProducts, missingProducts, weekdayNetwork, trend, missingDays,
    unitsWithoutGoal: unitReports.filter(unit => !unit.goal).map(unit => unit.name),
    quality: { have: current.have, expected: current.expected, legacy: current.legacy, lastDayMissing: unitReports.some(unit => !byKey.has(`${unit.id}|${monthEnd}`)) },
  };
}

export type ClosingReport = ReturnType<typeof buildClosingReport>;

export function closingCoverage(report: ClosingReport) {
  return report.quality.expected ? report.quality.have / report.quality.expected : 0;
}

export function closingLines(report: ClosingReport) {
  const { units, network, movers } = report;
  const lines: Array<{ tone: "good" | "bad" | "idea"; title: string; text: string }> = [];
  const leader = [...units].sort((left, right) => right.current.cents - left.current.cents)[0];
  if (leader && network.current.cents) lines.push({ tone: "good", title: `${leader.name} liderou o mês:`, text: `${brl(leader.current.cents)}, ${pct(leader.current.cents / network.current.cents * 100)} da rede${leader.current.ticket ? `, ticket de ${brl(leader.current.ticket, 2)}` : ""}.` });
  const dayChange = delta(network.current.perDay, network.before.perDay);
  if (dayChange != null) lines.push({ tone: dayChange >= 0 ? "good" : "bad", title: `Venda por dia aberto ${dayChange >= 0 ? "subiu" : "caiu"} ${pct(Math.abs(dayChange))} sobre ${monthLabel(previousMonth(report.month, 1))}:`, text: `${brl(network.current.perDay)} por unidade-dia, contra ${brl(network.before.perDay)}.` });
  for (const unit of units.filter(entry => entry.goal?.hit).slice(0, 2)) lines.push({ tone: "good", title: `${unit.name} bateu a Meta Alvo${unit.goal!.tier && unit.goal!.tier !== "Meta Alvo" ? ` e chegou à ${unit.goal!.tier}` : ""}:`, text: `${brl(unit.goal!.realized)} para ${brl(unit.goal!.target)} de meta.` });
  const missed = units.filter(unit => unit.goal && !unit.goal.hit);
  if (missed.length) lines.push({ tone: "bad", title: `${missed.map(unit => unit.name).join(" e ")} não bateu a Meta Alvo:`, text: `${missed.map(unit => `${unit.name} ficou ${brl(unit.goal!.target - unit.goal!.realized)} abaixo (${pct(unit.goal!.realized / unit.goal!.target * 100, 0)})`).join("; ")}.` });
  const days = Object.entries(network.current.daily).sort((left, right) => right[1] - left[1]);
  if (days[0]) lines.push({ tone: "good", title: `Melhor dia da rede: ${WEEKDAYS[weekday(days[0][0])]} ${shortDate(days[0][0])}`, text: `${brl(days[0][1])} somando as unidades com relatório.` });
  if (movers[0] && movers[0].change > 0) lines.push({ tone: "good", title: `${movers[0].name} foi a maior alta:`, text: `${num(movers[0].qty)} unidades, +${pct(movers[0].change, 0)} por dia aberto sobre o mês anterior.` });
  const worst = movers[movers.length - 1];
  if (worst && worst.change < 0) lines.push({ tone: "idea", title: "Oportunidade:", text: `${worst.name} caiu ${pct(Math.abs(worst.change), 0)} por dia aberto (${num(worst.qty)} un). Vale conferir exposição e estoque para ${monthLabel(nextMonth(report.month))}.` });
  return lines;
}

const nextMonth = (month: string) => previousMonth(month, -1);

export function closingSubject(report: ClosingReport) {
  const { network } = report;
  const change = delta(network.current.perDay, network.before.perDay);
  const changeText = change == null ? "" : ` (${change >= 0 ? "+" : "−"}${pct(Math.abs(change))} por dia)`;
  const goalText = network.goal ? ` · ${network.goal.hit} de ${network.goal.total} unidades bateram a Meta Alvo${network.goal.allClosed ? "" : " (apuração aberta)"}` : "";
  return `${REPORT_NAME} — Fechamento de ${monthLabel(report.month)}: ${compactBrl(network.current.cents)}${changeText}${goalText}`;
}

const tierPill = (tier: Tier, closed: boolean) => !closed ? pill("Em apuração", C.warnBg, C.warn)
  : tier === null ? pill("Meta não atingida", C.badBg, C.bad) : pill(`${tier} atingida`, C.okBg, C.ok);

function goalBlock(goal: { target: number; up: number | null; top: number | null; realized: number }) {
  const gap = goal.realized - goal.target;
  const tiers = ([["Meta UP", goal.up], ["Meta TOP", goal.top]] as Array<[string, number | null]>).filter(tier => tier[1])
    .map(([label, value]) => `<strong style="color:${C.ink}">${label} ${brl(value!)}</strong> · ${goal.realized >= value! ? "atingida" : `faltaram ${brl(value! - goal.realized)}`}`).join(" &nbsp;|&nbsp; ");
  return `${progressBar(goal.realized / goal.target * 100, 100, 10)}<div style="font-size:12px;margin-top:6px;color:${gap >= 0 ? C.ok : C.bad};font-weight:700">${pct(goal.realized / goal.target * 100)} da Meta Alvo · ${gap >= 0 ? `${brl(gap)} acima` : `${brl(-gap)} abaixo`} de ${brl(goal.target)}</div>${tiers ? `<div style="font-size:11.5px;color:${C.muted};margin-top:4px">${tiers}</div>` : ""}`;
}

function weekdayStrip(values: Array<{ label: string; average: number | null }>) {
  const present = values.filter(value => value.average != null).map(value => value.average!);
  const max = Math.max(...present, 1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="2" style="font-size:10.5px;text-align:center"><tr>${values.map(value => {
    if (value.average == null) return `<td style="background:#ffffff;border:1px dashed ${C.border};color:${C.muted};padding:6px 0;border-radius:4px">${value.label}<br><strong>—</strong></td>`;
    const ratio = value.average / max;
    const [background, color] = ratio > .85 ? [C.accent, "#ffffff"] : ratio > .65 ? ["#ec9ab8", "#ffffff"] : ratio > .45 ? ["#f5c6d7", C.bad] : [C.badBg, C.bad];
    return `<td style="background:${background};color:${color};padding:6px 0;border-radius:4px">${value.label}<br><strong>${num(value.average / 100)}</strong>${value.average === max ? " ★" : ""}</td>`;
  }).join("")}</tr></table>`;
}

export function closingPreheader(report: ClosingReport) {
  const parts: string[] = [];
  if (report.network.goal) parts.push(report.network.goal.allClosed ? `${report.network.goal.hit} de ${report.network.goal.total} unidades bateram a Meta Alvo.` : "Metas do mês ainda em apuração no sistema.");
  if (report.quality.have < report.quality.expected) parts.push(`${report.quality.have} de ${report.quality.expected} dias com relatório.`);
  return parts.join(" ");
}

export function renderClosingHtml(report: ClosingReport) {
  const { input, network, units } = report;
  const subject = closingSubject(report), preheader = closingPreheader(report);
  const label = monthLabel(report.month), previousLabel = monthLabel(previousMonth(report.month, 1));
  const tone = { good: ["✓", C.ok], bad: ["!", C.bad], idea: ["→", C.info] } as const;
  const goal = network.goal;
  const notices: string[] = [];
  if (goal && !goal.allClosed) notices.push(`<strong>Metas ainda não encerradas no sistema.</strong> O realizado abaixo soma o acompanhamento diário e pode mudar quando o período for encerrado.`);
  if (report.quality.have < report.quality.expected) notices.push(`<strong>${report.quality.have} de ${report.quality.expected} dias com relatório.</strong> Os totais somam só os dias com dado e as comparações usam a média por dia aberto. <a href="#qualidade" style="color:${C.warn}">Ver detalhes</a>`);
  const rows: Array<[string, string, string]> = [
    ["Faturamento líquido", brl(network.current.cents), brl(network.before.cents)],
    ["Pedidos", num(network.current.coupons), num(network.before.coupons)],
    ["Ticket médio", network.current.ticket ? brl(network.current.ticket, 2) : "—", network.before.ticket ? brl(network.before.ticket, 2) : "—"],
    ["Itens vendidos", num(network.current.items), num(network.before.items)],
    ["Itens por pedido", network.current.coupons ? num(network.current.items / network.current.coupons, 2) : "—", network.before.coupons ? num(network.before.items / network.before.coupons, 2) : "—"],
    ["Média por dia aberto", brl(network.current.perDay), brl(network.before.perDay)],
  ];
  let html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:20px 12px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${C.border}">
<tr><td id="topo" style="background:${C.ink};padding:24px 28px"><div style="font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${C.kicker}">Coala One · Metas</div><div style="font-size:26px;font-weight:800;color:#ffffff;margin-top:6px">${REPORT_NAME} — Fechamento do mês</div><div style="font-size:13px;color:#c9c7cf;margin-top:4px">${label} · de ${shortDate(input.monthStart)} a ${shortDate(input.monthEnd)}</div></td></tr>
<tr><td style="padding:12px 28px;background:${C.warm};border-bottom:1px solid ${C.border};font-size:12.5px">${[["resumo", "Resultado"], ["metas", "Metas"], ["unidades", "Unidades"], ["produtos", "Produtos"], ["tendencia", "6 meses"], ["qualidade", "Qualidade dos dados"]].map(([anchor, text]) => `<a href="#${anchor}" style="color:${C.bad};font-weight:700;text-decoration:none">${text}</a>`).join(` <span style="color:#b8b4ab">·</span> `)}</td></tr>
${notices.map(text => `<tr><td style="padding:16px 28px 0"><div style="background:${C.warnBg};border:1px solid #f5d9a3;border-radius:10px;padding:10px 12px;font-size:12.5px;color:${C.warn}">${text}</div></td></tr>`).join("")}
<tr><td style="padding:22px 28px 0"><div style="font-size:17px;font-weight:800">Em 30 segundos</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13.5px;margin-top:8px">${closingLines(report).map(line => `<tr><td width="22" valign="top" style="padding:6px 0;color:${tone[line.tone][1]};font-weight:800">${tone[line.tone][0]}</td><td style="padding:6px 0"><strong>${escapeHtml(line.title)}</strong> ${escapeHtml(line.text)}</td></tr>`).join("")}</table></td></tr>`;

  html += section("resumo", "Resultado da rede", `Soma das ${units.length} unidades, ${label}. Comparação com ${previousLabel} e com a média dos meses anteriores, sempre por dia aberto.`);
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="50%" valign="top" style="padding-right:6px"><div style="background:${C.badBg};border-radius:12px;padding:14px 16px"><div style="font-size:11.5px;font-weight:800;color:${C.bad};text-transform:uppercase;letter-spacing:.08em">${label} · ${network.current.have}/${network.current.expected} dias</div><div style="font-size:26px;font-weight:800;margin-top:4px">${brl(network.current.cents)}</div><div style="font-size:12.5px;margin-top:2px">${arrow(delta(network.current.perDay, network.before.perDay))} <span style="color:${C.muted}">por dia vs. ${previousLabel}</span></div><div style="font-size:12.5px">${arrow(delta(network.current.perDay, network.priorPerDay))} <span style="color:${C.muted}">por dia vs. média de ${network.priorCount} meses</span></div></div></td>
<td width="50%" valign="top" style="padding-left:6px"><div style="background:${C.warm};border-radius:12px;padding:14px 16px"><div style="font-size:11.5px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.08em">${previousLabel}</div><div style="font-size:26px;font-weight:800;margin-top:4px">${brl(network.before.cents)}</div><div style="font-size:12.5px;margin-top:2px;color:${C.muted}">${network.before.have}/${network.before.expected} dias com relatório</div>${goal ? `<div style="font-size:12.5px;color:${C.muted}">Meta Alvo de ${label}: ${brl(goal.target)}</div>` : ""}</div></td></tr></table></td></tr>`;
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${header(["Indicador", label, previousLabel])}${rows.map(row => `<tr>${cell(row[0])}${cellRight(`<strong>${row[1]}</strong>`)}${cellRight(row[2])}</tr>`).join("")}</table></td></tr>`;

  html += section("metas", "Metas do mês", "Metas de faturamento da rede. Percentuais e veredito usam a Meta Alvo; UP e TOP aparecem como faixas. Ticket e produto ficam em cada unidade.");
  if (goal) {
    html += `<tr><td style="padding:12px 28px 0"><div style="font-size:12px;font-weight:700;color:${C.muted};margin-bottom:6px">Rede · ${goal.hit} de ${goal.total} unidades bateram a Meta Alvo · ${goal.allClosed ? pill("Metas encerradas", C.okBg, C.ok) : pill("Em apuração", C.warnBg, C.warn)}</div>${goalBlock(goal)}</td></tr>`;
  } else html += `<tr><td style="padding:12px 28px 0;font-size:13px;color:${C.muted}">Nenhuma unidade tinha meta de faturamento em ${label}.</td></tr>`;
  html += `<tr><td style="padding:14px 28px 0"><a href="${escapeHtml(input.links.goals)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:11px 18px;border-radius:9px">Abrir metas no Coala One</a></td></tr>`;

  const ranked = [...units].sort((left, right) => right.current.cents - left.current.cents);
  html += section("unidades", "Unidades lado a lado", "Ordem pelo faturamento do mês. Barra = participação na rede. Comparação por dia aberto.");
  html += `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">${header(["Unidade", label, `vs. ${MONTHS[Number(previousMonth(report.month, 1).slice(5)) - 1]}`, "Ticket", "Meta"])}${ranked.map(unit => {
    const share = network.current.cents ? unit.current.cents / network.current.cents * 100 : 0;
    return `<tr>${cell(`<strong>${escapeHtml(unit.name)}</strong>`, "padding-bottom:4px")}${cellRight(brl(unit.current.cents), "padding-bottom:4px")}${cellRight(arrow(delta(unit.current.perDay, unit.before.perDay)), "padding-bottom:4px")}${cellRight(unit.current.ticket ? brl(unit.current.ticket, 2) : "—", "padding-bottom:4px")}${cellRight(unit.goal ? tierPill(unit.goal.tier, unit.goal.closed) : "sem meta", "padding-bottom:4px;padding-right:0")}</tr><tr><td colspan="5" style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${blank(`${share.toFixed(1)}%`, C.accent, 6, "border-radius:3px")}<td style="font-size:11px;color:${C.muted};padding-left:6px">${pct(share)}</td></tr></table></td></tr>`;
  }).join("")}</table></td></tr>`;

  for (const unit of units) {
    const share = network.current.cents ? unit.current.cents / network.current.cents * 100 : 0;
    html += `<tr><td style="padding:16px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:12px">
<tr><td style="padding:14px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:15px;font-weight:800">${escapeHtml(unit.name)}</td><td align="right">${unit.goal ? tierPill(unit.goal.tier, unit.goal.closed) : ""}</td></tr></table><div style="font-size:12px;color:${C.muted};margin-top:2px">${pct(share)} da rede${unit.top[0] ? ` · produto líder: ${escapeHtml(unit.top[0].name)}` : ""}${unit.goal?.streak ? ` · ${unit.goal.streak} ${unit.goal.streak === 1 ? "mês seguido" : "meses seguidos"} batendo a Meta Alvo` : ""}</div></td></tr>
<tr><td style="padding:10px 16px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">${header(["", label, previousLabel])}
<tr>${cell("Faturamento")}${cellRight(`<strong>${brl(unit.current.cents)}</strong>`)}${cellRight(brl(unit.before.cents))}</tr>
<tr>${cell("Pedidos · ticket")}${cellRight(`${num(unit.current.coupons)} · ${unit.current.ticket ? brl(unit.current.ticket, 2) : "—"}`)}${cellRight(`${num(unit.before.coupons)} · ${unit.before.ticket ? brl(unit.before.ticket, 2) : "—"}`)}</tr>
<tr>${cell("Itens · por pedido")}${cellRight(`${num(unit.current.items)} · ${unit.current.coupons ? num(unit.current.items / unit.current.coupons, 2) : "—"}`)}${cellRight(`${num(unit.before.items)} · ${unit.before.coupons ? num(unit.before.items / unit.before.coupons, 2) : "—"}`)}</tr>
<tr>${cell("Média por dia aberto")}${cellRight(`${brl(unit.current.perDay)} ${arrow(delta(unit.current.perDay, unit.before.perDay))}`)}${cellRight(brl(unit.before.perDay))}</tr></table></td></tr>`;
    if (unit.goal) html += `<tr><td style="padding:10px 16px 0">${goalBlock(unit.goal)}</td></tr>`;
    html += `<tr><td style="padding:10px 16px 0"><div style="font-size:11px;font-weight:700;color:${C.muted};margin-bottom:4px">Média por dia da semana (R$)${unit.bestDay ? ` · melhor dia: ${WEEKDAYS[weekday(unit.bestDay[0])]} ${shortDate(unit.bestDay[0])} (${brl(unit.bestDay[1])})` : ""}${unit.worstDay ? ` · menor: ${shortDate(unit.worstDay[0])} (${brl(unit.worstDay[1])})` : ""}</div>${weekdayStrip(unit.byWeekday)}</td></tr>
<tr><td style="padding:12px 16px 14px"><div style="font-size:11px;font-weight:700;color:${C.muted};margin-bottom:2px">5 produtos com maior faturamento no mês</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px">${header(["Produto", "Qtd.", "Faturamento"])}${unit.top.map((product, index) => `<tr>${cell(`<span style="color:${C.muted}">${index + 1}.</span> ${escapeHtml(product.name)}<div style="font-size:10.5px;color:${C.muted}">${pct(product.share)} da unidade</div>`)}${cellRight(num(product.qty))}${cellRight(brl(product.cents), "padding-right:0")}</tr>`).join("")}</table><div style="font-size:12px;margin-top:8px"><a href="${escapeHtml(input.links.analysis)}" style="color:${C.bad};font-weight:700">Ver análise de ${escapeHtml(unit.name)}</a></div></td></tr></table></td></tr>`;
  }
  html += backToTop;

  html += section("produtos", "Produtos da rede", `Top 5 do mês e variação por dia aberto contra ${previousLabel}, só com pelo menos 30 unidades nos dois meses.`);
  const list = (title: string, items: Array<{ name: string; qty: number; cents?: number }>, byQty: boolean) => `<div style="background:${C.warm};border-radius:10px;padding:10px 12px"><div style="font-size:11px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.08em">${title}</div>${items.map((item, index) => `<div style="margin-top:4px"><span style="color:${C.muted}">${index + 1}.</span> ${escapeHtml(item.name)} <strong>${byQty ? `${num(item.qty)} un` : brl(item.cents!)}</strong></div>`).join("")}</div>`;
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px"><tr><td width="50%" valign="top" style="padding-right:6px">${list("Mais faturaram", report.productsByCents, false)}</td><td width="50%" valign="top" style="padding-left:6px">${list("Mais vendidos", report.productsByQty, true)}</td></tr></table></td></tr>`;
  const moverBox = (title: string, items: ClosingReport["movers"], color: string, background: string) => `<div style="background:${background};border-radius:10px;padding:10px 12px"><div style="font-size:11px;font-weight:800;color:${color};text-transform:uppercase;letter-spacing:.08em">${title}</div>${items.length ? items.map(item => `<div style="margin-top:4px">${escapeHtml(item.name)} <strong style="color:${color}">${item.change > 0 ? "+" : "−"}${pct(Math.abs(item.change), 0)}</strong> <span style="color:${C.muted}">· ${num(item.qty)} un</span></div>`).join("") : `<div style="margin-top:4px;color:${C.muted}">Nenhum</div>`}</div>`;
  html += `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px"><tr><td width="50%" valign="top" style="padding-right:6px">${moverBox("Maiores altas", report.movers.filter(item => item.change > 0).slice(0, 3), C.ok, C.okBg)}</td><td width="50%" valign="top" style="padding-left:6px">${moverBox("Maiores quedas", report.movers.filter(item => item.change < 0).slice(-3).reverse(), C.bad, C.badBg)}</td></tr></table>
<div style="font-size:12px;color:${C.muted};margin-top:8px">Novos no mês: ${report.newProducts.length ? escapeHtml(report.newProducts.map(item => `${item.name} (${num(item.qty)} un)`).join(", ")) : "nenhum"}. Sem venda no mês, mas vendiam em ${previousLabel}: ${report.missingProducts.length ? escapeHtml(report.missingProducts.map(item => `${item.name} (${num(item.qty)} un)`).join(", ")) : "nenhum"}.</div></td></tr>`;
  html += `<tr><td style="padding:12px 28px 0"><div style="font-size:11px;font-weight:700;color:${C.muted};margin-bottom:4px">Média da rede por dia da semana (R$)</div>${weekdayStrip(report.weekdayNetwork)}</td></tr>`;
  html += backToTop;

  const maxMonth = Math.max(...report.trend.map(entry => entry.cents), 1);
  const bestMonth = [...report.trend].sort((left, right) => right.cents - left.cents)[0]?.month;
  html += section("tendencia", "Últimos 6 meses", `Faturamento mensal da rede, com ${label} como último ponto.`);
  html += `<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px">${report.trend.map(entry => `<tr><td width="40" style="padding:4px 0;color:${C.muted}">${MONTHS[Number(entry.month.slice(5)) - 1]}</td><td style="padding:4px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${blank(`${(entry.cents / maxMonth * 78).toFixed(1)}%`, entry.month === bestMonth ? C.accent : "#f5c6d7", 14, "border-radius:3px")}<td style="padding-left:6px;white-space:nowrap">${compactBrl(entry.cents)}${entry.attainment != null ? ` · <span style="color:${entry.attainment >= 100 ? C.ok : C.bad}">${pct(entry.attainment, 0)}</span>` : ""}${entry.month === bestMonth ? " ★" : ""}</td></tr></table></td></tr>`).join("")}</table><div style="font-size:11.5px;color:${C.muted};margin-top:6px">% = atingimento da Meta Alvo somada das unidades com meta no mês. ★ melhor mês. Meses com dias sem relatório somam só os dias com dado.</div></td></tr>`;
  html += backToTop;

  const q = report.quality;
  const qualityRows: Array<[string, string, string]> = [
    ["Dias do mês com relatório", `${q.have} de ${q.expected}`, q.have < q.expected ? C.warn : C.ok],
    ["Dias sem relatório", report.missingDays.join(", ") || "nenhum", report.missingDays.length ? C.warn : C.ok],
    ["Dias do mês em formato legado", `${q.legacy} de ${q.have}`, q.legacy ? C.warn : C.ok],
    ["Metas do mês", goal ? (goal.allClosed ? "todas encerradas" : "ainda em apuração no sistema") : "nenhuma", goal && !goal.allClosed ? C.warn : C.ok],
    ["Unidades sem meta no mês", report.unitsWithoutGoal.join(", ") || "nenhuma", report.unitsWithoutGoal.length ? C.warn : C.ok],
  ];
  html += section("qualidade", "Qualidade dos dados", "O que sustenta os números acima.");
  html += `<tr><td style="padding:10px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">${qualityRows.map(row => `<tr>${cell(row[0], "padding:7px 0")}${cellRight(row[1], `padding:7px 0;color:${row[2]};font-weight:700;white-space:normal`)}</tr>`).join("")}</table></td></tr>`;
  html += `<tr><td style="padding:26px 28px 24px"><div style="border-top:1px solid ${C.border};padding-top:14px;font-size:11.5px;line-height:1.6;color:${C.muted}">${closingFooter().map(escapeHtml).join("<br>")}</div></td></tr></table></td></tr></table></body></html>`;
  return html;
}

function closingFooter() {
  return [
    "Relatório automático de fechamento, enviado todo dia 1º. Nenhuma meta, venda ou lançamento financeiro é alterado.",
    "Receita = vendas do PDV comprovadas nos cupons; não inclui recebimentos da Stone nem entradas bancárias. Dia sem relatório não conta como zero.",
    "Meta encerrada = período fechado no Coala One. Enquanto aberto, o realizado é o acompanhamento diário e pode mudar.",
  ];
}

export function renderClosingText(report: ClosingReport) {
  const { input, network, units } = report;
  const lines = [closingSubject(report), `${monthLabel(report.month)} · de ${shortDate(input.monthStart)} a ${shortDate(input.monthEnd)}`, ""];
  if (network.goal && !network.goal.allClosed) lines.push("Atenção: metas ainda não encerradas no sistema; o realizado é o acompanhamento diário.", "");
  if (report.quality.have < report.quality.expected) lines.push(`Atenção: ${report.quality.have} de ${report.quality.expected} dias com relatório. Comparações por dia aberto.`, "");
  lines.push("EM 30 SEGUNDOS", ...closingLines(report).map(line => `- ${line.title} ${line.text}`), "");
  lines.push("RESULTADO DA REDE", `Faturamento: ${brl(network.current.cents)} · ${num(network.current.coupons)} pedidos · ticket ${network.current.ticket ? brl(network.current.ticket, 2) : "—"}`, `Mês anterior: ${brl(network.before.cents)}`);
  if (network.goal) lines.push(`Meta Alvo: ${brl(network.goal.target)} · realizado ${brl(network.goal.realized)} (${pct(network.goal.realized / network.goal.target * 100)}) · ${network.goal.hit} de ${network.goal.total} unidades bateram`);
  lines.push(`Abrir metas: ${input.links.goals}`, "");
  for (const unit of units) {
    lines.push(unit.name.toLocaleUpperCase("pt-BR"), `Mês: ${brl(unit.current.cents)} · ${num(unit.current.coupons)} pedidos · ticket ${unit.current.ticket ? brl(unit.current.ticket, 2) : "—"} · ${unit.current.have}/${unit.current.expected} dias`);
    if (unit.goal) lines.push(`Meta: ${unit.goal.closed ? (unit.goal.tier ? `${unit.goal.tier} atingida` : "não atingida") : "em apuração"} · realizado ${brl(unit.goal.realized)} de ${brl(unit.goal.target)}`);
    lines.push("5 produtos:", ...unit.top.map((product, index) => `  ${index + 1}. ${product.name}: ${num(product.qty)} un · ${brl(product.cents)}`), "");
  }
  lines.push("QUALIDADE DOS DADOS", `Dias do mês com relatório: ${report.quality.have} de ${report.quality.expected}`, `Dias sem relatório: ${report.missingDays.join(", ") || "nenhum"}`, "", ...closingFooter());
  return lines.join("\n");
}
