"use client";

import { useState } from "react";
import { Segmented } from "@/components/patterns/segmented";
import { rateLabel } from "./stone-account-format";

export type FeeHistorySeries = { key: string; label: string; months: Array<{ month: string; rate: number | null; sales: number }> };
type View = "bars" | "minis" | "heat" | "curve";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const short = (month: string) => MONTHS[Number(month.slice(5)) - 1];
const long = (month: string) => MONTHS_LONG[Number(month.slice(5)) - 1];
// Cores: azul = série; laranja/verde = subiu/desceu (sempre com seta e texto, nunca só cor).
const BLUE = "#2a78d6", UP = "#eb6834", DOWN = "#1baf7a", GRID = "#f1eee8", INK_FAINT = "#6e737a";
const STORAGE_KEY = "taxas-historico-vista";

function readView(): View {
  try { const value = window.localStorage.getItem(STORAGE_KEY); if (value === "bars" || value === "minis" || value === "heat" || value === "curve") return value; } catch { /* sem armazenamento */ }
  return "bars";
}
const delta = (from: number | null, to: number | null) => from === null || to === null ? null : to - from;
function DeltaText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ds-ink-faint">—</span>;
  if (Math.abs(value) < 1e-9) return <span className="text-ds-ink-faint">igual</span>;
  return <span className={value > 0 ? "font-bold text-ds-warn" : "font-bold text-ds-ok"}>{value > 0 ? "▲ +" : "▼ "}{(value * 100).toFixed(2).replace(".", ",")} p.p.</span>;
}

/** Cartão do cursor: o mês e a comparação com o anterior e o seguinte. */
function Tooltip({ series, index }: { series: FeeHistorySeries; index: number }) {
  const months = series.months;
  const current = months[index], previous = months[index - 1], next = months[index + 1];
  return <div role="tooltip" className="pointer-events-none min-w-[220px] rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3 py-2.5 text-[12.5px] shadow-ds-lift">
    <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-ds-ink-faint">{series.label} · {long(current.month)}</p>
    <p className="my-0.5 tabular-nums text-[20px] font-bold text-ds-ink">{rateLabel(current.rate)}</p>
    <p className="flex justify-between gap-3 border-t border-ds-divider py-1"><span className="text-ds-ink-muted">{previous ? long(previous.month) : "mês anterior"}</span><span><b className="tabular-nums">{rateLabel(previous?.rate ?? null)}</b> {previous ? <DeltaText value={delta(previous.rate, current.rate)} /> : null}</span></p>
    <p className="flex justify-between gap-3 border-t border-ds-divider py-1"><span className="text-ds-ink-muted">{next ? long(next.month) : "próximo mês"}</span><span>{next ? <><b className="tabular-nums">{rateLabel(next.rate)}</b> <DeltaText value={delta(current.rate, next.rate)} /></> : <b>ainda não fechou</b>}</span></p>
  </div>;
}

function scale(values: number[], height: number, pad = 0.15) {
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 1e-6) { min -= 0.001; max += 0.001; }
  const range = max - min; min -= range * pad; max += range * pad;
  return { min, max, y: (value: number) => height - (value - min) / (max - min) * height };
}

/** Completa a série até 6 meses (o último mês conferido e os 5 anteriores); mês sem conferência fica vazio. */
export function padHistoryMonths(series: FeeHistorySeries[], count = 6): FeeHistorySeries[] {
  const last = series.flatMap(item => item.months.map(month => month.month)).sort().at(-1);
  if (!last) return series;
  const months: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)) - 1 - offset, 1));
    months.push(date.toISOString().slice(0, 7));
  }
  return series.map(item => ({ ...item, months: months.map(month => item.months.find(row => row.month === month) ?? { month, rate: null, sales: 0 }) }));
}

