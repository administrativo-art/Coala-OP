// Coala · Análise de vendas — main screen
const { useState: useSlState, useMemo: useSlMemo } = React;

// ── local icons (lucide vocabulary) not in the shared I set ──────────────────
const _svg = (children, p = {}) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={p.strokeWidth || 2} strokeLinecap="round" strokeLinejoin="round"
    className={p.className || ''} aria-hidden="true">{children}</svg>
);
const SI = {
  Dollar:   (p) => _svg(<><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>, p),
  Award:    (p) => _svg(<><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" /></>, p),
  Grid:     (p) => _svg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>, p),
  Bars:     (p) => _svg(<><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>, p),
  Bag:      (p) => _svg(<><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></>, p),
  Layers:   (p) => _svg(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>, p),
  Pie:      (p) => _svg(<><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>, p),
  Trend:    (p) => _svg(<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>, p),
  Clock:    (p) => _svg(<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>, p),
  CalRange: (p) => _svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18M17 14l2 2-2 2" /></>, p),
  Users:    (p) => _svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>, p),
  Search:   (p) => _svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, p),
  ArrowLeft:(p) => _svg(<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>, p),
  Chevron:  (p) => _svg(<><polyline points="6 9 12 15 18 9" /></>, p),
  Camera:   (p) => _svg(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>, p),
  Bell:     (p) => _svg(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>, p),
};

// ── small presentational helpers ─────────────────────────────────────────────
function VarPct({ pct, size = '10px' }) {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span className="font-semibold" style={{ fontSize: size, color: up ? '#16a34a' : '#e11d48' }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
function MetaPct({ pct }) {
  if (pct === null || pct === undefined) return null;
  const color = pct >= 100 ? '#16a34a' : pct >= 70 ? '#ca8a04' : '#e11d48';
  return <span className="font-bold text-[10px]" style={{ color }}>{pct.toFixed(1)}% atingido</span>;
}
function SectionHead({ icon: IconC, title, note, right }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2 mb-4 flex-wrap gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <IconC size={15} className="text-zinc-400 shrink-0" />
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h3>
        {note && <span className="text-[11px] text-zinc-400 truncate">· {note}</span>}
      </div>
      {right}
    </div>
  );
}

// ── filter bar primitives ────────────────────────────────────────────────────
function FilterLabel({ children }) {
  return <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 ml-0.5 mb-1.5">{children}</p>;
}
function ToggleGroup({ value, onChange, options }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/60 dark:bg-zinc-900 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`h-7 px-3 rounded-md text-[11px] font-medium transition ${
            value === o.value
              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}>{o.label}</button>
      ))}
    </div>
  );
}

// ── summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ label, children, sub }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] text-zinc-500">{label}</p>
      <div className="mt-1">{children}</div>
      {sub}
    </Card>
  );
}

// ── faturamento block ────────────────────────────────────────────────────────
function FatBlock({ b }) {
  const pctAlvo = b.metaAlvo ? (b.month / b.metaAlvo) * 100 : null;
  const pctUp = b.metaUp ? (b.month / b.metaUp) * 100 : null;
  return (
    <Card className="p-4">
      <p className="text-[12px] font-semibold text-zinc-500 mb-3">{b.label}</p>
      <div className="grid grid-cols-3 gap-3 divide-x divide-zinc-200 dark:divide-zinc-800 mb-3">
        <div>
          <p className="text-[10px] text-zinc-400">Mês corrente</p>
          <p className="text-[18px] font-bold leading-tight">R$ {salesFmt2(b.month)}</p>
          <VarPct pct={b.pctMonth} />
        </div>
        <div className="pl-3">
          <p className="text-[10px] text-zinc-400">Semana</p>
          <p className="text-[18px] font-bold leading-tight">R$ {salesFmt2(b.week)}</p>
          <VarPct pct={b.pctWeek} />
        </div>
        <div className="pl-3">
          <p className="text-[10px] text-zinc-400">Hoje</p>
          <p className="text-[18px] font-bold leading-tight">R$ {salesFmt2(b.day)}</p>
          <VarPct pct={b.pctDay} />
        </div>
      </div>
      {(b.metaAlvo || b.metaUp) && (
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 divide-x divide-zinc-200 dark:divide-zinc-800">
          <div>
            <p className="text-[10px] text-zinc-400">Meta alvo</p>
            <p className="text-[14px] font-semibold leading-tight">R$ {salesFmt2(b.metaAlvo)}</p>
            <MetaPct pct={pctAlvo} />
          </div>
          <div className="pl-3">
            <p className="text-[10px] text-zinc-400">Meta UP</p>
            <p className="text-[14px] font-semibold leading-tight">R$ {salesFmt2(b.metaUp)}</p>
            <MetaPct pct={pctUp} />
          </div>
        </div>
      )}
    </Card>
  );
}

// ── table shell ──────────────────────────────────────────────────────────────
function THead({ cols }) {
  return (
    <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-400 uppercase text-[10px] font-bold">
      <tr>{cols.map((c, i) => (
        <th key={i} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.w || ''} ${c.onClick ? 'cursor-pointer select-none' : ''}`} onClick={c.onClick}>{c.label}</th>
      ))}</tr>
    </thead>
  );
}

