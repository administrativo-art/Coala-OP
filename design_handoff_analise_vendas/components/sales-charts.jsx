// Lightweight SVG charts for Coala · Análise de vendas.
// No chart library — hand-built SVG to match the clean prototype aesthetic.

const { useState: useChState, useMemo: useChMemo } = React;

// ── shared axis helpers ──────────────────────────────────────────────────────
function niceMax(v) {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

// ── Composed bar + average line (Comparativo Diário) ─────────────────────────
function DailyComposedChart({ data, height = 200 }) {
  const W = 880, H = height, padL = 40, padR = 12, padT = 12, padB = 34;
  const max = niceMax(Math.max(...data.map((d) => d.units), 1));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const bw = Math.min(26, (innerW / n) * 0.62);
  const x = (i) => padL + (innerW / n) * (i + 0.5);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = 4;

  const avgVal = data[0]?.avg ?? 0;
  const labelEvery = Math.ceil(n / 14);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * i;
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeDasharray="3 3" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#a1a1aa">{Math.round(v).toLocaleString('pt-BR')}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const fill = d.isToday ? '#6366F1' : d.isBest ? '#10B981' : d.isWorst ? '#EF4444' : 'var(--accent)';
        const h = Math.max(0, innerH - (y(d.units) - padT));
        return (
          <g key={i}>
            <rect x={x(i) - bw / 2} y={y(d.units)} width={bw} height={h} rx="3" fill={fill} opacity={d.isToday ? 0.55 : 1}>
              <title>{`${d.label}: ${d.units.toLocaleString('pt-BR')} un`}</title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize="8.5" fill="#a1a1aa">{d.label.split(' ')[0]}</text>
            )}
          </g>
        );
      })}
      {/* avg dashed line */}
      <line x1={padL} x2={W - padR} y1={y(avgVal)} y2={y(avgVal)} stroke="#6366F1" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.8" />
      <text x={W - padR} y={y(avgVal) - 4} textAnchor="end" fontSize="9" fill="#6366F1" fontWeight="600">média {Math.round(avgVal).toLocaleString('pt-BR')}</text>
    </svg>
  );
}

