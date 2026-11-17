"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart,
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency as currency } from "@/features/financial/lib/utils";
import type { DreChartMonth, DreChartUnit, DreComparisonRow, DreWaterfallStep, dreBreakEvenSeries } from "@/features/financial/dre/dre-chart-data";
import { cn } from "@/lib/utils";

export const DRE_CHART_OPTIONS = [
  { value: "evolution", label: "Evolução do resultado", description: "Receita, CMV, despesas fixas e lucro líquido mês a mês" },
  { value: "waterfall", label: "Cascata do mês", description: "Da receita bruta ao lucro líquido, linha a linha" },
  { value: "revenue-margin", label: "Receita e margem líquida", description: "Receita líquida em barras e margem líquida (%) em linha" },
  { value: "cmv-percent", label: "CMV % mês a mês", description: "CMV sobre a receita líquida, com a média do período como referência" },
  { value: "units", label: "Resultado por quiosque", description: "Receita, CMV e lucro de cada unidade no mês" },
  { value: "expense-plans", label: "Maiores despesas", description: "Planos de conta com mais despesa no mês" },
  { value: "cmv-criteria", label: "CMV: composição × movimentação", description: "Os dois critérios lado a lado; a diferença aponta perda ou consumo sem registro" },
  { value: "break-even", label: "Ponto de equilíbrio no mês", description: "Margem de contribuição acumulada contra o custo fixo" },
  { value: "unit-margin", label: "Margem por quiosque", description: "Receita × margem de contribuição; o tamanho é o faturamento" },
  { value: "comparison", label: "Mês atual × anterior", description: "Variação percentual de cada linha da DRE" },
  { value: "daily-heatmap", label: "Venda diária por quiosque", description: "Mapa de calor dos dias do mês; cinza é dia sem venda" },
] as const;

export type DreChartKind = (typeof DRE_CHART_OPTIONS)[number]["value"];
const STORAGE_KEY = "coala:dre:chart";

const thousands = (value: number) => `R$ ${Math.round(value / 1000)}k`;
const percent = (value: number) => `${value.toFixed(1).replace(".", ",")}%`;
const axis = { tickLine: false, axisLine: false, tick: { fontSize: 12, fill: "var(--ds-ink-muted)" } } as const;
const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />;
const money = (value: unknown) => (typeof value === "number" ? currency(value) : String(value ?? "—"));

function Empty({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center rounded-ds-md border border-dashed border-ds-border-input bg-ds-input p-4 text-center text-[13px] text-ds-ink-muted">{children}</div>;
}

export type DreChartExplorerProps = {
  loading: boolean;
  unitLabel: string;
  monthLabel: string;
  previousMonthLabel: string | null;
  cmvLabel: string;
  allUnits: boolean;
  months: DreChartMonth[];
  waterfall: DreWaterfallStep[] | null;
  units: DreChartUnit[];
  expensePlans: Array<{ name: string; value: number }>;
  breakEven: ReturnType<typeof dreBreakEvenSeries>;
  comparison: DreComparisonRow[] | null;
  daily: { days: number; units: Array<{ kioskId: string; name: string; values: number[] }> } | null;
};

export function DreChartExplorer(props: DreChartExplorerProps) {
  const [kind, setKind] = useState<DreChartKind>("evolution");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && DRE_CHART_OPTIONS.some((option) => option.value === saved)) setKind(saved as DreChartKind);
    } catch { /* preferência local opcional */ }
  }, []);
  function choose(value: string) {
    setKind(value as DreChartKind);
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* preferência local opcional */ }
  }
  const option = DRE_CHART_OPTIONS.find((item) => item.value === kind) ?? DRE_CHART_OPTIONS[0];

  return (
    <section className="rounded-ds-card border border-ds-border bg-ds-surface p-5" aria-labelledby="dre-chart-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dre-chart-title" className="text-[15px] font-extrabold">{option.label}</h2>
          <p className="text-[12.5px] text-ds-ink-muted">{option.description} · {props.unitLabel}</p>
        </div>
        <Select value={kind} onValueChange={choose}>
          <SelectTrigger className="h-9 w-auto min-w-56 text-[13px] font-bold" aria-label="Gráfico"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DRE_CHART_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 h-[320px]">
        {props.loading ? <Skeleton className="h-full w-full" /> : <DreChart kind={kind} {...props} />}
      </div>
    </section>
  );
}