function MainChart({ series, kind }: { series: FeeHistorySeries; kind: "bars" | "curve" }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960, H = 210, PX = 64, PR = 16, count = series.months.length;
  const band = (W - PX - PR) / Math.max(count, 1);
  const x = (index: number) => PX + band * (index + 0.5);
  const values = series.months.map(item => item.rate).filter((value): value is number => value !== null);
  if (!values.length) return <p className="px-[18px] pb-4 text-sm text-ds-ink-muted">Sem taxa nos meses conferidos.</p>;
  // Barras começam no zero; a curva usa a faixa dos valores para mostrar a variação.
  const top = Math.max(Math.ceil(Math.max(...values) * 1.25 * 1000) / 1000, 0.001);
  const s = kind === "bars" ? { min: 0, max: top, y: (value: number) => H - value / top * H } : scale(values, H, 0.25);
  const points = series.months.map((item, index) => item.rate === null ? null : [x(index), s.y(item.rate)] as const);
  let curve = "";
  points.forEach((point, index) => {
    if (!point) return;
    const prev = points.slice(0, index).reverse().find(Boolean);
    if (!curve || !prev) { curve += `M${point[0]},${point[1]}`; return; }
    const mid = (prev[0] + point[0]) / 2;
    curve += ` C${mid},${prev[1]} ${mid},${point[1]} ${point[0]},${point[1]}`;
  });
  const ticks = [s.min, (s.min + s.max) / 2, s.max];
  const first = series.months.findIndex(item => item.rate !== null);
  return <div className="relative px-[18px] pb-2" onMouseLeave={() => setHover(null)}>
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="block h-auto w-full overflow-visible" role="img" aria-label={`Taxa de ${series.label} por mês`}
      onMouseMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const index = Math.floor(((event.clientX - rect.left) / rect.width * W - PX) / band); setHover(index >= 0 && index < count && series.months[index].rate !== null ? index : null); }}>
      <defs><linearGradient id="fee-curve" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity=".26" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient></defs>
      {ticks.map(value => <g key={value}><line x1={PX} x2={W - PR} y1={s.y(value)} y2={s.y(value)} stroke={GRID} /><text x={PX - 10} y={s.y(value) + 4} textAnchor="end" fontSize="11" fill={INK_FAINT} style={{ fontVariantNumeric: "tabular-nums" }}>{rateLabel(value)}</text></g>)}
      {series.months.map((item, index) => item.rate === null ? <text key={`empty-${item.month}`} x={x(index)} y={H - 10} textAnchor="middle" fontSize="11" fill={INK_FAINT}>sem conferência</text> : null)}
      {kind === "curve" ? <>
        {first >= 0 ? <path d={`${curve} V${H} H${x(first)} Z`} fill="url(#fee-curve)" /> : null}
        <path d={curve} fill="none" stroke={BLUE} strokeWidth="2" />
        {series.months.map((item, index) => {
          const prev = series.months[index - 1];
          if (!prev || item.rate === null || prev.rate === null || Math.abs(item.rate - prev.rate) < 1e-9) return null;
          const y = s.y(item.rate);
          return <g key={item.month}><line x1={x(index)} x2={x(index)} y1={y} y2={y - 30} stroke="#1a1b1f" />
            <rect x={x(index) - 61} y={y - 48} width="122" height="20" rx="6" fill={item.rate > prev.rate ? "#fde3d3" : "#dff3e8"} />
            <text x={x(index)} y={y - 34} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1b1f" style={{ fontVariantNumeric: "tabular-nums" }}>{rateLabel(prev.rate)}→{rateLabel(item.rate)}</text></g>;
        })}
        {points.map((point, index) => point ? <circle key={index} cx={point[0]} cy={point[1]} r={hover === index ? 6 : 4.5} fill={BLUE} stroke="#fff" strokeWidth="2" /> : null)}
      </> : series.months.map((item, index) => {
        if (item.rate === null) return null;
        const prev = series.months[index - 1]?.rate ?? null;
        const color = prev === null || Math.abs(item.rate - prev) < 1e-9 ? BLUE : item.rate > prev ? UP : DOWN;
        const near = hover === null || Math.abs(hover - index) <= 1;
        const width = Math.min(56, band * 0.5);
        const y = s.y(item.rate);
        return <g key={item.month} opacity={near ? 1 : 0.35}>{H - y >= 4 ? <path d={`M${x(index) - width / 2},${H} V${y + 4} q0,-4 4,-4 h${width - 8} q4,0 4,4 V${H} Z`} fill={color} /> : <rect x={x(index) - width / 2} y={y} width={width} height={Math.max(H - y, 1)} fill={color} />}
          <text x={x(index)} y={y - 8} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#1a1b1f" style={{ fontVariantNumeric: "tabular-nums" }}>{rateLabel(item.rate)}</text></g>;
      })}
      <line x1={PX} x2={W - PR} y1={H} y2={H} stroke="#dcd9d1" />
      {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} stroke="#1a1b1f" strokeDasharray="3 4" /> : null}
      {series.months.map((item, index) => <text key={item.month} x={x(index)} y={H + 22} textAnchor="middle" fontSize="12" fill={INK_FAINT}>{short(item.month)}</text>)}
    </svg>
    {hover !== null && series.months[hover] ? <div className="absolute top-2 z-10" style={{ left: `min(calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 240px))` }}><Tooltip series={series} index={hover} /></div> : null}
    {first > 0 ? <p className="mt-1 text-xs text-ds-ink-muted">Histórico começa em {long(series.months[first].month)} de {series.months[first].month.slice(0, 4)}: a conferência diária passou a ser salva neste mês.</p> : null}
  </div>;
}

