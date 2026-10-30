"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import { formatOfficialClock, officialClockOffsetMs } from "./official-clock";
import type { RepPLocationCaptureState, RepPLocationPolicyForCollector, RepPMarkingPayload,
  RepPOfficialClock, RepPReceiptStatus } from "./use-rep-p-marking";

/** Entrega o arquivo ao navegador como download, sem abrir outra aba. */
export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function brDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
/** O instante fiscal já vem no fuso do estabelecimento (AAAA-MM-DDThh:mm:00±hhmm). */
export function fiscalTime(markedAt: string) {
  return markedAt.slice(11, 16);
}
/** "UTC−03:00" do fuso informado, para o colaborador saber de que horário se trata. */
export function utcOffsetLabel(timeZone: string, at = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at)
    .find((item) => item.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  return match ? `UTC${match[1] === "-" ? "−" : "+"}${match[2]}:${match[3]}` : "UTC";
}

/** Relógio digital com segundos exigido no coletor (Anexo IX, item 3), na hora oficial do estabelecimento. */
export function OfficialClockDisplay({ clock, tone = "light" }: { clock: RepPOfficialClock | null; tone?: "light" | "dark" }) {
  const [now, setNow] = useState(() => Date.now());
  const offset = useMemo(() => clock?.available ? officialClockOffsetMs(clock.instant, Date.now()) : 0, [clock]);
  useEffect(() => {
    if (!clock?.available) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clock]);
  if (!clock) return null;
  if (!clock.available) {
    return (
      <p className={tone === "dark" ? "max-w-[220px] text-ds-caution-tile" : "text-ds-warn"} role="status">
        <strong className={cn("block font-ds-mono font-extrabold leading-none tabular-nums", tone === "dark" ? "text-[30px] text-ds-on-dark-muted" : "text-3xl")}>--:--:--</strong>
        <span className="mt-1 block text-[11px] font-semibold">Hora Legal indisponível: o registro volta quando a hora oficial responder.</span>
      </p>
    );
  }
  if (tone === "dark") {
    return (
      <p aria-live="off">
        <strong className="block font-ds-mono text-[30px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-white">
          {formatOfficialClock(now + offset, clock.timeZone)}</strong>
        <span className="mt-1 block text-[11px] text-ds-on-dark-muted">Hora Legal Brasileira · {utcOffsetLabel(clock.timeZone)}</span>
      </p>
    );
  }
  return (
    <p className="text-ds-ink" aria-live="off">
      <span className="block text-xs font-bold text-ds-ink-muted">Hora oficial (Hora Legal Brasileira) · {utcOffsetLabel(clock.timeZone)}</span>
      <strong className="font-ds-mono text-3xl tabular-nums">{formatOfficialClock(now + offset, clock.timeZone)}</strong>
    </p>
  );
}

export function ReceiptPill({ status }: { status: RepPReceiptStatus }) {
  return status === "available"
    ? <StatusPill variant="ok">Comprovante disponível</StatusPill>
    : <StatusPill variant="warn">Comprovante pendente</StatusPill>;
}

const CAPTURE_TEXT: Record<RepPLocationCaptureState, string> = {
  idle: "",
  capturing: "Obtendo localização…",
  ready: "Localização pronta.",
  imprecise: "Localização imprecisa — o ponto será registrado para conferência.",
  unavailable: "Localização não permitida ou indisponível — o ponto será registrado.",
};

export function LocationCaptureNotice({ policy, state }: {
  policy: RepPLocationPolicyForCollector | null; state: RepPLocationCaptureState;
}) {
  if (!policy || policy.mode === "disabled") return null;
  if (state === "idle") return null;
  return <div className="rounded-ds-md border border-ds-info bg-ds-info-bg p-3 text-xs text-ds-ink-2">
    <p className="font-semibold" aria-live="polite">{CAPTURE_TEXT[state]}</p>
  </div>;
}

export function LocationResultNotice({ location }: { location: RepPMarkingPayload["location"] }) {
  if (!location || location.evaluation === "not_requested") return null;
  const text = location.evaluation === "inside" ? "Localização compatível com a unidade."
    : location.evaluation === "outside" ? "Localização fora da área — ponto registrado para conferência."
      : "Não foi possível confirmar a localização — ponto registrado.";
  return <p className="text-xs font-semibold text-ds-ink-muted">{text}</p>;
}
