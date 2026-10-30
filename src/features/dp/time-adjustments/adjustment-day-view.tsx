"use client";

import { useMemo } from "react";

import { PanelSection } from "@/components/patterns/side-panel";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { employmentRelationshipLabel } from "@/lib/hr/employment-relationship";
import { cn } from "@/lib/utils";

import {
  formatDuration, formatSignedDuration, pendingOperations, summarizeAdjustmentDay,
  type AdjustmentDayContext, type DayNote, type DayRowAction,
} from "./day-summary";
import { DayLine, LegendItem } from "./day-line";
import type { AdjustmentView } from "./types";

const ROW_ACTION: Record<DayRowAction, { label: string; variant: StatusPillVariant }> = {
  kept: { label: "Mantida", variant: "neutral" },
  discard: { label: "Desconsiderar", variant: "danger" },
  include: { label: "Incluir", variant: "ok" },
  earlier_discarded: { label: "Já desconsiderada", variant: "neutral" },
  earlier_included: { label: "Incluída antes", variant: "neutral" },
};
const NOTE_TONE: Record<DayNote["tone"], string> = { warn: "text-ds-warn", neutral: "text-ds-ink-muted" };

const minutesCell = (value: number | null) => (value === null ? "sem soma" : formatDuration(value));

/**
 * Painel de análise com o dia inteiro: a linha do dia, o resultado antes e depois, todas as batidas e o que o pedido
 * faz com cada uma. Só leitura; a decisão continua no formulário do painel.
 */
