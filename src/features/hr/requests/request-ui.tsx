"use client";

import { CheckCircle2, Circle, Clock3, FileCheck2, FileWarning, PenLine } from "lucide-react";

import { LiftRow } from "@/components/patterns/lift-row";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { formatBrazilianRequestText } from "@/features/hr/requests/core";
import type { CollaboratorRequest, CollaboratorRequestSignature } from "@/features/hr/requests/types";
import {
  COLLABORATOR_REQUEST_STATUS_LABELS,
  TRANSPORT_VOUCHER_ACTION_LABELS,
} from "@/features/hr/requests/types";
import { cn } from "@/lib/utils";

export function formatRequestDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

export function formatRequestDateTime(value: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function formatRequestCompetence(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return value || "—";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatCurrency(value: number | null) {
  return value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function requestStatusVariant(status: CollaboratorRequest["status"]): StatusPillVariant {
  if (status === "approved") return "ok";
  if (status === "pending") return "warn";
  if (status === "rejected") return "danger";
  return "neutral";
}

export function RequestRow({ request, selected, showEmployee, onOpen }: {
  request: CollaboratorRequest;
  selected: boolean;
  showEmployee?: boolean;
  onOpen: () => void;
}) {
  return (
    <LiftRow selected={selected} table onClick={onOpen} className="grid items-center gap-4 px-5 py-4 md:grid-cols-[minmax(180px,1.4fr)_minmax(130px,.8fr)_130px_155px_16px]">
      <div className="min-w-0">
        <p className="truncate text-[14px] font-extrabold text-ds-ink">
          {showEmployee ? request.employeeName : "Vale-transporte"}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-ds-ink-muted">
          {showEmployee ? `Vale-transporte · ${request.details || "Sem detalhes adicionais"}` : request.details || "Sem detalhes adicionais"}
        </p>
      </div>
      <div>
        <p className="text-[12.5px] font-bold text-ds-ink-2">{TRANSPORT_VOUCHER_ACTION_LABELS[request.action]}</p>
        <p className="text-[11.5px] text-ds-ink-faint">entra em vigor em {formatRequestDate(request.effectiveDate)}</p>
      </div>
      <span className="font-ds-mono text-[12px] font-bold text-ds-ink-muted">{formatRequestDate(request.createdAt.slice(0, 10))}</span>
      <StatusPill variant={requestStatusVariant(request.status)}>{COLLABORATOR_REQUEST_STATUS_LABELS[request.status]}</StatusPill>
      <span aria-hidden className="text-ds-ink-faint">›</span>
    </LiftRow>
  );
}

export function RequestTrail({ request, signature }: {
  request: CollaboratorRequest;
  signature?: CollaboratorRequestSignature | null;
}) {
  const trail = [...request.trail];
  if (signature?.signedAt && !trail.some((event) => event.label === "Termo assinado")) {
    trail.push({
      type: "signature_sent",
      label: "Termo assinado",
      at: signature.signedAt,
      actorId: request.employeeId,
      actorName: request.employeeName,
      details: "Assinatura eletrônica concluída.",
    });
  }
  return (
    <ol className="space-y-0">
      {trail.map((event, index) => {
        const complete = index < trail.length - 1 || request.status !== "pending" || event.type !== "submitted";
        return (
          <li key={`${event.type}-${event.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
            {index < trail.length - 1 ? <span className="absolute left-[9px] top-5 h-[calc(100%-4px)] w-px bg-ds-divider" /> : null}
            <span className={cn("relative z-1 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full", complete ? "bg-ds-ok-bg text-ds-ok" : "bg-ds-warn-bg text-ds-warn")}>
              {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-extrabold text-ds-ink">{event.label}</p>
              <p className="text-[11.5px] text-ds-ink-faint">{formatRequestDateTime(event.at)} · {event.actorName}</p>
              {event.details ? <p className="mt-1 text-[12px] leading-5 text-ds-ink-muted">{formatBrazilianRequestText(event.details)}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TermStatus({ request, signature }: {
  request: CollaboratorRequest;
  signature?: CollaboratorRequestSignature | null;
}) {
  if (request.documentStatus === "failed") {
    return <div className="flex gap-3 rounded-ds-md bg-ds-danger-bg p-3 text-ds-danger"><FileWarning className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-xs font-extrabold">Termo pendente</p><p className="mt-0.5 text-xs leading-5">{request.documentError}</p></div></div>;
  }
  if (request.documentStatus !== "generated") {
    return <div className="flex items-center gap-2 rounded-ds-md bg-ds-muted p-3 text-xs font-bold text-ds-ink-muted"><Clock3 className="h-4 w-4" />O termo será gerado após a aprovação.</div>;
  }
  if (signature?.signedAt || signature?.status === "signed") {
    return <div className="flex items-center gap-2 rounded-ds-md bg-ds-ok-bg p-3 text-xs font-extrabold text-ds-ok"><FileCheck2 className="h-4 w-4" />Termo assinado e preservado no histórico.</div>;
  }
  if (signature?.requestId) {
    return <div className="flex items-center gap-2 rounded-ds-md bg-ds-warn-bg p-3 text-xs font-extrabold text-ds-warn"><PenLine className="h-4 w-4" />Assinatura pendente do colaborador.</div>;
  }
  return <div className="flex items-center gap-2 rounded-ds-md bg-ds-info-bg p-3 text-xs font-extrabold text-ds-info"><FileCheck2 className="h-4 w-4" />Termo gerado; envio para assinatura disponível.</div>;
}