function Minis({ all }: { all: FeeHistorySeries[] }) {
  const [hover, setHover] = useState<{ key: string; index: number } | null>(null);
  return <div className="grid gap-3 px-[18px] pb-[18px] sm:grid-cols-2 xl:grid-cols-3">{all.map(series => {
    const values = series.months.map(item => item.rate).filter((value): value is number => value !== null);
    const last = [...series.months].reverse().find(item => item.rate !== null);
    const lastIndex = last ? series.months.indexOf(last) : -1;
    const prev = lastIndex > 0 ? series.months[lastIndex - 1].rate : null;
    const W = 240, H = 56, step = series.months.length > 1 ? W / (series.months.length - 1) : 0;
    const s = values.length ? scale(values, H, 0.3) : null;
    return <div key={series.key} className="relative rounded-ds-btn-lg border border-ds-border bg-ds-surface px-3.5 py-3" onMouseLeave={() => setHover(null)}>
      <p className="text-xs text-ds-ink-muted">{series.label}</p>
      <p className="tabular-nums text-[18px] font-bold text-ds-ink">{rateLabel(last?.rate ?? null)} <span className="text-xs"><DeltaText value={delta(prev, last?.rate ?? null)} /></span></p>
      {s ? <svg viewBox={`0 0 ${W} ${H + 16}`} className="block h-auto w-full overflow-visible"
        onMouseMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const index = Math.round((event.clientX - rect.left) / rect.width * W / (step || 1)); setHover(index >= 0 && index < series.months.length ? { key: series.key, index } : null); }}>
        <polyline points={series.months.flatMap((item, index) => item.rate === null ? [] : [`${index * step},${s.y(item.rate)}`]).join(" ")} fill="none" stroke={BLUE} strokeWidth="2" />
        {series.months.map((item, index) => {
          if (item.rate === null) return null;
          const before = series.months[index - 1]?.rate ?? null;
          return <circle key={item.month} cx={index * step} cy={s.y(item.rate)} r="3.5" fill={before === null || Math.abs(item.rate - before) < 1e-9 ? BLUE : item.rate > before ? UP : DOWN} />;
        })}
        {series.months.map((item, index) => <text key={item.month} x={index * step} y={H + 14} textAnchor="middle" fontSize="9.5" fill={INK_FAINT}>{short(item.month)}</text>)}
      </svg> : <p className="text-xs text-ds-ink-faint">Sem taxa nos meses conferidos.</p>}
      {hover?.key === series.key && series.months[hover.index]?.rate !== null ? <div className="absolute left-2 top-full z-10 mt-1"><Tooltip series={series} index={hover.index} /></div> : null}
    </div>;
  })}</div>;
}

