"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CashFlowStudyPayload } from "./cash-flow-study-view";
import type { HealthMonth, SalesChannel } from "./model";
import { dm, monthName, thousands } from "./study-ui";

type Tone = "ok" | "warn" | "danger" | "neutral";
const TONE_DOT: Record<Tone, string> = { ok: "bg-ds-ok-bg text-ds-ok", warn: "bg-ds-warn-bg text-ds-warn", danger: "bg-ds-danger-bg text-ds-danger", neutral: "bg-ds-muted text-ds-ink-2" };
const COLOR: Record<Tone, string> = { ok: "var(--ds-ok)", warn: "var(--ds-warn)", danger: "var(--ds-danger)", neutral: "var(--ds-ink-2)" };
const pct = (value: number) => `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const signedPct = (value: number) => `${value < 0 ? "−" : "+"}${pct(Math.abs(value))}`;
const weeks = (value: number) => value.toFixed(1).replace(".", ",");
const short = (month: string) => monthName(month).slice(0, 3);
const CHANNEL: Record<SalesChannel, string> = { pix: "Pix", credit_card: "Crédito", debit_card: "Débito", cash: "Espécie" };
const CHANNEL_COLOR: Record<SalesChannel, string> = { pix: "var(--ds-ok)", credit_card: "var(--ds-info)", debit_card: "var(--ds-warn)", cash: "var(--ds-ink-faint)" };
const SETTLEMENT = (days: number) => (days === 0 ? "na hora" : days === 1 ? "1 dia" : `${days} dias`);

function Dot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", TONE_DOT[tone])}><i className="h-[7px] w-[7px] rounded-full bg-current" aria-hidden="true" />{children}</span>;
}

function HealthCard({ kicker, tone, label, wide, children }: { kicker: string; tone: Tone; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <article className={cn("grid content-start gap-2.5 overflow-hidden rounded-[24px] border border-ds-border bg-ds-surface p-5", wide && "lg:col-span-2")}>
      <div className="flex items-center justify-between gap-2.5"><span className="text-[11px] font-bold uppercase tracking-[0.12em] text-ds-ink-faint">{kicker}</span><Dot tone={tone}>{label}</Dot></div>
      {children}
    </article>
  );
}
const Big = ({ children, unit }: { children: ReactNode; unit?: string }) => <p className="font-ds-mono text-[30px] font-bold leading-none tracking-[-0.03em]">{children}{unit ? <small className="ml-1 text-sm font-semibold tracking-normal text-ds-ink-muted">{unit}</small> : null}</p>;
const Insight = ({ children }: { children: ReactNode }) => <p className="text-[13px] leading-[1.45] text-ds-ink-2">{children}</p>;
const NoData = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-ds-muted px-3 py-3 text-[13px] text-ds-ink-muted">{children}</p>;

// ---------- indicadores ----------
function runwayTone(value: number): Tone { return value >= 4 ? "ok" : value >= 2 ? "warn" : "danger"; }

function Gauge({ value, withReserve }: { value: number; withReserve: number | null }) {
  const max = 6;
  const point = (amount: number) => { const angle = Math.PI + Math.min(amount / max, 1) * Math.PI; return [100 + 80 * Math.cos(angle), 100 + 80 * Math.sin(angle)]; };
  const arc = (amount: number) => { const [x1, y1] = point(amount); return `M20,100 A80,80 0 0 1 ${x1},${y1}`; };
  const goal = Math.PI + (4 / max) * Math.PI;
  const color = COLOR[runwayTone(value)];
  return (
    <svg viewBox="0 0 200 118" className="w-full" role="img" aria-label={`Fôlego de ${weeks(value)} semanas`}>
      <defs><pattern id="cash-flow-reserve-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--ds-muted)" /><rect width="2" height="5" fill={color} /></pattern></defs>
      <path d={arc(max)} fill="none" stroke="var(--ds-muted)" strokeWidth="16" strokeLinecap="round" />
      {withReserve !== null && withReserve > value ? <path d={arc(withReserve)} fill="none" stroke="url(#cash-flow-reserve-hatch)" strokeWidth="16" strokeLinecap="round" /> : null}
      <path d={arc(value)} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" />
      <line x1={100 + 66 * Math.cos(goal)} y1={100 + 66 * Math.sin(goal)} x2={100 + 94 * Math.cos(goal)} y2={100 + 94 * Math.sin(goal)} stroke="var(--ds-ok)" strokeWidth="2.5" />
      <text x={100 + 98 * Math.cos(goal) + 4} y={100 + 98 * Math.sin(goal) - 4} fontSize="10" fontWeight="700" fill="var(--ds-ok)">meta 4</text>
      <text x="100" y="92" textAnchor="middle" fontSize="30" fontWeight="700" fill="currentColor" fontFamily="var(--font-mono, monospace)">{weeks(value)}</text>
      <text x="100" y="112" textAnchor="middle" fontSize="10" fill="var(--ds-ink-faint)">semanas</text>
    </svg>
  );
}

function RunwayLine({ points }: { points: Array<{ label: string; value: number }> }) {
  if (points.length < 2) return null;
  const width = 300, height = 96, x = (index: number) => 8 + index * (width - 16) / (points.length - 1), y = (value: number) => 10 + (1 - Math.min(value, 6) / 6) * (height - 28);
  const last = points[points.length - 1];
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Fôlego ao longo dos meses">
      <line x1="0" x2={width} y1={y(4)} y2={y(4)} stroke="var(--ds-ok)" strokeDasharray="4 4" />
      <line x1="0" x2={width} y1={y(2)} y2={y(2)} stroke="var(--ds-danger)" strokeDasharray="4 4" opacity=".6" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      {points.map((point, index) => <circle key={point.label} cx={x(index)} cy={y(point.value)} r={index === points.length - 1 ? 4.5 : 2.5} fill={index === points.length - 1 ? COLOR[runwayTone(last.value)] : "currentColor"} />)}
      {points.map((point, index) => <text key={`t-${point.label}`} x={x(index)} y={height - 3} textAnchor="middle" fontSize="10" fill="var(--ds-ink-faint)">{point.label}</text>)}
    </svg>
  );
}

function SurplusBars({ months }: { months: HealthMonth[] }) {
  const width = 300, height = 110, middle = 54, max = Math.max(...months.map(month => Math.abs(month.inCents - month.outCents)), 1);
  const slot = (width - 20) / months.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Sobra por mês">
      <line x1="0" x2={width} y1={middle} y2={middle} stroke="var(--ds-border)" />
      {months.map((month, index) => {
        const value = month.inCents - month.outCents, barHeight = Math.max(Math.abs(value) / max * 40, 1), left = 10 + index * slot, bar = slot - 10;
        return (
          <g key={month.month}>
            <rect x={left} y={value >= 0 ? middle - barHeight : middle} width={bar} height={barHeight} rx="4" fill={value >= 0 ? "var(--ds-ok)" : "var(--ds-danger)"} />
            <text x={left + bar / 2} y={value >= 0 ? middle - barHeight - 5 : middle + barHeight + 12} textAnchor="middle" fontSize="10" fill="var(--ds-ink-2)" fontWeight="600">{value < 0 ? "−" : "+"}{(Math.abs(value) / 100_000).toFixed(1).replace(".", ",")}</text>
            <text x={left + bar / 2} y={height - 2} textAnchor="middle" fontSize="10" fill="var(--ds-ink-faint)">{short(month.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AccuracyBars({ weeksData }: { weeksData: CashFlowStudyPayload["health"]["accuracy"] }) {
  const width = 300, height = 110, middle = 52, scale = 40 / 0.15, slot = (width - 20) / weeksData.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Desvio da projeção por semana">
      <rect x="0" y={middle - 0.05 * scale} width={width} height={0.1 * scale} fill="var(--ds-ok-bg)" />
      <text x={width} y={middle - 0.05 * scale - 4} textAnchor="end" fontSize="10" fill="var(--ds-ok)">±5%</text>
      <line x1="0" x2={width} y1={middle} y2={middle} stroke="var(--ds-border)" />
      {weeksData.map((week, index) => {
        const deviation = (week.actualCents - week.predictedCents) / week.predictedCents, barHeight = Math.min(Math.abs(deviation) * scale, 46), left = 10 + index * slot, bar = slot - 12;
        const color = Math.abs(deviation) > 0.1 ? "var(--ds-danger)" : Math.abs(deviation) > 0.05 ? "var(--ds-warn)" : "var(--ds-ink-2)";
        return (
          <g key={week.weekStart}>
            <rect x={left} y={deviation >= 0 ? middle - barHeight : middle} width={bar} height={Math.max(barHeight, 1)} rx="3" fill={color} />
            <text x={left + bar / 2} y={height - 2} textAnchor="middle" fontSize="10" fill="var(--ds-ink-faint)">{dm(week.weekStart)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function HealthTab({ data }: { data: CashFlowStudyPayload }) {
  const health = data.health;
  const view = useMemo(() => {
    const full = health.months.filter(month => !month.partial && (month.inCents > 0 || month.outCents > 0));
    const last6 = full.slice(-6);
    const runwayPoints = last6.flatMap(month => month.endBalanceCents !== null && month.outCents > 0 ? [{ label: short(month.month), value: month.endBalanceCents / (month.outCents / (52 / 12)) }] : []);
    if (health.runwayWeeks !== null) runwayPoints.push({ label: "hoje", value: health.runwayWeeks });
    return { last6, runwayPoints };
  }, [health]);

  const runwayTone_ = health.runwayWeeks === null ? "neutral" : runwayTone(health.runwayWeeks);
  const surplusTone: Tone = health.outInRatio === null ? "neutral" : health.outInRatio < 0.9 ? "ok" : health.outInRatio < 1 ? "warn" : "danger";
  const lagTone: Tone = health.cashLagDays === null ? "neutral" : health.cashLagDays <= 14 ? "ok" : health.cashLagDays <= 30 ? "warn" : "danger";
  const accuracyTone: Tone = health.accuracyAvg === null ? "neutral" : Math.abs(health.accuracyAvg) <= 0.05 ? "ok" : "warn";
  const attention = [
    runwayTone_ !== "ok" && runwayTone_ !== "neutral" ? "fôlego" : null, surplusTone !== "ok" && surplusTone !== "neutral" ? "sobra do mês" : null,
    lagTone !== "ok" && lagTone !== "neutral" ? "prazo do espécie" : null, accuracyTone === "warn" ? "acerto da projeção" : null,
  ].filter((item): item is string => Boolean(item));
  const worst = health.accuracy.reduce<{ weekStart: string; deviation: number } | null>((best, week) => {
    const deviation = (week.actualCents - week.predictedCents) / week.predictedCents;
    return !best || Math.abs(deviation) > Math.abs(best.deviation) ? { weekStart: week.weekStart, deviation } : best;
  }, null);
  const slowest = [...health.lagUnits].sort((a, b) => b.avgDays - a.avgDays)[0];
  const negativeMonths = view.last6.filter(month => month.inCents < month.outCents).length;
  const credit = health.payments.find(item => item.channel === "credit_card");
  const creditCost = credit && health.feeRate ? (credit.shareRatio * credit.feeRate) / health.feeRate : null;

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-baseline gap-x-3 text-[15px] text-ds-ink-2">
        <b className="text-[17px] text-ds-ink">{attention.length ? `${attention.length} ${attention.length === 1 ? "ponto pede" : "pontos pedem"} atenção` : "Tudo dentro da meta"}</b>
        <span>{attention.join(", ")}</span>
        <span className="ml-auto text-[12.5px] text-ds-ink-muted">Base: meses fechados e últimas {health.accuracy.length || 8} semanas</span>
      </p>
      <div className="grid gap-3.5 lg:grid-cols-3">
        <HealthCard kicker="Fôlego" tone={runwayTone_} wide label={health.runwayWeeks === null ? "Indisponível" : runwayTone_ === "ok" ? "Confortável" : runwayTone_ === "warn" ? "Atenção" : "Curto"}>
          {health.runwayWeeks === null ? <NoData>Sem saldo ou sem movimentação realizada para calcular quantas semanas o caixa paga.</NoData> : (
            <div className="grid items-center gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
              <Gauge value={health.runwayWeeks} withReserve={health.runwayWithReserveWeeks} />
              <div className="grid gap-2">
                <RunwayLine points={view.runwayPoints} />
                <Insight>O saldo paga <b>{weeks(health.runwayWeeks)} semanas</b> de saídas sem nenhuma entrada.{data.reserveCents > 0 && health.runwayWithReserveWeeks !== null ? <> Com a reserva, <b>{weeks(health.runwayWithReserveWeeks)}</b>.</> : null} A meta é 4 semanas; abaixo de 2 é alerta.</Insight>
              </div>
            </div>
          )}
        </HealthCard>

        <HealthCard kicker="Sobra do mês" tone={surplusTone} label={health.outInRatio === null ? "Indisponível" : surplusTone === "ok" ? "Saudável" : surplusTone === "warn" ? "Apertada" : "Negativa"}>
          {health.surplusCents === null ? <NoData>Ainda não há meses fechados com movimentação.</NoData> : (
            <>
              <Big unit="/mês">{health.surplusCents < 0 ? "−" : "+"}{thousands(Math.abs(health.surplusCents))}</Big>
              <SurplusBars months={view.last6} />
              <Insight>Sai <b>{pct(health.outInRatio ?? 0)}</b> do que entra{negativeMonths ? <>. Em <b>{negativeMonths}</b> dos {view.last6.length} meses o caixa encolheu.</> : "."} Transferências entre contas não entram na conta.</Insight>
            </>
          )}
        </HealthCard>

        <HealthCard kicker="Espécie até o banco" tone={lagTone} label={health.cashLagDays === null ? "Sem histórico" : lagTone === "ok" ? "Bom" : lagTone === "warn" ? "Lento" : "Muito lento"}>
          {health.cashLagDays === null ? <NoData>Ainda não há lotes pagos suficientes para medir o prazo.</NoData> : (
            <>
              <Big unit="dias · meta 14">{health.cashLagDays}</Big>
              <div className="grid gap-3 py-1.5">
                {health.lagUnits.map(unit => {
                  const color = COLOR[unit.avgDays > 30 ? "danger" : unit.avgDays > 14 ? "warn" : "ok"];
                  return (
                    <div key={unit.kioskId} className="grid grid-cols-[84px_minmax(0,1fr)_44px] items-center gap-2.5 text-[12.5px]">
                      <b className="truncate">{unit.kioskName.replace(/^Quiosque /, "")}</b>
                      <span className="relative h-1.5 rounded-[3px] bg-ds-muted" title={`${unit.paidBatches} lotes pagos · o mais lento levou ${unit.maxDays} dias`}>
                        <span className="absolute inset-y-0 left-0 rounded-[3px] opacity-40" style={{ width: `${Math.min(unit.avgDays / 40, 1) * 100}%`, background: color }} />
                        <span className="absolute -inset-y-[5px] w-0.5 bg-ds-ok" style={{ left: `${14 / 40 * 100}%` }} />
                        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-ds-surface" style={{ left: `${Math.min(unit.avgDays / 40, 1) * 100}%`, background: color }} />
                      </span>
                      <span className="text-right font-ds-mono font-bold" style={{ color }}>{unit.avgDays} d</span>
                    </div>
                  );
                })}
              </div>
              {slowest && slowest.avgDays > 14 ? <Insight><b>{slowest.kioskName.replace(/^Quiosque /, "")}</b> leva {slowest.avgDays} dias. Veja onde trava na aba Entradas.</Insight> : <Insight>Todos dentro da meta de 14 dias.</Insight>}
            </>
          )}
        </HealthCard>

        <HealthCard kicker="Acerto da projeção" tone={accuracyTone} label={health.accuracyAvg === null ? "Sem histórico" : accuracyTone === "ok" ? "Confiável" : "Desvia"}>
          {health.accuracyAvg === null ? <NoData>Precisa de pelo menos 4 semanas de vendas antes de cada semana comparada.</NoData> : (
            <>
              <Big unit={`em ${health.accuracy.length} semanas`}>{signedPct(health.accuracyAvg)}</Big>
              <AccuracyBars weeksData={health.accuracy} />
              <Insight>{health.accuracyAvg < 0 ? "A média previu a mais do que entrou." : "A média previu a menos do que entrou."}{worst ? <> Pior semana: <b>{dm(worst.weekStart)}, {signedPct(worst.deviation)}</b>.</> : null} Compara a média de 90 dias com as vendas reais de cada semana.</Insight>
            </>
          )}
        </HealthCard>

        <HealthCard kicker="Custo de receber" tone="neutral" label="Informativo">
          {health.feeRate === null ? <NoData>Sem vendas nos últimos 90 dias.</NoData> : (
            <>
              <Big unit="das vendas">{pct(health.feeRate)}</Big>
              <div className="flex h-[34px] gap-0.5 overflow-hidden rounded-[10px]" role="img" aria-label="Participação de cada forma de pagamento">
                {health.payments.filter(item => item.shareRatio > 0).map(item => <span key={item.channel} className="grid min-w-0 place-items-center text-[11.5px] font-bold text-ds-surface" style={{ flex: `${item.shareRatio} 1 0`, background: CHANNEL_COLOR[item.channel] }}>{Math.round(item.shareRatio * 100)}%</span>)}
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-[11.5px] text-ds-ink-muted">
                {health.payments.map(item => <span key={item.channel}><i className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: CHANNEL_COLOR[item.channel] }} />{CHANNEL[item.channel]}<b className="block font-ds-mono text-[12.5px] text-ds-ink">{item.feeRate ? pct(item.feeRate) : "sem taxa"}</b>{SETTLEMENT(item.settlementDays)}</span>)}
              </div>
              {credit && creditCost !== null ? <Insight>O <b>crédito</b> é {Math.round(credit.shareRatio * 100)}% das vendas, {Math.round(creditCost * 100)}% do custo de taxas e leva {credit.settlementDays} dias.</Insight> : null}
            </>
          )}
        </HealthCard>
      </div>
    </div>
  );
}