// =============================================================================
function SalesAnalysisScreen({ tweaks, onBack }) {
  const [kioskId, setKioskId] = useSlState('joao-paulo');
  const [preset, setPreset] = useSlState('thisMonth');
  const [evoMode, setEvoMode] = useSlState('overview');
  const [range, setRange] = useSlState({ start: '2026-05-01', end: '2026-05-29' });
  const [tab, setTab] = useSlState('painel');

  const [rankingSearch, setRankingSearch] = useSlState('');
  const [rankSort, setRankSort] = useSlState('desc');
  const [abcSearch, setAbcSearch] = useSlState('');
  const [comboSearch, setComboSearch] = useSlState('');
  const [hourlyProduct, setHourlyProduct] = useSlState('all');
  const [selectedHour, setSelectedHour] = useSlState(null); // {kioskId, hourStr}
  const [productFilter, setProductFilter] = useSlState([]); // product ids for "Qtde por produto"
  const [productSelectOpen, setProductSelectOpen] = useSlState(false);
  const [productSearch, setProductSearch] = useSlState('');
  const [expandedRows, setExpandedRows] = useSlState({}); // `${kioskId}|||${id}` → bool
  const [historyMonths, setHistoryMonths] = useSlState(SALES_HISTORY_DEFAULT);

  const v = useSlMemo(() => getSalesView(kioskId, preset, range), [kioskId, preset, range]);

  // ranking filter/sort
  const filteredRanking = useSlMemo(() => {
    let r = [...v.ranking];
    if (rankingSearch) r = r.filter((p) => p.name.toLowerCase().includes(rankingSearch.toLowerCase()));
    if (rankSort === 'asc') r = r.reverse();
    return r;
  }, [v.ranking, rankingSearch, rankSort]);
  const filteredAbc = useSlMemo(() => (!abcSearch ? v.abc : v.abc.filter((p) => p.name.toLowerCase().includes(abcSearch.toLowerCase()))), [v.abc, abcSearch]);
  const filteredCombos = useSlMemo(() => (!comboSearch ? v.combos : v.combos.filter((c) => c.name.toLowerCase().includes(comboSearch.toLowerCase()))), [v.combos, comboSearch]);

  const productOptions = useSlMemo(() => getProductOptions(kioskId), [kioskId]);
  const productByKiosk = useSlMemo(() => getProductQtyByKiosk(kioskId, preset, range, productFilter), [kioskId, preset, range, productFilter]);
  const monthHistory = useSlMemo(() => getKioskMonthHistory(kioskId, historyMonths), [kioskId, historyMonths]);
  const toggleExpand = (key) => setExpandedRows((p) => ({ ...p, [key]: !p[key] }));

  const s = v.summary;
  const monthName = SALES_MONTHS[SALES_CUR_MONTH - 1];

  const TABS = [
    { id: 'painel', label: 'Painel', icon: SI.Grid },
    { id: 'ranking', label: 'Ranking', icon: SI.Award },
    { id: 'combos', label: 'Combos', icon: SI.Layers },
    { id: 'abc', label: 'Curva ABC', icon: SI.Bars },
  ];

  return (
    <div className="space-y-6">
      {/* back */}
      <button onClick={onBack} className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-[13px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition">
        <SI.ArrowLeft size={15} /> Voltar para gestão de estoque
      </button>

      {/* title */}
      <div>
        <h1 className="text-[30px] font-extrabold tracking-tight">Análise de vendas</h1>
        <p className="mt-1 text-[13px] text-zinc-500">Visualize o ranking, tendências e comparativos de vendas brutas.</p>
      </div>

      {/* filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-5 items-end">
          <div>
            <FilterLabel>Quiosque</FilterLabel>
            <div className="w-[200px]">
              <Select value={kioskId} onChange={(e) => setKioskId(e.target.value)}>
                <option value="all">Todos os quiosques</option>
                {SALES_KIOSKS.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <FilterLabel>Período prático</FilterLabel>
            <ToggleGroup value={preset} onChange={setPreset} options={[
              { value: 'yesterday', label: 'Ontem' },
              { value: 'today', label: 'Hoje' },
              { value: 'thisMonth', label: 'Mês Atual' },
              { value: 'lastMonth', label: 'Mês Passado' },
              { value: 'custom', label: 'Intervalo' },
            ]} />
          </div>
          {preset === 'custom' && (
            <div className="flex items-end gap-2">
              <div>
                <FilterLabel>Início</FilterLabel>
                <input type="date" value={range.start} min="2026-05-01" max="2026-05-29" onChange={(e) => setRange((p) => ({ ...p, start: e.target.value }))}
                  className="h-9 rounded-lg bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3 text-[13px] focus:ring-2 focus:ring-[--accent] outline-none" />
              </div>
              <div>
                <FilterLabel>Fim</FilterLabel>
                <input type="date" value={range.end} min="2026-05-01" max="2026-05-29" onChange={(e) => setRange((p) => ({ ...p, end: e.target.value }))}
                  className="h-9 rounded-lg bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-800 px-3 text-[13px] focus:ring-2 focus:ring-[--accent] outline-none" />
              </div>
            </div>
          )}
          <div>
            <FilterLabel>Evolução Mensal</FilterLabel>
            <ToggleGroup value={evoMode} onChange={setEvoMode} options={[
              { value: 'overview', label: 'Período' },
              { value: 'compare', label: 'Por Mês' },
            ]} />
          </div>
        </div>
      </Card>

      {/* badges */}
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{v.year}</span>
        <span className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{v.periodLabel}</span>
      </div>

      {/* summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Total de cupons">
          <p className="text-[26px] font-bold leading-none">{salesFmtNum(s.totalCoupons)}</p>
        </SummaryCard>
        <SummaryCard label="Produtos vendidos"
          sub={s.variation !== null ? <p className="mt-1 text-[12px] font-semibold" style={{ color: s.variation >= 0 ? '#16a34a' : '#e11d48' }}>{s.variation >= 0 ? '▲' : '▼'} {Math.abs(s.variation).toFixed(1)}% vs anterior</p> : null}>
          <p className="text-[26px] font-bold leading-none">{salesFmtNum(s.totalUnits)}</p>
        </SummaryCard>
        <SummaryCard label="Faturamento">
          <p className="text-[26px] font-bold leading-none">{s.revenue > 0 ? <>R$ {salesFmt2(s.revenue)}</> : <span className="text-zinc-300 text-[20px]">—</span>}</p>
        </SummaryCard>
        <SummaryCard label="Ticket médio"
          sub={s.ticketMedio ? <p className="mt-1 text-[12px] text-zinc-400">por cupom</p> : null}>
          <p className="text-[26px] font-bold leading-none">{s.ticketMedio ? <>R$ {salesFmt2(s.ticketMedio)}</> : <span className="text-zinc-300 text-[20px]">—</span>}</p>
        </SummaryCard>
        <SummaryCard label="Top Produto"
          sub={s.topProduct ? <p className="mt-1 text-[12px] text-zinc-400">{salesFmtNum(s.topProduct.quantity)} un</p> : null}>
          <p className="text-[17px] font-bold leading-tight truncate">{s.topProduct ? s.topProduct.name : '—'}</p>
        </SummaryCard>
      </div>

      {/* tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 rounded-xl bg-zinc-100/70 dark:bg-zinc-900 p-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center justify-center gap-1.5 h-10 rounded-lg text-[13px] font-semibold transition ${
              tab === t.id ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── PAINEL ───────────────────────────────────────────────────────── */}
      {tab === 'painel' && (
        <div className="space-y-10">
          {/* Faturamento */}
          <section>
            <SectionHead icon={SI.Dollar} title="Faturamento do mês"
              right={!v.hasMetas ? <span className="rounded-md ring-1 ring-zinc-200 dark:ring-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">Selecione um quiosque para ver metas</span> : null} />
            <div className="space-y-3">
              {v.blocks.map((b, i) => <FatBlock key={i} b={b} />)}
            </div>
          </section>

          {/* Colaboradores */}
          <section>
            <SectionHead icon={SI.Users} title="Faturamento do mês por colaborador" />
            <div className="space-y-6">
              {v.colaboradores.map((grp) => (
                <div key={grp.kioskId} className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 px-1">{grp.kioskName}</p>
                  <Card className="overflow-hidden">
                    <table className="w-full text-[13px] text-left border-collapse">
                      <THead cols={[
                        { label: 'Colaborador' }, { label: 'Faturamento (mês)', align: 'right' },
                        { label: 'Meta alvo', align: 'right' }, { label: '% Alvo', align: 'right' },
                        { label: 'Meta UP', align: 'right' }, { label: '% UP', align: 'right' },
                      ]} />
                      <tbody>
                        {grp.rows.map((c, i) => {
                          const pctAlvo = c.targetValue > 0 ? (c.monthRevenue / c.targetValue) * 100 : null;
                          const pctUp = c.upValue > 0 ? (c.monthRevenue / c.upValue) * 100 : null;
                          const col = (p) => p === null ? '' : p >= 100 ? 'text-emerald-600' : p >= 70 ? 'text-yellow-600' : 'text-rose-600';
                          return (
                            <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50">
                              <td className="px-4 py-2.5 font-medium">{c.userName}</td>
                              <td className="px-4 py-2.5 text-right font-bold tabular-nums">R$ {salesFmt2(c.monthRevenue)}</td>
                              <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">R$ {salesFmt2(c.targetValue)}</td>
                              <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${col(pctAlvo)}`}>{pctAlvo !== null ? pctAlvo.toFixed(1) + '%' : '—'}</td>
                              <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">R$ {salesFmt2(c.upValue)}</td>
                              <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${col(pctUp)}`}>{pctUp !== null ? pctUp.toFixed(1) + '%' : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </Card>
                </div>
              ))}
            </div>
          </section>

          {/* Comparativo Diário */}
          {v.daily.length > 1 && (
            <section>
              <SectionHead icon={SI.CalRange} title="Comparativo Diário" note={`${v.daily.length} dias · melhor e pior destacados`} />
              <Card className="p-4 space-y-4">
                <DailyComposedChart data={v.daily} />
                <div className="overflow-x-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                  <table className="w-full text-[13px] text-left border-collapse">
                    <THead cols={[
                      { label: 'Data' }, { label: 'Unidades', align: 'right' }, { label: 'Cupons', align: 'right' },
                      { label: 'Faturamento', align: 'right' }, { label: 'Ticket Médio', align: 'right' },
                      { label: 'Variação', align: 'right' }, { label: 'Top Produto' },
                    ]} />
                    <tbody>
                      {v.daily.map((d) => (
                        <tr key={d.date} className={`border-t border-zinc-100 dark:border-zinc-800 ${d.isToday ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : d.isBest ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : d.isWorst ? 'bg-rose-50/50 dark:bg-rose-950/20' : 'hover:bg-zinc-50/70'}`}>
                          <td className="px-3 py-2 font-medium text-[12px] whitespace-nowrap">
                            {d.label}
                            {d.isToday && <span className="ml-2 rounded px-1.5 py-0.5 text-[9px] bg-indigo-100 text-indigo-700">em andamento</span>}
                            {d.isBest && <span className="ml-2 rounded px-1.5 py-0.5 text-[9px] bg-emerald-100 text-emerald-700">melhor</span>}
                            {d.isWorst && <span className="ml-2 rounded px-1.5 py-0.5 text-[9px] bg-rose-100 text-rose-700">pior</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-[12px] tabular-nums">{salesFmtNum(d.units)}</td>
                          <td className="px-3 py-2 text-right text-[12px] text-zinc-400 tabular-nums">{salesFmtNum(d.coupons)}</td>
                          <td className="px-3 py-2 text-right text-[12px] tabular-nums">{d.revenue > 0 ? 'R$ ' + salesFmt2(d.revenue) : <span className="text-zinc-300">—</span>}</td>
                          <td className="px-3 py-2 text-right text-[12px] font-semibold tabular-nums">{d.ticketMedio !== null ? 'R$ ' + salesFmt2(d.ticketMedio) : <span className="text-zinc-300 font-normal">—</span>}</td>
                          <td className="px-3 py-2 text-right text-[12px]">{d.delta === null ? <span className="text-zinc-300">—</span> : <VarPct pct={d.delta} size="12px" />}</td>
                          <td className="px-3 py-2 text-[12px] text-zinc-400 truncate max-w-[150px]">{d.topProduct || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">
                      <tr className="text-[12px] font-bold">
                        <td className="px-3 py-2">Média</td>
                        <td className="px-3 py-2 text-right tabular-nums">{salesFmtNum(Math.round(v.daily.reduce((a, d) => a + d.units, 0) / v.daily.length))}</td>
                        <td className="px-3 py-2 text-right text-zinc-400 tabular-nums">{salesFmtNum(Math.round(v.daily.reduce((a, d) => a + d.coupons, 0) / v.daily.length))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">R$ {salesFmt2(v.daily.reduce((a, d) => a + d.revenue, 0) / v.daily.length)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{(() => { const tr = v.daily.reduce((a, d) => a + d.revenue, 0); const tc = v.daily.reduce((a, d) => a + d.coupons, 0); return tc > 0 ? 'R$ ' + salesFmt2(tr / tc) : '—'; })()}</td>
                        <td className="px-3 py-2"></td><td className="px-3 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            </section>
          )}

          {/* Qtde por Produto por mês - Quiosque */}
          <section>
            <SectionHead icon={SI.Bars} title="Qtde por Produto por mês — Quiosque"
              right={
                <div className="flex items-center gap-2">
                  {productFilter.length > 0 && (
                    <button onClick={() => setProductFilter([])} className="h-7 px-2 rounded-md text-[11px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">Limpar ({productFilter.length})</button>
                  )}
                  <div className="relative">
                    <button onClick={() => { setProductSelectOpen((o) => !o); setProductSearch(''); }}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <SI.Search size={12} />
                      {productFilter.length === 0 ? 'Selecionar produtos' : `${productFilter.length} produto${productFilter.length > 1 ? 's' : ''} selecionado${productFilter.length > 1 ? 's' : ''}`}
                      <SI.Chevron size={12} className="opacity-50" />
                    </button>
                    {productSelectOpen && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setProductSelectOpen(false)}></div>
                        <div className="absolute right-0 z-40 mt-1.5 w-[300px] rounded-xl bg-white dark:bg-zinc-900 ring-1 ring-zinc-200 dark:ring-zinc-700 shadow-xl p-2 animate-fade">
                          <input autoFocus placeholder="Buscar produto…" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                            className="h-8 w-full rounded-lg bg-zinc-50 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 px-2.5 text-[12px] focus:ring-2 focus:ring-[--accent] outline-none mb-2" />
                          {productFilter.length >= 10 && <p className="text-[10px] text-zinc-400 px-1 mb-1">Limite de 10 produtos atingido</p>}
                          <div className="max-h-[260px] overflow-y-auto space-y-0.5">
                            {productOptions.filter((p) => !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())).map((p) => {
                              const selected = productFilter.includes(p.simulationId);
                              const atMax = productFilter.length >= 10 && !selected;
                              return (
                                <button key={p.simulationId} disabled={atMax}
                                  onClick={() => setProductFilter((prev) => selected ? prev.filter((id) => id !== p.simulationId) : [...prev, p.simulationId])}
                                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12.5px] text-left transition ${selected ? 'bg-[--accent-soft]' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'} ${atMax ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${selected ? 'bg-[--accent] border-[--accent]' : 'border-zinc-300 dark:border-zinc-600'}`}>
                                    {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </span>
                                  <span className="flex-1 truncate">{p.name}</span>
                                  <span className="text-[10px] text-zinc-400 tabular-nums">{salesFmtNum(p.quantity)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              } />
            {productFilter.length === 0 ? (
              <p className="text-[13px] text-zinc-400 py-6 text-center">Selecione até 10 produtos para ver a quantidade vendida por quiosque no período selecionado.</p>
            ) : (
              <div className="space-y-4">
                {productByKiosk.map((kg) => (
                  <div key={kg.kioskId} className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 px-1">{kg.kioskName}</p>
                    <Card className="overflow-hidden">
                      <table className="w-full text-[13px] text-left border-collapse">
                        <THead cols={[{ label: '', w: 'w-8' }, { label: 'Produto' }, { label: 'Qtde vendida — período selecionado', align: 'right' }]} />
                        <tbody>
                          {kg.products.map((p) => {
                            const key = `${kg.kioskId}|||${p.simulationId}`;
                            const exp = !!expandedRows[key];
                            const hasOps = p.operators.length > 0;
                            return (
                              <React.Fragment key={p.simulationId}>
                                <tr className={`border-t border-zinc-100 dark:border-zinc-800 ${hasOps ? 'cursor-pointer hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50' : ''}`} onClick={() => hasOps && toggleExpand(key)}>
                                  <td className="px-4 py-2.5 text-zinc-400 text-[11px]">{hasOps ? (exp ? '▾' : '▸') : ''}</td>
                                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                                  <td className="px-4 py-2.5 text-right font-bold tabular-nums">{p.qty > 0 ? `${salesFmtNum(p.qty)} un` : <span className="text-zinc-300 font-normal">—</span>}</td>
                                </tr>
                                {exp && p.operators.map((op) => (
                                  <tr key={op.name} className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/40">
                                    <td className="px-4 py-1.5"></td>
                                    <td className="px-4 py-1.5 text-[12px] text-zinc-500 pl-8">↳ {op.name}</td>
                                    <td className="px-4 py-1.5 text-right text-[12px] font-semibold tabular-nums text-zinc-500">{salesFmtNum(op.qty)} un</td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Mix por Linha */}
          <section>
            <SectionHead icon={SI.Pie} title="Mix por Linha de Produto" />
            <Card className="p-5 grid md:grid-cols-2 gap-8 items-center">
              <MixPieChart data={v.mix} colors={SALES_COLORS} />
              <table className="w-full text-[13px] text-left border-collapse">
                <thead><tr className="text-zinc-400 text-[11px] uppercase font-bold border-b border-zinc-200 dark:border-zinc-800"><th className="py-2 text-left">Linha</th><th className="py-2 text-right">Qtd</th></tr></thead>
                <tbody>
                  {v.mix.map((l, i) => (
                    <tr key={i} className="border-b border-zinc-100 dark:border-zinc-800/60">
                      <td className="py-2 flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: SALES_COLORS[i % SALES_COLORS.length] }}></span>{l.name}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{salesFmtNum(l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {/* Evolução */}
          <section>
            <SectionHead icon={SI.Trend} title={`Evolução de vendas — Top 5${evoMode === 'compare' ? ' · por mês' : ''}`} />
            <Card className="p-5">
              {v.evolution.rows.length === 0
                ? <p className="text-[13px] text-zinc-400 py-8 text-center">Nenhum dado para o período selecionado.</p>
                : <EvolutionChart rows={v.evolution.rows} months={v.evolution.months} monthLabels={SALES_MONTHS} colors={SALES_COLORS} />}
            </Card>
          </section>

          {/* Fluxo por Horário */}
          <section>
            <SectionHead icon={SI.Clock} title="Fluxo por Horário"
              right={
                <div className="w-[210px]">
                  <Select value={hourlyProduct} onChange={(e) => { setHourlyProduct(e.target.value); setSelectedHour(null); }}>
                    <option value="all">Todos os produtos</option>
                    {v.ranking.map((p) => <option key={p.simulationId} value={p.simulationId}>{p.name}</option>)}
                  </Select>
                </div>
              } />
            <div className="space-y-4">
              {v.hourlyByKiosk.map((kg) => {
                const showCoupons = hourlyProduct === 'all';
                const data = kg.data.map((h) => ({ ...h, displayValue: showCoupons ? h.coupons : (h.products.find((p) => p.simulationId === hourlyProduct)?.quantity || 0) }));
                const sel = selectedHour && selectedHour.kioskId === kg.kioskId ? data.find((d) => d.hourStr === selectedHour.hourStr) : null;
                return (
                  <Card key={kg.kioskId} className="p-4">
                    <p className="text-[13px] font-semibold mb-2">{kg.kioskName}</p>
                    <HourlyBarChart data={data} valueKey="displayValue"
                      selectedHour={sel ? selectedHour.hourStr : null}
                      onPick={(h) => setSelectedHour((prev) => (prev && prev.kioskId === kg.kioskId && prev.hourStr === h ? null : { kioskId: kg.kioskId, hourStr: h }))} />
                    {sel && (
                      <div className="mt-4 border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-3 animate-slide">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-bold text-[13px]">Produtos — {sel.hourStr}h</h4>
                            <p className="text-[12px] text-zinc-400">{showCoupons ? `${sel.coupons} cupons · ${sel.total} unidades` : `${sel.total} unidades`}</p>
                          </div>
                          <button onClick={() => setSelectedHour(null)} className="text-[12px] text-zinc-500 hover:text-zinc-800 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">Fechar</button>
                        </div>
                        {sel.products.length === 0
                          ? <p className="text-[13px] text-zinc-400 text-center py-4">Nenhuma venda neste horário.</p>
                          : (
                            <div className="rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800 overflow-hidden">
                              <table className="w-full text-[13px] border-collapse">
                                <THead cols={[{ label: 'Produto' }, { label: 'Qtd', align: 'right' }]} />
                                <tbody>
                                  {sel.products.map((p, idx) => (
                                    <tr key={idx} className={`border-t border-zinc-100 dark:border-zinc-800 ${hourlyProduct === p.simulationId ? 'bg-[--accent-soft] font-semibold' : ''}`}>
                                      <td className="px-4 py-2">{p.name}</td>
                                      <td className="px-4 py-2 text-right tabular-nums">{p.quantity} un</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>

          {/* Comparativo de quantidade de produtos vendidos (histórico mensal) */}
          <section>
            <SectionHead icon={SI.Bag} title="Comparativo de quantidade de produtos vendidos"
              right={
                <div className="flex flex-wrap gap-0.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900 p-0.5 max-w-[460px]">
                  {SALES_MONTH_OPTIONS.map((o) => {
                    const active = historyMonths.includes(o.key);
                    return (
                      <button key={o.key} onClick={() => setHistoryMonths((prev) => active ? prev.filter((k) => k !== o.key) : [...prev, o.key])}
                        className={`h-6 px-2 rounded-md text-[10px] font-medium transition ${active ? 'bg-[--accent] text-white' : 'text-zinc-500 hover:bg-white dark:hover:bg-zinc-800'}`}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              } />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {monthHistory.map((kg) => (
                <Card key={kg.kioskId} className="p-4">
                  <p className="text-[13px] font-semibold mb-1">{kg.kioskName}</p>
                  <MonthHistoryChart bars={kg.bars} />
                  <div className="flex items-center justify-end gap-3 mt-1">
                    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#E91E8C' }}></span>Meses do ano corrente</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: '#6366F1' }}></span>Mesmo mês ano passado</span>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── RANKING ──────────────────────────────────────────────────────── */}
      {tab === 'ranking' && (
        <Card className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h3 className="text-[16px] font-bold">Ranking de Vendas</h3>
            <div className="w-[220px]"><Input icon={SI.Search} placeholder="Filtrar…" value={rankingSearch} onChange={(e) => setRankingSearch(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-[13px] text-left border-collapse">
              <THead cols={[
                { label: '#', w: 'w-12' }, { label: 'Produto' },
                { label: <>Qtd {rankSort === 'desc' ? '↓' : '↑'}</>, align: 'right', onClick: () => setRankSort((d) => d === 'desc' ? 'asc' : 'desc') },
                { label: '%', align: 'right' },
              ]} />
              <tbody>
                {filteredRanking.map((it, i) => (
                  <tr key={it.simulationId} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-2.5">{rankSort === 'desc' && i < 3 ? ['🥇', '🥈', '🥉'][i] : (rankSort === 'desc' ? i + 1 : '')}</td>
                    <td className="px-4 py-2.5 font-medium">{it.name}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums">{salesFmtNum(it.quantity)}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">{s.totalUnits > 0 ? ((it.quantity / s.totalUnits) * 100).toFixed(1) : '0'}%</td>
                  </tr>
                ))}
                {filteredRanking.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-zinc-400">Nenhum produto para este filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── COMBOS ───────────────────────────────────────────────────────── */}
      {tab === 'combos' && (
        <Card className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-[16px] font-bold">Cesta de Compras (Combos)</h3>
              <p className="text-[12px] text-zinc-500 mt-0.5">Descubra os produtos mais comprados juntos no mesmo cupom.</p>
            </div>
            <div className="w-full sm:w-[280px]"><Input icon={SI.Search} placeholder="Filtrar produtos no combo…" value={comboSearch} onChange={(e) => setComboSearch(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-[13px] text-left border-collapse">
              <THead cols={[{ label: '#', w: 'w-12' }, { label: 'Itens no mesmo cupom' }, { label: 'Qtd. de cupons', align: 'right' }]} />
              <tbody>
                {filteredCombos.map((c, idx) => (
                  <tr key={idx} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-semibold text-zinc-400">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {c.name.split(' + ').map((item, i) => {
                          const [qtd, ...rest] = item.split('x ');
                          return <span key={i} className="inline-flex items-center gap-1 rounded-md ring-1 ring-zinc-200 dark:ring-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-0.5 text-[11px]"><b className="text-[--accent]">{qtd}x</b> {rest.join('x ')}</span>;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums">{salesFmtNum(c.count)}</td>
                  </tr>
                ))}
                {filteredCombos.length === 0 && <tr><td colSpan={3} className="px-4 py-10 text-center text-zinc-400">Nenhum combo encontrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── CURVA ABC ────────────────────────────────────────────────────── */}
      {tab === 'abc' && (
        <Card className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h3 className="text-[16px] font-bold">Curva ABC</h3>
            <div className="w-[220px]"><Input icon={SI.Search} placeholder="Filtrar…" value={abcSearch} onChange={(e) => setAbcSearch(e.target.value)} /></div>
          </div>
          <div className="overflow-x-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-[13px] text-left border-collapse">
              <THead cols={[{ label: 'Produto' }, { label: 'Qtd', align: 'right' }, { label: '%', align: 'right' }, { label: 'Acum.', align: 'right' }, { label: 'Classe', align: 'right' }]} />
              <tbody>
                {filteredAbc.map((it) => {
                  const cc = it.cls === 'A' ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900' : it.cls === 'B' ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100' : 'ring-1 ring-zinc-300 text-zinc-500';
                  return (
                    <tr key={it.simulationId} className="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50/70 dark:hover:bg-zinc-900/50">
                      <td className="px-4 py-2.5 font-medium">{it.name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{salesFmtNum(it.quantity)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{it.pct}%</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{it.accumulated}%</td>
                      <td className="px-4 py-2.5 text-right"><span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[11px] font-bold ${cc}`}>{it.cls}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

Object.assign(window, { SalesAnalysisScreen });
