"use client";

import { cn } from "@/lib/utils";

import type { AdjustmentDaySummary, DayMarker, DayState } from "./day-summary";

type Axis = { start: number; end: number };

/** Faixa noturna (22h–5h) em minutos desde 00:00 do dia do ponto, cortada ao eixo. */
function nightRanges(axis: Axis) {
  const ranges: Array<[number, number]> = [];
  for (let day = -1440; day <= axis.end; day += 1440) {
    const start = Math.max(day + 22 * 60, axis.start);
    const end = Math.min(day + 29 * 60, axis.end);
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

function MarkerDot({ marker, axis }: { marker: DayMarker; axis: Axis }) {
  const left = `${(((marker.minute - axis.start) / (axis.end - axis.start)) * 100).toFixed(2)}%`;
  const color = marker.state === "removed" ? "border-2 border-dashed border-ds-danger"
    : marker.state === "included" ? "border-[3px] border-ds-ok"
      : marker.outside ? "border-[3px] border-ds-warn" : "border-[3px] border-ds-info";
  return <span aria-hidden="true" style={{ left }} className={cn("absolute top-[42px] size-3.5 -translate-x-1/2 rounded-full bg-ds-surface", color)} />;
}

function MarkerLabel({ marker, axis }: { marker: DayMarker; axis: Axis }) {
  const left = `${(((marker.minute - axis.start) / (axis.end - axis.start)) * 100).toFixed(2)}%`;
  const tone = marker.state === "removed" ? "text-ds-danger line-through" : marker.state === "included" ? "text-ds-ok" : marker.outside ? "text-ds-warn" : "text-ds-ink";
  return (
    <span style={{ left }} className={cn("absolute -translate-x-1/2 whitespace-nowrap text-center leading-tight", marker.side === "above" ? "top-0.5" : "top-[62px]")}>
      <b className={cn("block font-ds-mono text-[12px] font-bold", tone)}>{marker.time}</b>
      {marker.label ? <i className="text-[10.5px] not-italic text-ds-ink-muted">{marker.label}</i> : null}
    </span>
  );
}

/**
 * Uma linha do dia: batidas como pontos, trechos trabalhados em azul e o que passa da escala em laranja.
 * Usada no pedido de ajuste ("como está" / "se aprovar") e no painel do dia do registro de ponto.
 * `openUntil` desenha o período aberto (batida ímpar) até ali; `now` marca o agora; `night` mostra a faixa noturna.
 */
export function DayLine({ title, state, axis, band, openUntil = null, now = null, night = false }: {
  title?: string; state: Pick<DayState, "markers" | "segments" | "ghostSegments">; axis: Axis; band: AdjustmentDaySummary["scaleBand"];
  openUntil?: number | null; now?: number | null; night?: boolean;
}) {
  const span = axis.end - axis.start;
  const at = (minute: number) => `${(((Math.min(Math.max(minute, axis.start), axis.end) - axis.start) / span) * 100).toFixed(2)}%`;
  const width = (start: number, end: number) => `${(((Math.min(end, axis.end) - Math.max(start, axis.start)) / span) * 100).toFixed(2)}%`;
  const kept = state.markers.filter((marker) => marker.state !== "removed");
  const lastKept = kept.at(-1);
  const description = `${title ? `${title}: ` : ""}${state.markers.map((marker) => `${marker.time}${marker.state === "removed" ? " desconsiderada" : marker.state === "included" ? " incluída" : ""}`).join(", ") || "sem batidas"}`;
  return (
    <div>
      {title ? <p className="text-[12px] font-extrabold text-ds-ink-2">{title}</p> : null}
      <div role="img" aria-label={description} className="relative h-24">
        {night ? nightRanges(axis).map(([start, end]) => (
          <span key={`n${start}`} aria-hidden="true" title="Faixa noturna" style={{ left: at(start), width: width(start, end) }}
            className="absolute top-[38px] h-6 rounded-[4px] bg-ds-neutral-bg" />
        )) : null}
        <span aria-hidden="true" className="absolute inset-x-0 top-12 h-0.5 bg-ds-divider" />
        {band ? (
          <span aria-hidden="true" style={{ left: at(band.start), width: width(band.start, band.end) }}
            className="absolute top-[43px] h-3.5 rounded-[4px] bg-ds-info-bg" />
        ) : null}
        {band && band.breakStart !== null && band.breakEnd !== null ? (
          <span aria-hidden="true" title="Intervalo previsto" style={{ left: at(band.breakStart), width: width(band.breakStart, band.breakEnd) }}
            className="absolute top-[43px] h-3.5 bg-ds-neutral-bg [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgb(0_0_0/0.08)_3px_6px)]" />
        ) : null}
        {state.ghostSegments.map((segment) => (
          <span key={`g${segment.start}`} aria-hidden="true" style={{ left: at(segment.start), width: width(segment.start, segment.end) }}
            className="absolute top-[49px] h-0 border-t-2 border-dashed border-ds-danger/40" />
        ))}
        {state.segments.map((segment) => (
          <span key={`s${segment.start}`} style={{ left: at(segment.start), width: width(segment.start, segment.end) }}
            title={segment.outside ? "Trabalhado fora da escala" : "Trabalhado"}
            className={cn("absolute top-[46px] h-1.5 rounded-[3px]", segment.outside ? "bg-ds-warn" : "bg-ds-info")} />
        ))}
        {openUntil !== null && lastKept && kept.length % 2 === 1 && openUntil > lastKept.minute ? (
          <span aria-hidden="true" title="Período aberto" style={{ left: at(lastKept.minute), width: width(lastKept.minute, openUntil) }}
            className="absolute top-[47px] h-0 border-t-[3px] border-dashed border-ds-info/60" />
        ) : null}
        {now !== null ? <span aria-hidden="true" title="Agora" style={{ left: at(now) }} className="absolute top-[36px] h-[26px] w-0.5 -translate-x-1/2 rounded-full bg-ds-accent" /> : null}
        {state.markers.map((marker) => <MarkerDot key={`d${marker.key}`} marker={marker} axis={axis} />)}
        {state.markers.map((marker) => <MarkerLabel key={`l${marker.key}`} marker={marker} axis={axis} />)}
      </div>
    </div>
  );
}

export function LegendItem({ children, swatch }: { children: string; swatch: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-ds-ink-2">{swatch}{children}</span>;
}