export function AdjustmentDayOverview({ adjustment, day }: { adjustment: AdjustmentView; day: AdjustmentDayContext }) {
  const summary = useMemo(() => summarizeAdjustmentDay(day, pendingOperations(adjustment)), [adjustment, day]);
  const { before, after } = summary;
  const tolerance = summary.toleranceMinutes;
  const diffTone = (value: number | null) => (value === null ? "text-ds-ink-muted" : Math.abs(value) > tolerance ? "text-ds-warn" : "text-ds-ink");
  const rows: Array<{ label: string; before: string; after: string; beforeClass?: string; afterClass?: string; muted?: boolean }> = [
    { label: "Horas trabalhadas", before: minutesCell(before.workedMinutes), after: minutesCell(after.workedMinutes) },
    { label: "Escala do dia", before: summary.scheduledMinutes === null ? "—" : formatDuration(summary.scheduledMinutes),
      after: summary.scheduledMinutes === null ? "—" : formatDuration(summary.scheduledMinutes), muted: true },
    { label: "Diferença", before: before.diffMinutes === null ? "—" : formatSignedDuration(before.diffMinutes), beforeClass: diffTone(before.diffMinutes),
      after: after.diffMinutes === null ? "—" : formatSignedDuration(after.diffMinutes), afterClass: diffTone(after.diffMinutes) },
    { label: "Intervalo", before: before.punchCount >= 4 ? formatDuration(before.breakMinutes) : "—", after: after.punchCount >= 4 ? formatDuration(after.breakMinutes) : "—" },
    { label: "Batidas", before: `${before.punchCount} · ${before.punchCount % 2 ? "ímpar" : "par"}`, after: `${after.punchCount} · ${after.punchCount % 2 ? "ímpar" : "par"}` },
  ];
  return (
    <>
      <PanelSection title="O dia em uma linha" aside={summary.shiftText ?? "sem escala neste dia"}>
        <div className="space-y-1">
          {summary.notice ? <p role="status" className="rounded-ds-btn bg-ds-warn-bg px-3 py-2 text-[12.5px] font-semibold text-ds-warn">{summary.notice}</p> : null}
          <DayLine title="Como está" state={before} axis={summary.axis} band={summary.scaleBand} />
          <DayLine title="Se aprovar" state={after} axis={summary.axis} band={summary.scaleBand} />
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 pt-1">
            {summary.scaleBand ? <LegendItem swatch={<span aria-hidden="true" className="h-2.5 w-3.5 rounded-[3px] bg-ds-info-bg" />}>Escala</LegendItem> : null}
            <LegendItem swatch={<span aria-hidden="true" className="h-1.5 w-3.5 rounded-[3px] bg-ds-info" />}>Trabalhado</LegendItem>
            <LegendItem swatch={<span aria-hidden="true" className="h-1.5 w-3.5 rounded-[3px] bg-ds-warn" />}>Fora da escala</LegendItem>
            <LegendItem swatch={<span aria-hidden="true" className="size-2.5 rounded-full border-2 border-ds-info bg-ds-surface" />}>Batida</LegendItem>
            <LegendItem swatch={<span aria-hidden="true" className="h-0 w-3.5 border-t-2 border-dashed border-ds-danger/40" />}>Removida pelo ajuste</LegendItem>
          </div>
        </div>
      </PanelSection>
      <PanelSection title="Resultado do dia" aside={[day.relationship ? employmentRelationshipLabel(day.relationship) : null, tolerance > 0 ? `tolerância da jornada ${tolerance} min` : null].filter(Boolean).join(" · ") || undefined}>
        <div className="text-[13px]">
          <div className="grid grid-cols-[1fr_84px_84px] gap-2 pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">
            <span /> <span className="text-right">Como está</span> <span className="text-right">Se aprovar</span>
          </div>
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[1fr_84px_84px] items-center gap-2 border-t border-ds-divider py-2">
              <span className="text-ds-ink">{row.label}</span>
              <span className={cn("text-right font-ds-mono font-bold", row.muted ? "text-ds-ink-muted" : row.beforeClass ?? "text-ds-ink")}>{row.before}</span>
              <span className={cn("text-right font-ds-mono font-bold", row.muted ? "text-ds-ink-muted" : row.afterClass ?? "text-ds-ink")}>{row.after}</span>
            </div>
          ))}
          <div className="space-y-1.5 border-t border-ds-divider pt-3">
            {([["Como está", before.note], ["Se aprovar", after.note]] as const).map(([label, note]) => (
              <p key={label} className={cn("flex items-start gap-2 text-[12.5px]", NOTE_TONE[note.tone])}>
                <StatusPill variant={note.tone === "warn" ? "warn" : "neutral"} className="h-5 shrink-0">{label}</StatusPill>
                <span className="pt-px">{note.text}</span>
              </p>
            ))}
          </div>
        </div>
      </PanelSection>
      <PanelSection title="Batidas do dia" aside="a original sempre fica guardada">
        <div className="text-[13px]">
          <div className="grid grid-cols-[56px_1fr_132px_118px] gap-2.5 pb-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">
            <span>Hora</span><span>Finalidade</span><span>Origem</span><span className="text-right">No pedido</span>
          </div>
          {summary.rows.map((row) => {
            const action = ROW_ACTION[row.action];
            return (
              <div key={row.key} className={cn("grid grid-cols-[56px_1fr_132px_118px] items-center gap-2.5 border-t border-ds-divider py-2", row.action === "include" && "bg-ds-ok-bg/40")}>
                <span className={cn("font-ds-mono font-bold", row.action === "discard" || row.action === "earlier_discarded" ? "text-ds-danger line-through" : row.action === "include" ? "text-ds-ok" : "text-ds-ink")}>{row.time}</span>
                <span className="text-ds-ink">{row.label ?? "—"}</span>
                <span className="text-[12px] text-ds-ink-muted">{row.origin}</span>
                <span className="text-right"><StatusPill variant={action.variant}>{action.label}</StatusPill></span>
              </div>
            );
          })}
          {summary.rows.length === 0 ? <p className="border-t border-ds-divider pt-2 text-ds-ink-muted">Nenhuma batida registrada no dia.</p> : null}
          {day.truncated ? <p className="border-t border-ds-divider pt-2 text-xs text-ds-warn">A lista do dia foi limitada; confira o espelho para ver tudo.</p> : null}
        </div>
      </PanelSection>
    </>
  );
}