function DreChart({ kind, ...p }: DreChartExplorerProps & { kind: DreChartKind }) {
  switch (kind) {
    case "evolution":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={p.months}>
            {grid}
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={thousands} width={64} />
            <Tooltip formatter={money} />
            <Legend />
            <Area type="monotone" dataKey="revBruta" name="Receita bruta" stroke="var(--ds-ink-muted)" fill="var(--ds-ink-muted)" fillOpacity={0.08} connectNulls />
            <Area type="monotone" dataKey="cmv" name={p.cmvLabel} stroke="var(--ds-ink)" fill="var(--ds-ink)" fillOpacity={0.06} connectNulls />
            <Area type="monotone" dataKey="totalFixos" name="Despesas fixas" stroke="var(--ds-accent-ink)" fill="var(--ds-accent-ink)" fillOpacity={0.06} />
            <Area type="monotone" dataKey="lucroLiq" name="Lucro líquido" stroke="var(--ds-accent)" fill="var(--ds-accent)" fillOpacity={0.14} strokeWidth={2.5} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      );

    case "waterfall":
      if (!p.waterfall) return <Empty>A cascata aparece quando receita, CMV e despesas do mês estiverem apurados.</Empty>;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={p.waterfall} margin={{ top: 22 }}>
            {grid}
            <XAxis dataKey="label" {...axis} interval={0} tick={{ fontSize: 11, fill: "var(--ds-ink-muted)" }} />
            <YAxis {...axis} tickFormatter={thousands} width={64} />
            <Tooltip formatter={(_, __, item) => currency((item.payload as DreWaterfallStep).value)} />
            <Bar dataKey="range" name="Valor" radius={4}>
              {p.waterfall.map((step) => (
                <Cell key={step.label} fill={step.kind === "total" ? (step.label === "Receita bruta" ? "var(--ds-ink)" : step.value >= 0 ? "var(--ds-ok)" : "var(--ds-danger)") : step.value < 0 ? "var(--ds-accent)" : "var(--ds-ok)"} />
              ))}
              <LabelList dataKey="value" position="top" formatter={(value: number) => thousands(value)} style={{ fontSize: 11, fill: "var(--ds-ink)", fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );

    case "revenue-margin": {
      const data = p.months.map((month) => ({
        label: month.label,
        recLiq: month.recLiq,
        margin: month.recLiq && month.lucroLiq !== null ? (month.lucroLiq / month.recLiq) * 100 : null,
      }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            {grid}
            <XAxis dataKey="label" {...axis} />
            <YAxis yAxisId="money" {...axis} tickFormatter={thousands} width={64} />
            <YAxis yAxisId="pct" orientation="right" {...axis} tickFormatter={(value) => `${value}%`} width={44} />
            <Tooltip formatter={(value: number, name: string) => (name.includes("%") ? percent(value) : currency(value))} />
            <Legend />
            <Bar yAxisId="money" dataKey="recLiq" name="Receita líquida" fill="var(--ds-ink-faint)" radius={4} />
            <Line yAxisId="pct" dataKey="margin" name="Margem líquida %" stroke="var(--ds-accent)" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    case "cmv-percent": {
      const data = p.months.map((month) => ({
        label: month.label,
        value: month.recLiq && month.cmv !== null ? (month.cmv / month.recLiq) * 100 : null,
      }));
      const valid = data.flatMap((row) => (row.value === null ? [] : [row.value]));
      if (!valid.length) return <Empty>Sem CMV e receita apurados no período.</Empty>;
      const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 22 }}>
            {grid}
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={(value) => `${value}%`} width={48} domain={["auto", "auto"]} />
            <Tooltip formatter={(value: number) => percent(value)} />
            <ReferenceLine y={average} stroke="var(--ds-ink-faint)" strokeDasharray="5 4" label={{ value: `média ${percent(average)}`, position: "insideTopRight", fontSize: 11, fill: "var(--ds-ink-muted)" }} />
            <Line dataKey="value" name={`${p.cmvLabel} %`} stroke="var(--ds-ink)" strokeWidth={2.5} connectNulls
              dot={(dot: { cx?: number; cy?: number; payload?: { value: number | null }; index?: number }) => (
                <circle key={dot.index} cx={dot.cx} cy={dot.cy} r={5} fill={(dot.payload?.value ?? 0) > average ? "var(--ds-danger)" : "var(--ds-ok)"} />
              )}>
              <LabelList dataKey="value" position="top" formatter={(value: number) => percent(value)} style={{ fontSize: 11, fill: "var(--ds-ink)", fontWeight: 700 }} />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      );
    }

    case "units":
      if (!p.allUnits) return <Empty>Escolha “Todas as unidades” para comparar os quiosques.</Empty>;
      if (!p.units.length) return <Empty>Nenhuma unidade com venda no mês.</Empty>;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={p.units}>
            {grid}
            <XAxis dataKey="name" {...axis} interval={0} />
            <YAxis {...axis} tickFormatter={thousands} width={64} />
            <Tooltip formatter={money} />
            <Legend />
            <ReferenceLine y={0} stroke="var(--ds-border-input)" />
            <Bar dataKey="revenue" name="Receita líquida" fill="var(--ds-ink)" radius={3} />
            <Bar dataKey="cmv" name={p.cmvLabel} fill="var(--ds-ink-faint)" radius={3} />
            <Bar dataKey="lucro" name="Lucro (despesas alocadas)" radius={3}>
              {p.units.map((unit) => <Cell key={unit.kioskId} fill={(unit.lucro ?? 0) >= 0 ? "var(--ds-ok)" : "var(--ds-danger)"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );

    case "expense-plans":
      if (!p.expensePlans.length) return <Empty>Nenhuma despesa no mês.</Empty>;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={p.expensePlans} layout="vertical" margin={{ right: 96 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" {...axis} width={160} />
            <Tooltip formatter={money} />
            <Bar dataKey="value" name="Despesa" radius={3}>
              {p.expensePlans.map((row, index) => <Cell key={row.name} fill={index === 0 ? "var(--ds-accent-ink)" : "var(--ds-accent)"} />)}
              <LabelList dataKey="value" position="right" formatter={(value: number) => currency(value)} style={{ fontSize: 11, fill: "var(--ds-ink)", fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );

    case "cmv-criteria":
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={p.months}>
            {grid}
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={thousands} width={64} />
            <Tooltip formatter={money} />
            <Legend />
            <Bar dataKey="cmvComposition" name="Composição (fichas técnicas)" fill="var(--ds-ink-faint)" radius={3} />
            <Bar dataKey="cmvStock" name="Movimentação (estoque)" fill="var(--ds-accent)" radius={3} />
          </BarChart>
        </ResponsiveContainer>
      );

    case "break-even":
      if (!p.breakEven) return <Empty>O ponto de equilíbrio precisa da margem de contribuição e da venda diária do mês.</Empty>;
      return (
        <div className="flex h-full flex-col">
          <p className={cn("text-[13px] font-bold", p.breakEven.breakEvenDay ? "text-ds-ok" : "text-ds-danger")}>
            {p.breakEven.breakEvenDay ? `O mês cobriu o custo fixo no dia ${p.breakEven.breakEvenDay}.` : "A margem do mês não cobriu o custo fixo."}
          </p>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={p.breakEven.days}>
                {grid}
                <XAxis dataKey="day" {...axis} />
                <YAxis {...axis} tickFormatter={thousands} width={64} />
                <Tooltip formatter={money} labelFormatter={(day) => `Dia ${day}`} />
                <Legend />
                <Area type="monotone" dataKey="margin" name="Margem de contribuição acumulada" stroke="var(--ds-accent)" fill="var(--ds-accent)" fillOpacity={0.14} strokeWidth={2.5} />
                <Line dataKey="fixed" name="Custo fixo do mês" stroke="var(--ds-ink)" strokeDasharray="5 4" dot={false} />
                {p.breakEven.breakEvenDay ? <ReferenceLine x={p.breakEven.breakEvenDay} stroke="var(--ds-ok)" /> : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11.5px] text-ds-ink-muted">A margem do mês é distribuída pelo ritmo da venda diária dos relatórios do PDV.</p>
        </div>
      );

    case "unit-margin": {
      if (!p.allUnits) return <Empty>Escolha “Todas as unidades” para comparar os quiosques.</Empty>;
      const data = p.units.flatMap((unit) => (unit.revenue && unit.margContr !== null
        ? [{ name: unit.name, revenue: unit.revenue, margin: (unit.margContr / unit.revenue) * 100 }]
        : []));
      if (!data.length) return <Empty>Nenhuma unidade com margem apurada no mês.</Empty>;
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 28, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis type="number" dataKey="revenue" name="Receita líquida" {...axis} tickFormatter={thousands} />
            <YAxis type="number" dataKey="margin" name="Margem de contribuição" {...axis} tickFormatter={(value) => `${Math.round(value)}%`} width={48} domain={["auto", "auto"]} />
            <ZAxis type="number" dataKey="revenue" range={[160, 900]} />
            <Tooltip formatter={(value: number, name: string) => (name.startsWith("Margem") ? percent(value) : currency(value))} />
            <Scatter data={data} fill="var(--ds-accent)" fillOpacity={0.75}>
              <LabelList dataKey="name" position="top" offset={14} style={{ fontSize: 11, fill: "var(--ds-ink)", fontWeight: 700 }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      );
    }

    case "comparison": {
      if (!p.comparison || !p.previousMonthLabel) return <Empty>Não há mês anterior na DRE para comparar.</Empty>;
      const rows = p.comparison.filter((row) => row.changePct !== null);
      if (!rows.length) return <Empty>Sem valores apurados nos dois meses para comparar.</Empty>;
      return (
        <div className="flex h-full flex-col">
          <p className="text-[12.5px] text-ds-ink-muted">{p.monthLabel} contra {p.previousMonthLabel}. Verde é favorável; para custos, subir é desfavorável.</p>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 56 }}>
                <XAxis type="number" {...axis} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="label" {...axis} width={120} />
                <ReferenceLine x={0} stroke="var(--ds-border-input)" />
                <Tooltip formatter={(value: number) => percent(value)} />
                <Bar dataKey="changePct" name="Variação" radius={3}>
                  {rows.map((row) => <Cell key={row.label} fill={row.favorable === false ? "var(--ds-danger)" : row.favorable ? "var(--ds-ok)" : "var(--ds-ink-faint)"} />)}
                  <LabelList dataKey="changePct" position="right" formatter={(value: number) => `${value > 0 ? "+" : ""}${percent(value)}`} style={{ fontSize: 11, fill: "var(--ds-ink)", fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }

    case "daily-heatmap": {
      if (!p.daily || !p.daily.units.length) return <Empty>Sem venda diária registrada no mês.</Empty>;
      const max = Math.max(...p.daily.units.flatMap((unit) => unit.values), 1);
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 overflow-x-auto">
          {p.daily.units.map((unit) => (
            <div key={unit.kioskId} className="grid min-w-[620px] grid-cols-[130px_minmax(0,1fr)] items-center gap-2">
              <span className="truncate text-[12.5px] font-semibold">{unit.name}</span>
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${p.daily!.days}, minmax(0, 1fr))` }}>
                {unit.values.map((value, index) => (
                  <span
                    key={index}
                    title={`${unit.name} · dia ${index + 1}: ${currency(value)}`}
                    className={cn("h-7 rounded-[3px]", value > 0 ? "bg-ds-accent" : "bg-ds-muted")}
                    style={value > 0 ? { opacity: 0.18 + (value / max) * 0.82 } : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="grid min-w-[620px] grid-cols-[130px_minmax(0,1fr)] gap-2 text-[11px] text-ds-ink-muted">
            <span />
            <div className="flex justify-between"><span>1</span><span>{Math.ceil(p.daily.days / 2)}</span><span>{p.daily.days}</span></div>
          </div>
        </div>
      );
    }
  }
}
