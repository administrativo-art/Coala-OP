// Mock data + selectors for Coala · Análise de vendas
// Single source of truth: a per-kiosk daily series for the current month
// (1..28 completed, day 29 = hoje = 0) plus monthly product aggregates.
// Everything the panel shows is derived from these by date-range / kiosk filtering.

// ── seeded RNG (mulberry32) ──────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SALES_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const SALES_WEEKDAYS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const SALES_COLORS = ['#E91E8C','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316','#EC4899'];

// Current reference date: 29/05/2026 08:33 — hoje has 0 sales.
const CUR_YEAR = 2026;
const CUR_MONTH = 5;            // Maio
const TODAY_DAY = 29;
const COMPLETED_DAYS = 28;      // 1..28 have data

// ── product lines ────────────────────────────────────────────────────────────
const SALES_LINES = [
  { id: 'cones',   name: 'Casquinhas & Cascão' },
  { id: 'acai',    name: 'Açaí' },
  { id: 'copos',   name: 'Copos & Sundae' },
  { id: 'shakes',  name: 'Milk Shakes' },
  { id: 'picoles', name: 'Picolés' },
];

// Per-kiosk monthly product quantities. JP sums to exactly 1.701 (matches print).
// [id, name, lineId, qty, price]
const PRODUCTS_JP = [
  ['casq-mista',   'CASQUINHA MISTA',        'cones',  549, 8.0],
  ['acai-300',     'AÇAÍ 300ML',             'acai',   287, 15.0],
  ['casq-choco',   'CASQUINHA CHOCOLATE',    'cones',  198, 8.0],
  ['shake-moran',  'MILK SHAKE MORANGO',     'shakes', 142, 18.0],
  ['copo-2',       'COPO 2 BOLAS',           'copos',  121, 14.0],
  ['casq-baun',    'CASQUINHA BAUNILHA',     'cones',   98, 7.0],
  ['sundae-choco', 'SUNDAE CHOCOLATE',       'copos',   76, 16.0],
  ['acai-500',     'AÇAÍ 500ML',             'acai',    64, 22.0],
  ['copo-1',       'COPO 1 BOLA',            'copos',   53, 9.0],
  ['banana-split', 'BANANA SPLIT',           'copos',   41, 24.0],
  ['cascao-mista', 'CASCÃO MISTO',           'cones',   33, 9.0],
  ['shake-choco',  'MILK SHAKE CHOCOLATE',   'shakes',  22, 18.0],
  ['picole-fruta', 'PICOLÉ FRUTA',           'picoles', 17, 6.0],
];

const PRODUCTS_TI = [
  ['casq-mista',   'CASQUINHA MISTA',        'cones',  712, 8.0],
  ['acai-300',     'AÇAÍ 300ML',             'acai',   401, 15.0],
  ['casq-choco',   'CASQUINHA CHOCOLATE',    'cones',  268, 8.0],
  ['copo-2',       'COPO 2 BOLAS',           'copos',  198, 14.0],
  ['shake-moran',  'MILK SHAKE MORANGO',     'shakes', 176, 18.0],
  ['acai-500',     'AÇAÍ 500ML',             'acai',   132, 22.0],
  ['casq-baun',    'CASQUINHA BAUNILHA',     'cones',  121, 7.0],
  ['sundae-choco', 'SUNDAE CHOCOLATE',       'copos',   97, 16.0],
  ['banana-split', 'BANANA SPLIT',           'copos',   78, 24.0],
  ['copo-1',       'COPO 1 BOLA',            'copos',   61, 9.0],
  ['cascao-mista', 'CASCÃO MISTO',           'cones',   44, 9.0],
  ['shake-choco',  'MILK SHAKE CHOCOLATE',   'shakes',  21, 18.0],
];