// ── Hourly bar chart (Fluxo por Horário), clickable ──────────────────────────
function HourlyBarChart({ data, valueKey = 'displayValue', selectedHour, onPick, height = 220 }) {
  const W = 880, H = height, padL = 34, padR = 10, padT = 12, padB = 26;
  const vals = data.map((d) => d[valueKey] || 0);
  const max = niceMax(Math.max(...vals, 1));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = data.length;
  const slot = innerW / n;
  const bw = slot * 0.62;
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = 4;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * i;
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeDasharray="3 3" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#a1a1aa">{Math.round(v)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const v = d[valueKey] || 0;
        const cx = padL + slot * i + slot / 2;
        const h = Math.max(0, innerH - (y(v) - padT));
        const active = selectedHour === d.hourStr;
        return (
          <g key={i} style={{ cursor: v > 0 ? 'pointer' : 'default' }} onClick={() => v > 0 && onPick && onPick(d.hourStr)}>
            <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill={active ? 'rgba(99,102,241,.08)' : 'transparent'} />
            <rect x={cx - bw / 2} y={y(v)} width={bw} height={h} rx="3" fill="var(--accent)" opacity={active ? 1 : 0.85}>
              <title>{`${d.hour}: ${v.toLocaleString('pt-BR')}`}</title>
            </rect>
            <text x={cx} y={H - padB + 13} textAnchor="middle" fontSize="8" fill="#a1a1aa">{d.hourStr}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Pie / donut (Mix por Linha) ──────────────────────────────────────────────
function MixPieChart({ data, colors, size = 240 }) {
  const total = data.reduce((s, d) => s + d.quantity, 0) || 1;
  const cx = size / 2, cy = size / 2, r = size * 0.42, ri = size * 0.0;
  let angle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.quantity / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const mid = (a0 + a1) / 2;
    const lx = cx + (r + 14) * Math.cos(mid), ly = cy + (r + 14) * Math.sin(mid);
    return { d, i, path: `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`, frac, lx, ly, mid, color: colors[i % colors.length] };
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto" style={{ width: size, height: size, overflow: 'visible' }}>
      {slices.map((s) => (
        <path key={s.i} d={s.path} fill={s.color} stroke="#fff" strokeWidth="2">
          <title>{`${s.d.name}: ${s.d.quantity.toLocaleString('pt-BR')} (${(s.frac * 100).toFixed(0)}%)`}</title>
        </path>
      ))}
      {slices.filter((s) => s.frac > 0.05).map((s) => (
        <text key={'l' + s.i} x={s.lx} y={s.ly} textAnchor={Math.cos(s.mid) >= 0 ? 'start' : 'end'} fontSize="9.5" fontWeight="600" fill="#52525b">
          {(s.frac * 100).toFixed(0)}%
        </text>
      ))}
    </svg>
  );
}

// ── Grouped bar chart (Evolução Top 5) ───────────────────────────────────────
function EvolutionChart({ rows, months, monthLabels, colors, height = 320 }) {
  const W = 880, H = height, padL = 40, padR = 12, padT = 12, padB = 64;
  const seriesKeys = months.map((m) => monthLabels[m - 1]);
  const allVals = rows.flatMap((r) => seriesKeys.map((k) => r[k] || 0));
  const max = niceMax(Math.max(...allVals, 1));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = rows.length;
  const groupW = innerW / n;
  const bw = Math.min(28, (groupW * 0.7) / seriesKeys.length);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const ticks = 4;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const v = (max / ticks) * i;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeDasharray="3 3" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#a1a1aa">{Math.round(v).toLocaleString('pt-BR')}</text>
            </g>
          );
        })}
        {rows.map((r, gi) => {
          const gx = padL + groupW * gi + groupW / 2;
          const totalBarsW = bw * seriesKeys.length + 4 * (seriesKeys.length - 1);
          return (
            <g key={gi}>
              {seriesKeys.map((k, si) => {
                const v = r[k] || 0;
                const bx = gx - totalBarsW / 2 + si * (bw + 4);
                const h = Math.max(0, innerH - (y(v) - padT));
                return (
                  <rect key={si} x={bx} y={y(v)} width={bw} height={h} rx="3" fill={colors[si % colors.length]}>
                    <title>{`${r.product} · ${k}: ${v.toLocaleString('pt-BR')}`}</title>
                  </rect>
                );
              })}
              <text x={gx} y={H - padB + 16} textAnchor="middle" fontSize="9" fill="#71717a">
                {r.product.length > 16 ? r.product.slice(0, 15) + '…' : r.product}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-4 mt-1">
        {seriesKeys.map((k, si) => (
          <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[si % colors.length] }}></span>{k}
          </span>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DailyComposedChart, HourlyBarChart, MixPieChart, EvolutionChart, MonthHistoryChart });

// ── Monthly history bars with value labels + two-tone (Comparativo qtde) ─────
function MonthHistoryChart({ bars, height = 180 }) {
  const W = 420, H = height, padL = 30, padR = 8, padT = 24, padB = 24;
  const max = niceMax(Math.max(...bars.map((b) => b.qty), 1));
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = bars.length || 1;
  const slot = innerW / n;
  const bw = Math.min(46, slot * 0.5);
  const y = (v) => padT + innerH - (v / max) * innerH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {[0, 1, 2].map((i) => {
        const v = (max / 2) * i;
        return <line key={i} x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e4e4e7" strokeDasharray="3 3" />;
      })}
      {bars.map((b, i) => {
        const cx = padL + slot * i + slot / 2;
        const h = Math.max(0, innerH - (y(b.qty) - padT));
        const color = b.isLastYear ? '#6366F1' : '#E91E8C';
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={y(b.qty)} width={bw} height={h} rx="3" fill={color}>
              <title>{`${b.label}: ${b.qty.toLocaleString('pt-BR')} unidades`}</title>
            </rect>
            {b.qty > 0 && <text x={cx} y={y(b.qty) - 5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#52525b">{b.qty.toLocaleString('pt-BR')}</text>}
            <text x={cx} y={H - padB + 14} textAnchor="middle" fontSize="9" fill="#a1a1aa">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
