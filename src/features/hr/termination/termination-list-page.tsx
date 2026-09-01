"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, MapPin, Search } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import { terminationFetch } from "./client";
import type { CltTerminationProcess, TerminationStepId } from "./types";

const healthLabel = {
  on_track: "No prazo",
  attention: "Atenção",
  overdue: "Atrasado",
  blocked: "Bloqueado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const CARD_PHASES: Array<{ label: string; stepIds: TerminationStepId[] }> = [
  { label: "Abertura, comunicação e aviso-prévio", stepIds: ["request_validation_notice"] },
  { label: "Contabilidade", stepIds: ["accountant"] },
  { label: "Auditoria e assinaturas", stepIds: ["document_audit", "signatures"] },
  { label: "Bloqueio de acessos", stepIds: ["access_revocation"] },
  { label: "Pagamento e encerramento", stepIds: ["legal_obligations", "operational"] },
  { label: "Fechamento", stepIds: ["closure"] },
];

const EMPLOYER_CARD_PHASES: Array<{ label: string; stepIds: TerminationStepId[] }> = [
  { label: "Definição e comunicação", stepIds: ["request_validation_notice"] },
  { label: "Contabilidade e revisão", stepIds: ["accountant", "document_audit"] },
  { label: "Assinaturas rescisórias", stepIds: ["signatures"] },
  { label: "Conclusão com a colaboradora", stepIds: ["termination_payment", "employee_delivery"] },
  { label: "Encerramentos internos e acessos", stepIds: ["access_revocation", "operational"] },
  { label: "Finalização total", stepIds: ["closure"] },
];

const RESIGNATION_CARD_PHASES: Array<{ label: string; stepIds: TerminationStepId[] }> = [
  { label: "Pedido recebido", stepIds: ["request_received"] },
  { label: "Conferência da carta", stepIds: ["letter_review"] },
  { label: "Identidade e formalização", stepIds: ["identity_signature"] },
  { label: "Aviso-prévio e datas", stepIds: ["notice_decision"] },
  { label: "Contabilidade", stepIds: ["accountant"] },
  { label: "Assinaturas rescisórias", stepIds: ["signatures"] },
  { label: "Conclusão com o colaborador", stepIds: ["employee_delivery"] },
  { label: "Encerramentos internos", stepIds: ["access_revocation", "operational"] },
  { label: "Finalização total", stepIds: ["closure"] },
];

const TERMINAL_STATUSES = new Set(["completed", "waived", "cancelled"]);
const CARD_COLORS = ["#db2777", "#7c3aed", "#2563eb", "#0d9488", "#d97706", "#c026d3"];

function phaseData(process: CltTerminationProcess) {
  const guidedEmployerDismissal = process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication);
  const definitions = process.processType === "clt_employee_resignation"
    ? RESIGNATION_CARD_PHASES
    : guidedEmployerDismissal
      ? EMPLOYER_CARD_PHASES
      : CARD_PHASES;
  const phases = definitions.map((phase) => ({
    ...phase,
    steps: phase.stepIds.map((stepId) => process.steps.find((step) => step.id === stepId)).filter(Boolean),
  }));
  const firstOpenIndex = phases.findIndex((phase) => !phase.steps.every((step) => step && TERMINAL_STATUSES.has(step.status)));
  const currentIndex = firstOpenIndex === -1 ? phases.length - 1 : Math.max(0, firstOpenIndex);
  const current = phases[currentIndex];
  const startedAt = current.steps.map((step) => step?.startedAt).filter((value): value is string => Boolean(value)).sort()[0] ?? process.lastActivityAt;
  const daysInPhase = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 86_400_000));
  return { phases, currentIndex, current, daysInPhase };
}

function phaseAgeLabel(days: number) {
  if (days === 0) return "Iniciada hoje";
  return `Há ${days} dia${days === 1 ? "" : "s"} nesta fase`;
}

function statusLabelForCard(status?: string | null) {
  if (status === "paid") return "pago";
  if (status === "not_applicable") return "não aplicável";
  if (["awaiting_financial_authorization", "ready_to_submit", "submitting", "awaiting_bank_approval", "scheduled", "processing"].includes(status ?? "")) return "em andamento";
  if (["failed", "rejected", "configuration_required"].includes(status ?? "")) return "atenção";
  return "aguardando etapa 5";
}

function controlStatusForCard(status?: string | null) {
  if (status === "completed") return "concluído";
  if (status === "waived") return "ressalva";
  if (status === "blocked") return "atenção";
  if (["in_progress", "waiting_external"].includes(status ?? "")) return "em andamento";
  return "pendente";
}