// ── per-kiosk config ─────────────────────────────────────────────────────────
const SALES_KIOSKS = [
  {
    id: 'joao-paulo', name: 'Quiosque João Paulo', seed: 17344,
    products: PRODUCTS_JP,
    monthUnits: 1701, monthCoupons: 1184, monthRevenue: 12314.5,
    metaAlvo: 24000, metaUp: 27000,
    colaboradores: [
      { name: 'João Paulo',   revenue: 5420.0, meta: 9000, up: 10000 },
      { name: 'Maria Silva',  revenue: 3890.0, meta: 8000, up: 9000 },
      { name: 'Carlos Souza', revenue: 3004.5, meta: 7000, up: 8000 },
    ],
  },
  {
    id: 'tiririca', name: 'Quiosque Tiririca', seed: 17343,
    products: PRODUCTS_TI,
    monthUnits: 2309, monthCoupons: 1655, monthRevenue: 18420.0,
    metaAlvo: 30000, metaUp: 33000,
    colaboradores: [
      { name: 'Tiririca',   revenue: 7200.0,  meta: 11000, up: 12000 },
      { name: 'Ana Costa',  revenue: 6120.0,  meta: 10000, up: 11000 },
      { name: 'Pedro Lima', revenue: 5100.0,  meta: 9000,  up: 10000 },
    ],
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────
// distribute a target total across `n` weighted slots, returns integers summing exactly to total
function distributeInt(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.round((total * w) / sum));
  let diff = total - out.reduce((a, b) => a + b, 0);
  // dump remainder onto the heaviest slot
  let maxI = 0; weights.forEach((w, i) => { if (w > weights[maxI]) maxI = i; });
  out[maxI] += diff;
  return out;
}
function distributeMoney(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const out = weights.map((w) => Math.round((total * w * 100) / sum) / 100);
  let diff = Math.round((total - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  let maxI = 0; weights.forEach((w, i) => { if (w > weights[maxI]) maxI = i; });
  out[maxI] = Math.round((out[maxI] + diff) * 100) / 100;
  return out;
}

// weekday multiplier (ice-cream kiosk → weekend peaks)
const DOW_MULT = [1.35, 0.7, 0.78, 0.85, 0.92, 1.15, 1.45]; // Dom..Sáb

// Build daily series (1..29) for a kiosk, normalized so days 1..28 sum exactly.
function buildDaily(kiosk) {
  const rnd = mulberry32(kiosk.seed);
  const weights = [];
  for (let d = 1; d <= COMPLETED_DAYS; d++) {
    const dow = new Date(CUR_YEAR, CUR_MONTH - 1, d).getDay();
    weights.push(DOW_MULT[dow] * (0.78 + rnd() * 0.5));
  }
  const units = distributeInt(kiosk.monthUnits, weights);
  const coupons = distributeInt(kiosk.monthCoupons, weights);
  const revenue = distributeMoney(kiosk.monthRevenue, weights);

  // top product rotation per day (weighted toward the kiosk's leaders)
  const leaders = kiosk.products.slice(0, 6).map((p) => p[1]);

  const days = [];
  for (let d = 1; d <= COMPLETED_DAYS; d++) {
    const dow = new Date(CUR_YEAR, CUR_MONTH - 1, d).getDay();
    const li = Math.floor(rnd() * (dow === 0 || dow === 6 ? 3 : 5)) % leaders.length;
    days.push({
      day: d,
      date: `${CUR_YEAR}-${String(CUR_MONTH).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      label: `${String(d).padStart(2, '0')}/${String(CUR_MONTH).padStart(2, '0')} ${SALES_WEEKDAYS[dow]}`,
      weekday: dow,
      units: units[d - 1],
      coupons: coupons[d - 1],
      revenue: revenue[d - 1],
      topProduct: leaders[li],
    });
  }
  // hoje (29) — zero
  const todayDow = new Date(CUR_YEAR, CUR_MONTH - 1, TODAY_DAY).getDay();
  days.push({
    day: TODAY_DAY,
    date: `${CUR_YEAR}-${String(CUR_MONTH).padStart(2, '0')}-${TODAY_DAY}`,
    label: `${TODAY_DAY}/${String(CUR_MONTH).padStart(2, '0')} ${SALES_WEEKDAYS[todayDow]}`,
    weekday: todayDow,
    units: 0, coupons: 0, revenue: 0, topProduct: null,
  });
  return days;
}

// Hourly coupon/unit distribution (kiosk open ~11h–22h)
const HOUR_WEIGHT = (() => {
  const w = new Array(24).fill(0);
  // [hour]=weight
  const peaks = { 11: 0.4, 12: 0.8, 13: 1.0, 14: 1.3, 15: 1.7, 16: 2.1, 17: 2.4, 18: 2.2, 19: 1.9, 20: 1.4, 21: 0.9, 22: 0.4 };
  Object.entries(peaks).forEach(([h, v]) => { w[+h] = v; });
  return w;
})();

function buildHourly(kiosk) {
  const couponsByHour = distributeInt(kiosk.monthCoupons, HOUR_WEIGHT);
  const unitsByHour = distributeInt(kiosk.monthUnits, HOUR_WEIGHT);
  const top = kiosk.products.slice(0, 8);
  return HOUR_WEIGHT.map((w, h) => {
    const hu = unitsByHour[h];
    // split the hour's units across top products by their monthly share
    const shareW = top.map((p) => p[3]);
    const split = distributeInt(hu, shareW);
    const products = top
      .map((p, i) => ({ simulationId: p[0], name: p[1], quantity: split[i] }))
      .filter((p) => p.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
    return {
      hourStr: String(h).padStart(2, '0'),
      hour: `${String(h).padStart(2, '0')}h`,
      coupons: couponsByHour[h],
      total: hu,
      products,
    };
  });
}

// Combos (cesta de compras) per kiosk
const COMBOS_JP = [
  { name: '1x CASQUINHA MISTA + 1x AÇAÍ 300ML', count: 142 },
  { name: '2x CASQUINHA MISTA', count: 98 },
  { name: '1x MILK SHAKE MORANGO + 1x CASQUINHA CHOCOLATE', count: 71 },
  { name: '1x AÇAÍ 300ML + 1x AÇAÍ 500ML', count: 54 },
  { name: '1x COPO 2 BOLAS + 1x CASQUINHA BAUNILHA', count: 47 },
  { name: '1x SUNDAE CHOCOLATE + 1x CASQUINHA MISTA', count: 39 },
  { name: '2x AÇAÍ 300ML + 1x MILK SHAKE MORANGO', count: 28 },
  { name: '1x BANANA SPLIT + 1x CASCÃO MISTO', count: 19 },
];
const COMBOS_TI = [
  { name: '1x CASQUINHA MISTA + 1x AÇAÍ 300ML', count: 188 },
  { name: '2x CASQUINHA MISTA', count: 131 },
  { name: '1x COPO 2 BOLAS + 1x CASQUINHA CHOCOLATE', count: 94 },
  { name: '1x AÇAÍ 300ML + 1x AÇAÍ 500ML', count: 67 },
  { name: '1x SUNDAE CHOCOLATE + 1x MILK SHAKE MORANGO', count: 52 },
  { name: '1x BANANA SPLIT + 1x CASQUINHA MISTA', count: 33 },
  { name: '2x CASQUINHA CHOCOLATE + 1x AÇAÍ 300ML', count: 24 },
];

// Per-kiosk evolution months (top products across Mar/Abr/Mai) — illustrative
const EVOLUTION = {
  'joao-paulo': {
    months: [3, 4, 5],
    rows: [
      { product: 'CASQUINHA MISTA',     Mar: 612, Abr: 588, Mai: 549 },
      { product: 'AÇAÍ 300ML',          Mar: 248, Abr: 301, Mai: 287 },
      { product: 'CASQUINHA CHOCOLATE', Mar: 221, Abr: 209, Mai: 198 },
      { product: 'MILK SHAKE MORANGO',  Mar: 118, Abr: 134, Mai: 142 },
      { product: 'COPO 2 BOLAS',        Mar: 139, Abr: 127, Mai: 121 },
    ],
  },
  'tiririca': {
    months: [3, 4, 5],
    rows: [
      { product: 'CASQUINHA MISTA',     Mar: 690, Abr: 731, Mai: 712 },
      { product: 'AÇAÍ 300ML',          Mar: 372, Abr: 389, Mai: 401 },
      { product: 'CASQUINHA CHOCOLATE', Mar: 281, Abr: 274, Mai: 268 },
      { product: 'COPO 2 BOLAS',        Mar: 211, Abr: 203, Mai: 198 },
      { product: 'MILK SHAKE MORANGO',  Mar: 152, Abr: 168, Mai: 176 },
    ],
  },
};

// ── monthly unit history (Jan/25 → Mai/26), seeded; current month exact ──────
function buildMonthHistory(k) {
  const rnd = mulberry32(k.seed * 7 + 13);
  const hist = {};
  // walk from Jan 2025 to May 2026
  for (let y = 2025; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > CUR_MONTH) break;
      const key = `${y}-${m}`;
      if (y === CUR_YEAR && m === CUR_MONTH) { hist[key] = k.monthUnits; continue; }
      // seasonal curve: summer (dez-mar) high for ice-cream, mid-year lower
      const seasonal = [0.78, 0.82, 0.95, 1.02, 1.08, 0.9, 0.82, 0.85, 0.92, 1.0, 1.12, 1.25][m - 1];
      const growth = y === 2025 ? 0.7 : 1.0; // last year was smaller
      const jitter = 0.88 + rnd() * 0.26;
      hist[key] = Math.round(k.monthUnits * seasonal * growth * jitter);
    }
  }
  return hist;
}

// ── precompute per-kiosk model ──────────────────────────────────────────────
const KIOSK_MODEL = {};
SALES_KIOSKS.forEach((k) => {
  const totalRev = k.colaboradores.reduce((s, c) => s + c.revenue, 0) || 1;
  KIOSK_MODEL[k.id] = {
    ...k,
    daily: buildDaily(k),
    hourly: buildHourly(k),
    combos: k.id === 'joao-paulo' ? COMBOS_JP : COMBOS_TI,
    evolution: EVOLUTION[k.id],
    monthHistory: buildMonthHistory(k),
    // operators (with weights from revenue share) used to split product qty
    operators: k.colaboradores.map((c) => ({ name: c.name, weight: c.revenue / totalRev })),
  };
});

// ── month options for the "Comparativo de quantidade" selector (last 12) ─────
const SALES_MONTH_OPTIONS = (() => {
  const opts = [];
  for (let i = 11; i >= 0; i--) {
    let m = CUR_MONTH - i, y = CUR_YEAR;
    while (m <= 0) { m += 12; y -= 1; }
    opts.push({ month: m, year: y, key: `${y}-${m}`, label: `${SALES_MONTHS[m - 1]}/${String(y).slice(2)}` });
  }
  return opts;
})();
// default selection: 3 previous months + same month last year
const SALES_HISTORY_DEFAULT = (() => {
  const keys = [];
  for (let i = 3; i >= 1; i--) {
    let m = CUR_MONTH - i, y = CUR_YEAR;
    while (m <= 0) { m += 12; y -= 1; }
    keys.push(`${y}-${m}`);
  }
  keys.push(`${CUR_YEAR - 1}-${CUR_MONTH}`);
  return keys;
})();

// kiosks matching the filter
function selectedKioskModels(kioskId) {
  return kioskId === 'all' ? SALES_KIOSKS.map((k) => KIOSK_MODEL[k.id]) : [KIOSK_MODEL[kioskId]].filter(Boolean);
}

// monthly history bars per kiosk for the selected month keys
function getKioskMonthHistory(kioskId, selectedKeys) {
  const keys = selectedKeys && selectedKeys.length ? selectedKeys : SALES_HISTORY_DEFAULT;
  // preserve chronological order from SALES_MONTH_OPTIONS, plus same-month-last-year keys
  const ordered = [];
  SALES_MONTH_OPTIONS.forEach((o) => { if (keys.includes(o.key)) ordered.push(o); });
  keys.forEach((kk) => {
    if (!ordered.some((o) => o.key === kk)) {
      const [y, m] = kk.split('-').map(Number);
      ordered.push({ month: m, year: y, key: kk, label: `${SALES_MONTHS[m - 1]}/${String(y).slice(2)}` });
    }
  });
  ordered.sort((a, b) => (a.year - b.year) || (a.month - b.month));
  return selectedKioskModels(kioskId).map((k) => ({
    kioskId: k.id, kioskName: k.name,
    bars: ordered.map((o) => ({ label: o.label, qty: k.monthHistory[o.key] || 0, isLastYear: o.year < CUR_YEAR })),
  }));
}

// per-kiosk product qty (+ operator split) for selected product ids over the range
function getProductQtyByKiosk(kioskId, preset, range, productIds) {
  const kiosks = selectedKioskModels(kioskId);
  const { startDay, endDay, prevMonth } = resolvePreset(preset, range);
  return kiosks.map((k) => {
    const rangeUnits = k.daily.filter((d) => d.day >= startDay && d.day <= endDay).reduce((s, d) => s + d.units, 0);
    const prop = prevMonth ? 1.45 : (rangeUnits / (k.monthUnits || 1));
    const products = productIds.map((pid) => {
      const p = k.products.find((x) => x[0] === pid);
      const qty = p ? Math.round(p[3] * prop) : 0;
      const operators = qty > 0
        ? k.operators.map((o) => ({ name: o.name, qty: Math.round(qty * o.weight) })).filter((o) => o.qty > 0).sort((a, b) => b.qty - a.qty)
        : [];
      return { simulationId: pid, name: p ? p[1] : pid, qty, operators };
    });
    return { kioskId: k.id, kioskName: k.name, products };
  });
}

// full product list (for the multi-select) over current view, sorted
function getProductOptions(kioskId) {
  const kiosks = selectedKioskModels(kioskId);
  const map = {};
  kiosks.forEach((k) => k.products.forEach((p) => {
    if (!map[p[0]]) map[p[0]] = { simulationId: p[0], name: p[1], quantity: 0 };
    map[p[0]].quantity += p[3];
  }));
  return Object.values(map).sort((a, b) => b.quantity - a.quantity);
}

// ── period presets → resolve to {start,end} day numbers within current month ─
function resolvePreset(preset, range) {
  switch (preset) {
    case 'yesterday': return { startDay: COMPLETED_DAYS, endDay: COMPLETED_DAYS, label: 'Ontem' };
    case 'today':     return { startDay: TODAY_DAY, endDay: TODAY_DAY, label: 'Hoje' };
    case 'thisMonth': return { startDay: 1, endDay: TODAY_DAY, label: 'Este Mês' };
    case 'lastMonth': return { startDay: 1, endDay: COMPLETED_DAYS, label: 'Mês Passado', prevMonth: true };
    case 'custom': {
      const s = range && range.start ? Number(range.start.slice(8, 10)) : 1;
      const e = range && range.end ? Number(range.end.slice(8, 10)) : TODAY_DAY;
      return { startDay: Math.min(s, e), endDay: Math.max(s, e), label: 'Período' };
    }
    default: return { startDay: 1, endDay: TODAY_DAY, label: 'Este Mês' };
  }
}

const fmtNum = (n) => (Number(n) || 0).toLocaleString('pt-BR');
const fmt2 = (n) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── main selector ────────────────────────────────────────────────────────────
// kioskId: 'all' | <id>; preset: string; range: {start,end} ISO
function getSalesView(kioskId, preset, range) {
  const kiosks = kioskId === 'all'
    ? SALES_KIOSKS.map((k) => KIOSK_MODEL[k.id])
    : [KIOSK_MODEL[kioskId]].filter(Boolean);

  const { startDay, endDay, label, prevMonth } = resolvePreset(preset, range);
  const scaleFactor = prevMonth ? 1.45 : 1; // mês passado was bigger

  // ── daily breakdown (merged across selected kiosks) ──
  const dailyMap = {};
  kiosks.forEach((k) => {
    k.daily.forEach((d) => {
      if (d.day < startDay || d.day > endDay) return;
      if (!dailyMap[d.date]) dailyMap[d.date] = { ...d, units: 0, coupons: 0, revenue: 0, _tops: {} };
      const e = dailyMap[d.date];
      e.units += Math.round(d.units * scaleFactor);
      e.coupons += Math.round(d.coupons * scaleFactor);
      e.revenue += Math.round(d.revenue * scaleFactor * 100) / 100;
      if (d.topProduct) e._tops[d.topProduct] = (e._tops[d.topProduct] || 0) + d.units;
    });
  });
  let daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  // best/worst/today flags + delta + avg
  const completed = daily.filter((d) => d.day !== TODAY_DAY);
  const maxU = completed.length ? Math.max(...completed.map((d) => d.units)) : 0;
  const posU = completed.filter((d) => d.units > 0).map((d) => d.units);
  const minU = posU.length ? Math.min(...posU) : 0;
  const avg = daily.length ? Math.round(daily.reduce((s, d) => s + d.units, 0) / daily.length) : 0;
  daily = daily.map((d, i) => {
    const top = Object.entries(d._tops).sort((a, b) => b[1] - a[1])[0];
    const prev = daily[i - 1];
    const delta = prev && prev.units > 0 ? ((d.units - prev.units) / prev.units) * 100 : null;
    const isToday = d.day === TODAY_DAY;
    return {
      date: d.date, label: d.label, units: d.units, coupons: d.coupons, revenue: d.revenue,
      ticketMedio: d.coupons > 0 && d.revenue > 0 ? d.revenue / d.coupons : null,
      topProduct: top ? top[0] : null, delta, avg, isToday,
      isBest: !isToday && d.units === maxU && maxU > 0,
      isWorst: !isToday && d.units === minU && completed.length > 1 && d.units > 0 && d.units !== maxU,
    };
  });

  // ── totals over range ──
  const rangeUnits = daily.reduce((s, d) => s + d.units, 0);
  const rangeCoupons = daily.reduce((s, d) => s + d.coupons, 0);
  const rangeRevenue = Math.round(daily.reduce((s, d) => s + d.revenue, 0) * 100) / 100;

  // ── ranking (monthly product aggregate, scaled to range proportion) ──
  const monthUnitsSel = kiosks.reduce((s, k) => s + k.monthUnits, 0) || 1;
  const rangeProp = prevMonth ? scaleFactor : rangeUnits / monthUnitsSel;
  const prodMap = {};
  kiosks.forEach((k) => k.products.forEach((p) => {
    const [id, name, lineId, qty, price] = p;
    if (!prodMap[id]) prodMap[id] = { simulationId: id, name, lineId, quantity: 0, price };
    prodMap[id].quantity += qty;
  }));
  let ranking = Object.values(prodMap)
    .map((p) => ({ ...p, quantity: Math.round(p.quantity * rangeProp) }))
    .filter((p) => p.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity);
  const totalUnits = ranking.reduce((s, p) => s + p.quantity, 0);

  // ── ABC ──
  let acc = 0;
  const abc = ranking.map((p) => {
    acc += p.quantity;
    const cumPct = totalUnits ? (acc / totalUnits) * 100 : 0;
    return {
      ...p,
      pct: totalUnits ? ((p.quantity / totalUnits) * 100).toFixed(1) : '0.0',
      accumulated: cumPct.toFixed(1),
      cls: cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C',
    };
  });

  // ── mix by line ──
  const lineMap = {};
  ranking.forEach((p) => {
    const ln = SALES_LINES.find((l) => l.id === p.lineId);
    const key = ln ? ln.id : 'outros';
    if (!lineMap[key]) lineMap[key] = { name: ln ? ln.name : 'Sem linha', quantity: 0 };
    lineMap[key].quantity += p.quantity;
  });
  const mix = Object.values(lineMap).sort((a, b) => b.quantity - a.quantity);

  // ── hourly per kiosk (scaled) ──
  const hourlyByKiosk = kiosks.map((k) => ({
    kioskId: k.id, kioskName: k.name,
    data: k.hourly.map((h) => ({
      ...h,
      coupons: Math.round(h.coupons * rangeProp),
      total: Math.round(h.total * rangeProp),
      products: h.products.map((p) => ({ ...p, quantity: Math.round(p.quantity * rangeProp) })),
    })),
  }));

  // ── faturamento blocks (always month-based metas; respect kiosk filter) ──
  const Var = (cur, prev) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);
  function buildFatBlock(model, name, withMeta) {
    const ds = model.daily;
    const month = Math.round(ds.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
    const weekDays = ds.filter((d) => d.day >= 22 && d.day <= COMPLETED_DAYS);
    const week = Math.round(weekDays.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
    const day = 0; // hoje
    // force the print's exact variation percentages
    const prevMonthV = month / 0.68;     // ▼32.0%
    const prevWeekV = week / 1.329;      // ▲32.9%
    const prevDayV = 480;                // any >0 → ▼100% for today
    return {
      label: name, month, prevMonth: prevMonthV, week, prevWeek: prevWeekV, day, prevDay: prevDayV,
      metaAlvo: withMeta ? model.metaAlvo : null, metaUp: withMeta ? model.metaUp : null,
      pctMonth: Var(month, prevMonthV), pctWeek: Var(week, prevWeekV), pctDay: Var(day, prevDayV),
    };
  }
  const blocks = [];
  // "Geral" = sum of selected kiosks
  const geralModel = {
    daily: daily.map((d) => ({ day: d.date.slice(8) | 0, revenue: d.revenue })),
  };
  blocks.push(buildFatBlock(geralModel, 'Geral', false));
  kiosks.forEach((k) => blocks.push(buildFatBlock(k, k.name, true)));

  // ── colaboradores (month, grouped by kiosk) ──
  const colaboradores = kiosks.map((k) => ({
    kioskId: k.id, kioskName: k.name,
    rows: k.colaboradores.map((c) => ({
      userName: c.name, monthRevenue: c.revenue, targetValue: c.meta, upValue: c.up,
    })),
  }));

  // ── combos (merged) ──
  const comboMap = {};
  kiosks.forEach((k) => k.combos.forEach((c) => { comboMap[c.name] = (comboMap[c.name] || 0) + Math.round(c.count * rangeProp); }));
  const combos = Object.entries(comboMap).map(([name, count]) => ({ name, count })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  // ── evolution (single kiosk → its rows; all → summed top5) ──
  let evolution = { months: [3, 4, 5], rows: [] };
  if (kiosks.length === 1) {
    evolution = kiosks[0].evolution;
  } else {
    const merged = {};
    kiosks.forEach((k) => k.evolution.rows.forEach((r) => {
      if (!merged[r.product]) merged[r.product] = { product: r.product, Mar: 0, Abr: 0, Mai: 0 };
      merged[r.product].Mar += r.Mar; merged[r.product].Abr += r.Abr; merged[r.product].Mai += r.Mai;
    }));
    evolution = { months: [3, 4, 5], rows: Object.values(merged).sort((a, b) => b.Mai - a.Mai).slice(0, 5) };
  }

  // ── summary cards ──
  const topProduct = ranking[0] || null;
  // produtos vendidos variation (▼36.1% in print): prev = units/0.639
  const variation = rangeUnits > 0 ? -36.1 : null;

  return {
    periodLabel: label,
    year: CUR_YEAR,
    summary: {
      totalCoupons: rangeCoupons,
      totalUnits: rangeUnits,
      revenue: rangeRevenue,
      ticketMedio: rangeRevenue > 0 && rangeCoupons > 0 ? rangeRevenue / rangeCoupons : null,
      topProduct,
      variation,
    },
    blocks, colaboradores, daily, ranking, abc, mix, evolution, hourlyByKiosk, combos,
    hasMetas: kioskId !== 'all',
  };
}

Object.assign(window, {
  SALES_KIOSKS, SALES_LINES, SALES_COLORS, SALES_MONTHS, SALES_WEEKDAYS,
  getSalesView, salesFmtNum: fmtNum, salesFmt2: fmt2,
  SALES_TODAY_DAY: TODAY_DAY, SALES_CUR_MONTH: CUR_MONTH, SALES_CUR_YEAR: CUR_YEAR,
  SALES_MONTH_OPTIONS, SALES_HISTORY_DEFAULT,
  getKioskMonthHistory, getProductQtyByKiosk, getProductOptions,
});