function Heat({ all }: { all: FeeHistorySeries[] }) {
  const [hover, setHover] = useState<{ key: string; index: number } | null>(null);
  const months = all[0]?.months ?? [];
  return <div className="overflow-x-auto px-[18px] pb-[18px]" onMouseLeave={() => setHover(null)}>
    <div className="relative grid min-w-[640px] gap-[3px]" style={{ gridTemplateColumns: `200px repeat(${months.length}, minmax(0, 1fr))` }}>
      <div />{months.map(item => <div key={item.month} className="py-1.5 text-center text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ds-ink-faint">{short(item.month)}</div>)}
      {all.map(series => <div key={series.key} className="contents">
        <div className="flex items-center text-[12.5px] font-semibold text-ds-ink">{series.label}</div>
        {series.months.map((item, index) => {
          const before = series.months[index - 1]?.rate ?? null;
          const change = item.rate === null || before === null ? 0 : item.rate - before;
          const tone = item.rate === null ? "bg-ds-input text-ds-ink-faint" : Math.abs(change) < 1e-9 ? "bg-ds-muted text-ds-ink-muted" : change > 0 ? "bg-ds-warn-bg text-ds-warn" : "bg-ds-ok-bg text-ds-ok";
          return <div key={item.month} className={`relative rounded-[7px] py-2 text-center tabular-nums text-xs font-bold ${tone}`} onMouseEnter={() => setHover(item.rate === null ? null : { key: series.key, index })}>
            {rateLabel(item.rate)}
            {hover?.key === series.key && hover.index === index ? <div className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2"><Tooltip series={series} index={index} /></div> : null}
          </div>;
        })}
      </div>)}
    </div>
    <p className="mt-2 flex flex-wrap gap-4 text-xs text-ds-ink-muted"><span>▲ laranja: subiu em relação ao mês anterior</span><span>▼ verde: desceu</span><span>cinza: igual</span></p>
  </div>;
}

/** Histórico de taxas: o operador escolhe Barras, Mini gráficos, Mapa de calor ou Curva; a escolha fica neste navegador. */
export function FeeHistoryCharts({ series: raw }: { series: FeeHistorySeries[] }) {
  const series = padHistoryMonths(raw);
  const [view, setView] = useState<View>(readView);
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = series.find(item => item.key === selected) ?? series.find(item => {
    const rates = item.months.map(month => month.rate).filter(value => value !== null);
    return rates.length > 1 && new Set(rates).size > 1;
  }) ?? series[0];
  const change = (next: View) => { setView(next); try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* sem armazenamento */ } };
  if (!series.length) return <p className="px-[18px] pb-4 text-sm text-ds-ink-muted">Ainda não há meses conferidos para o histórico.</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3 px-[18px]">
      <Segmented aria-label="Tipo de gráfico" value={view} onChange={change} options={[{ value: "bars", label: "Barras" }, { value: "minis", label: "Mini gráficos" }, { value: "heat", label: "Mapa de calor" }, { value: "curve", label: "Curva" }]} />
    </div>
    {view === "bars" || view === "curve" ? <>
      <div role="group" aria-label="Grupo de taxa" className="flex flex-wrap gap-2 px-[18px]">{series.map(item => {
        const rates = item.months.map(month => month.rate).filter((value): value is number => value !== null);
        const moved = rates.length > 1 ? rates[rates.length - 1] - rates[0] : 0;
        return <button key={item.key} type="button" aria-pressed={chosen?.key === item.key} onClick={() => setSelected(item.key)}
          className={`h-8 rounded-full border px-3 text-[12.5px] font-bold ${chosen?.key === item.key ? "border-ds-accent bg-ds-accent text-white" : "border-ds-border-input bg-ds-surface text-ds-ink-2 hover:bg-ds-muted"}`}>
          {item.label}{Math.abs(moved) > 1e-9 ? (moved > 0 ? " ▲" : " ▼") : ""}</button>;
      })}</div>
      {chosen ? <MainChart series={chosen} kind={view} /> : null}
    </> : view === "minis" ? <Minis all={series} /> : <Heat all={series} />}
  </div>;
}
