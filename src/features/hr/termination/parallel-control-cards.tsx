"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  LockKeyhole,
  Shirt,
  Stethoscope,
} from "lucide-react";

import { CollaboratorUniforms } from "@/components/collaborator-uniforms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TerminationStep } from "./types";

export type TerminationAsoWorkflow = {
  status?: string;
  latestGuideId?: string;
  paymentStatus?: string;
  clinic?: { sentAt?: string };
  appointmentStatus?: string;
  appointment?: { date?: string; time?: string; status?: string };
  appointmentAt?: string;
  asoDocument?: { storagePath?: string; status?: string };
};

const TERMINAL_STATUSES = new Set(["completed", "waived", "cancelled"]);

function controlStatusLabel(status?: string | null) {
  if (status === "completed") return "Concluído";
  if (status === "waived") return "Dispensado com justificativa";
  if (status === "blocked") return "Atenção necessária";
  if (status === "waiting_external") return "Aguardando terceiro";
  if (status === "in_progress") return "Em andamento";
  return "Pendente";
}

function statusBadgeClass(status?: string | null) {
  if (TERMINAL_STATUSES.has(status ?? "")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "blocked") return "border-amber-200 bg-amber-50 text-amber-800";
  if (["in_progress", "waiting_external"].includes(status ?? "")) return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function ChecklistItem({ label, done, active, blocked }: { label: string; done: boolean; active?: boolean; blocked?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold ${
      done
        ? "border-emerald-100 bg-emerald-50/70 text-emerald-800"
        : blocked
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : active
            ? "border-sky-200 bg-sky-50 text-sky-800"
            : "border-slate-100 bg-slate-50 text-slate-500"
    }`}>
      {done
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        : blocked
          ? <LockKeyhole className="h-4 w-4 shrink-0 text-amber-600" />
          : active
            ? <Clock3 className="h-4 w-4 shrink-0 text-sky-600" />
            : <Circle className="h-4 w-4 shrink-0 text-slate-300" />}
      <span>{label}</span>
    </div>
  );
}

export function TerminationAsoCard({
  processId,
  workflow,
  step,
}: {
  processId: string;
  workflow: TerminationAsoWorkflow;
  step?: TerminationStep;
}) {
  const checks = [
    { label: "Guia gerada", done: Boolean(workflow.latestGuideId) },
    { label: "Pagamento confirmado", done: ["paid", "completed", "approved"].includes(workflow.paymentStatus ?? "") },
    { label: "Clínica acionada", done: Boolean(workflow.clinic?.sentAt) },
    { label: "Agendamento confirmado", done: workflow.appointmentStatus === "confirmed" || workflow.appointment?.status === "confirmed" || Boolean(workflow.appointmentAt) },
    { label: "ASO recebido", done: Boolean(workflow.asoDocument?.storagePath) },
    { label: "Aprovado pelo RH", done: step?.status === "completed" },
  ];
  const currentIndex = checks.findIndex((item) => !item.done);
  const blocked = step?.status === "blocked";

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
      <div className="border-b border-sky-100 bg-sky-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
              <Stethoscope className="h-5 w-5" />
            </span>
            <div>
              <p className="font-black text-slate-950">ASO demissional</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">Controle paralelo do início à aprovação.</p>
            </div>
          </div>
          <Badge variant="outline" className={`rounded-full text-[10px] font-black ${statusBadgeClass(step?.status)}`}>
            {controlStatusLabel(step?.status)}
          </Badge>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.map((item, index) => (
            <ChecklistItem
              key={item.label}
              label={item.label}
              done={item.done}
              active={!blocked && index === currentIndex && !TERMINAL_STATUSES.has(step?.status ?? "")}
              blocked={blocked && index === currentIndex}
            />
          ))}
        </div>
        {step?.blockedReason ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            {step.blockedReason}
          </p>
        ) : null}
        <Button asChild className="mt-4 w-full sm:w-fit" variant="outline">
          <Link href={`/dashboard/hr/recruitment/integration?process=${processId}`}>
            <ExternalLink className="h-4 w-4" />
            Abrir operação do ASO
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function TerminationUniformCard({
  collaborator,
  step,
  pendingPieces,
  busy,
  description,
  onPossessionChange,
  onValidate,
}: {
  collaborator: { id: string; username: string; email: string };
  step?: TerminationStep;
  pendingPieces: number | null;
  busy: boolean;
  description: string;
  onPossessionChange: (pieces: number) => void;
  onValidate: () => void | Promise<void>;
}) {
  const completed = step?.status === "completed";
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="border-b border-violet-100 bg-violet-50/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <Shirt className="h-5 w-5" />
            </span>
            <div>
              <p className="font-black text-slate-950">Uniformes</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">{description}</p>
            </div>
          </div>
          <Badge variant="outline" className={`rounded-full text-[10px] font-black ${statusBadgeClass(step?.status)}`}>
            {controlStatusLabel(step?.status)}
          </Badge>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <CollaboratorUniforms
          collaborator={collaborator}
          mode="return-only"
          onPossessionChange={onPossessionChange}
        />
        <Button
          className="mt-4 w-full sm:w-fit"
          variant="outline"
          disabled={busy || pendingPieces !== 0 || completed}
          onClick={() => void onValidate()}
        >
          {completed
            ? "Devolução validada"
            : pendingPieces === null
              ? "Carregando controle..."
              : `Validar devolução (${pendingPieces} pendente${pendingPieces === 1 ? "" : "s"})`}
        </Button>
      </div>
    </article>
  );
}