export function TerminationListPage() {
  const { firebaseUser } = useAuth();
  const [items, setItems] = useState<CltTerminationProcess[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) return;
    terminationFetch<{ processes: CltTerminationProcess[] }>(firebaseUser, "/api/hr/terminations")
      .then((value) => setItems(value.processes))
      .catch((caught) => setError(caught.message));
  }, [firebaseUser]);

  const shown = useMemo(
    () => items.filter((item) => `${item.employeeName} ${item.request.protocol} ${item.employer?.legalName ?? ""} ${item.employer?.cnpj ?? ""} ${item.employer?.cnpj ? CnpjValidator.format(item.employer.cnpj) : ""} ${item.pjContractSnapshot?.provider.legalName ?? ""} ${item.pjContractSnapshot?.provider.cnpj ?? ""}`.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  );
  const active = items.filter((item) => !["completed", "cancelled"].includes(item.status));

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <span className="text-[11px] font-black uppercase tracking-[0.09em] text-pink-600">Departamento pessoal</span>
        <h1 className="mt-0.5 text-lg font-black tracking-tight text-slate-900">Desligamentos CLT</h1>
        <p className="mt-1 text-xs font-medium text-slate-500">Processos ativos, prazos, pendências e histórico em um único lugar.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-5"><Clock3 className="mb-2 h-5 w-5 text-blue-600" /><div className="text-2xl font-bold">{active.length}</div><p className="text-sm text-muted-foreground">Ativos</p></CardContent></Card>
        <Card><CardContent className="p-5"><AlertTriangle className="mb-2 h-5 w-5 text-red-600" /><div className="text-2xl font-bold">{active.filter((item) => ["overdue", "blocked"].includes(item.health)).length}</div><p className="text-sm text-muted-foreground">Atrasados ou bloqueados</p></CardContent></Card>
        <Card><CardContent className="p-5"><CheckCircle2 className="mb-2 h-5 w-5 text-green-600" /><div className="text-2xl font-bold">{items.filter((item) => item.status === "completed").length}</div><p className="text-sm text-muted-foreground">Concluídos</p></CardContent></Card>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="h-[46px] rounded-xl pl-11" placeholder="Buscar colaborador, protocolo, empresa ou CNPJ" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(330px,1fr))]">
        {shown.map((item, cardIndex) => {
          const { phases, currentIndex, current, daysInPhase } = phaseData(item);
          const completedSteps = phases.filter((phase) => phase.steps.length > 0 && phase.steps.every((step) => step && TERMINAL_STATUSES.has(step.status))).length;
          const processCompleted = item.status === "completed";
          const initials = item.employeeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          const isLate = item.health === "overdue";
          return (
            <Link key={item.id} href={`/dashboard/dp/terminations/${item.id}`} className="group">
              <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-pink-200 group-hover:shadow-md">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-black text-white" style={{ backgroundColor: CARD_COLORS[cardIndex % CARD_COLORS.length] }}>
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-black text-slate-900">{item.employeeName}</div>
                    <div className="mt-0.5 truncate text-xs font-medium text-slate-500">{item.employeeEmail}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
                    item.health === "on_track" || item.health === "completed"
                      ? "bg-emerald-50 text-emerald-700"
                      : item.health === "overdue" || item.health === "blocked"
                        ? "bg-rose-50 text-rose-700"
                        : "bg-amber-50 text-amber-700"
                  }`}>
                    {healthLabel[item.health]}
                  </span>
                </div>

                <div className="mt-3.5 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="truncate text-[13px] font-bold text-slate-700">{item.jobRoleName ?? "Cargo não informado"}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                    <MapPin className="h-3.5 w-3.5" />
                    {item.unitName ?? "Unidade não definida"}
                  </div>
                  <div className="mt-1.5 text-[11px] font-bold text-slate-500">
                    {item.employer?.legalName ?? "CNPJ empregador pendente"}
                    {item.employer?.cnpj ? ` · ${CnpjValidator.format(item.employer.cnpj)}` : ""}
                  </div>
                  {item.pjContractSnapshot?.provider ? (
                    <div className="mt-1 text-[11px] font-bold text-violet-600">
                      Prestadora: {item.pjContractSnapshot.provider.legalName} · {CnpjValidator.format(item.pjContractSnapshot.provider.cnpj)}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${isLate ? "bg-rose-600" : "bg-pink-600"}`} />
                    <span className="truncate text-xs font-bold text-slate-700">{current.label}</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{completedSteps}/{phases.length} etapas</span>
                </div>

                {item.employmentRelationshipType === "clt" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                    <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">Uniformes: {controlStatusForCard(item.steps.find((step) => step.id === "uniform_return")?.status)}</span>
                    <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">ASO: {controlStatusForCard(item.steps.find((step) => step.id === "aso")?.status)}</span>
                    {item.payment ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Pagamento: {statusLabelForCard(item.payment.status)}</span> : null}
                  </div>
                ) : null}

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10.5px] font-black uppercase tracking-wide text-slate-400">Progresso do processo</span>
                    <span className="text-xs font-black text-pink-600">Fase {currentIndex + 1} de {phases.length}</span>
                  </div>
                  <div
                    className="mt-2 grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(0, 1fr))` }}
                    role="img"
                    aria-label={processCompleted
                      ? `${phases.length} fases concluídas`
                      : `${currentIndex} fases concluídas, fase ${currentIndex + 1} em andamento, ${Math.max(phases.length - currentIndex - 1, 0)} futuras`}
                  >
                    {phases.map((phase, phaseIndex) => (
                      <span
                        key={phase.label}
                        className={`h-1.5 rounded-full ${
                          processCompleted || phaseIndex < currentIndex
                            ? "bg-emerald-500"
                            : phaseIndex === currentIndex
                              ? isLate ? "bg-rose-600" : "bg-pink-600"
                              : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${isLate ? "text-rose-600" : "text-slate-400"}`}>
                    <Clock3 className="h-3.5 w-3.5" />
                    {phaseAgeLabel(daysInPhase)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-pink-600">Abrir <ArrowRight className="h-3.5 w-3.5" /></span>
                </div>
              </article>
            </Link>
          );
        })}
      </div>

      {!shown.length && !error ? <p className="py-12 text-center text-muted-foreground">Nenhum desligamento encontrado.</p> : null}
    </div>
  );
}
