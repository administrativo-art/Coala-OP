"use client";

import { useEffect, useMemo, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";

import { formatOfficialClock, officialClockOffsetMs } from "./official-clock";
import type { RepPOfficialClock, RepPReceiptStatus } from "./use-rep-p-marking";

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
/** Relógio digital com segundos exigido no coletor (Anexo IX, item 3), na hora oficial do estabelecimento. */
export function OfficialClockDisplay({ clock }: { clock: RepPOfficialClock | null }) {
  const [now, setNow] = useState(() => Date.now());
  const offset = useMemo(() => clock?.available ? officialClockOffsetMs(clock.instant, Date.now()) : 0, [clock]);
  useEffect(() => {
    if (!clock?.available) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clock]);
  if (!clock) return null;
  if (!clock.available) {
    return <p className="text-sm font-semibold text-ds-warn">Hora oficial indisponível: o registro de ponto está temporariamente bloqueado.</p>;
  }
  return (
    <p className="text-ds-ink" aria-live="off">
      <span className="block text-xs font-bold text-ds-ink-muted">Hora oficial (Hora Legal Brasileira)</span>
      <strong className="font-ds-mono text-3xl tabular-nums">{formatOfficialClock(now + offset, clock.timeZone)}</strong>
    </p>
  );
}

export function ReceiptPill({ status }: { status: RepPReceiptStatus }) {
  return status === "available"
    ? <StatusPill variant="ok">Comprovante disponível</StatusPill>
    : <StatusPill variant="warn">Comprovante pendente</StatusPill>;
}
