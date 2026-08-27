"use client";

import { CalendarClock, CheckCircle2, Clock3 } from "lucide-react";

import type { ProbationProcessState } from "@/features/hr/integration/probation-process";

const STATUS_LABELS: Record<string, string> = {
  awaiting_admission: "Aguardando admissão",
  active: "Em andamento",
  decision_pending: "Aguardando decisão",
  effective: "Efetivado",
  terminated: "Encerrado",
  scheduled: "Programada",
  available: "Disponível",
  overdue: "Atrasada",
  completed: "Concluída",
};

function dateLabel(value?: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function EmployeeProbationCard({ probation }: { probation: ProbationProcessState | null }) {
  if (!probation) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400 shadow-sm">
        Nenhum período de experiência vinculado a este perfil.
      </div>
    );
  }

  const schedule = probation.schedule;
  return (
    <section className="rounded-xl border border-amber-100 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Contrato de experiência</h2>
            <p className="mt-1 text-xs text-gray-500">
              {schedule ? `${schedule.totalDays} dias programados` : "Aguardando data de admissão"}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
          {STATUS_LABELS[probation.status] ?? probation.status}
        </span>
      </div>

      {schedule ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[10px] font-semibold uppercase text-gray-400">Admissão</p>
              <p className="mt-1 text-xs font-semibold text-gray-800">{dateLabel(schedule.admissionDate)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-[10px] font-semibold uppercase text-gray-400">1º período</p>
              <p className="mt-1 text-xs font-semibold text-gray-800">até {dateLabel(schedule.firstPeriod.endDate)}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-[10px] font-semibold uppercase text-emerald-600">Prorrogação automática</p>
              <p className="mt-1 text-xs font-semibold text-emerald-800">
                {schedule.secondPeriod ? `até ${dateLabel(schedule.secondPeriod.endDate)}` : "Não aplicável"}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {probation.evaluations.map((evaluation) => (
              <div key={evaluation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {evaluation.status === "completed"
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : <Clock3 className="h-4 w-4 text-gray-400" />}
                  <div>
                    <p className="text-xs font-semibold text-gray-800">{evaluation.label}</p>
                    <p className="text-[11px] text-gray-400">
                      {dateLabel(evaluation.windowStartDate)} a {dateLabel(evaluation.windowEndDate)}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-gray-500">
                  {STATUS_LABELS[evaluation.status] ?? evaluation.status}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-emerald-800">
            A passagem para o segundo período ocorre automaticamente. Não é necessário gerar ou assinar termo manual de prorrogação.
          </p>
        </>
      ) : null}
    </section>
  );
}
