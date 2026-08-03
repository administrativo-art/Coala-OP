"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  FileCheck2,
  History,
  LockKeyhole,
  MapPin,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CollaboratorUniforms } from "@/components/collaborator-uniforms";
import { terminationFetch } from "./client";
import { EmployeeResignationDetail } from "./employee-resignation-detail";
import type {
  CltTerminationProcess,
  TerminationEvent,
  TerminationStep,
  TerminationStepId,
  TerminationStepStatus,
} from "./types";

type AsoWorkflow = {
  status?: string;
  latestGuideId?: string;
  paymentStatus?: string;
  clinic?: { sentAt?: string };
  appointmentStatus?: string;
  asoDocument?: { storagePath?: string; status?: string };
};

type PhaseStatus = "completed" | "active" | "blocked" | "upcoming";

const PHASES: Array<{
  id: string;
  title: string;
  description: string;
  stepIds: TerminationStepId[];
}> = [
  { id: "request", title: "Pedido, identidade, validação e aviso-prévio", description: "Carta, identidade, validação do RH e definição do aviso-prévio em uma única etapa.", stepIds: ["request_validation_notice"] },
  { id: "uniforms", title: "Devolução de uniformes", description: "Registre as devoluções no controle de uniformes e valide que nenhuma peça permanece em posse.", stepIds: ["uniform_return"] },
  { id: "aso", title: "ASO demissional", description: "Guia, pagamento, clínica, agendamento, recebimento e aprovação.", stepIds: ["aso"] },
  { id: "accountant", title: "Contabilidade", description: "Liberada somente depois do aviso definido e do ASO aprovado.", stepIds: ["accountant"] },
  { id: "documents", title: "Auditoria e assinaturas", description: "Revisão dos documentos e assinatura das partes.", stepIds: ["document_audit", "signatures"] },
  { id: "access", title: "Bloqueio de acessos", description: "Revogação do PDV, Bizneo e plano de saúde.", stepIds: ["access_revocation"] },
  { id: "operations", title: "Pagamento e encerramento", description: "Obrigações rescisórias, devoluções e encerramentos operacionais.", stepIds: ["legal_obligations", "operational"] },
  { id: "closure", title: "Fechamento", description: "Conferência final e conclusão do desligamento.", stepIds: ["closure"] },
];

const TERMINAL_STEP_STATUSES: TerminationStepStatus[] = ["completed", "waived", "cancelled"];

function phaseStatus(steps: TerminationStep[]): PhaseStatus {
  if (steps.every((step) => TERMINAL_STEP_STATUSES.includes(step.status))) return "completed";
  if (steps.some((step) => ["in_progress", "waiting_external"].includes(step.status))) return "active";
  if (steps.some((step) => step.status === "blocked")) return "blocked";
  return "upcoming";
}

function statusLabel(status: TerminationStepStatus) {
  return {
    pending: "Pendente",
    in_progress: "Em andamento",
    waiting_external: "Aguardando terceiro",
    blocked: "Bloqueada",
    completed: "Concluída",
    waived: "Dispensada",
    cancelled: "Cancelada",
  }[status];
}

function phaseStatusLabel(status: PhaseStatus) {
  return {
    completed: "Concluída",
    active: "Etapa atual",
    blocked: "Bloqueada",
    upcoming: "Próxima etapa",
  }[status];
}

function ownerLabel(owner: TerminationStep["owner"]) {
  return {
    employee: "Colaborador",
    hr: "RH",
    employer: "Empresa",
    finance: "Financeiro",
    accountant: "Contador",
    clinic: "Clínica",
    manager: "Gestor",
    system: "Sistema",
  }[owner];
}

function ownerChipStyle(owner: string) {
  if (owner === "Colaborador") return "border-blue-100 bg-blue-50 text-blue-700";
  if (owner === "RH") return "border-pink-100 bg-pink-50 text-pink-700";
  if (owner === "Empresa") return "border-violet-100 bg-violet-50 text-violet-700";
  if (owner === "Contador") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (owner === "Gestor") return "border-orange-100 bg-orange-50 text-orange-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
}

function healthLabel(health: CltTerminationProcess["health"]) {
  return {
    on_track: "No prazo",
    attention: "Atenção",
    overdue: "Atrasado",
    blocked: "Bloqueado",
    completed: "Concluído",
    cancelled: "Cancelado",
  }[health];
}

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function belemDateOnly(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Belem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function PhaseBadge({ status }: { status: PhaseStatus }) {
  const style = status === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "blocked"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : status === "active"
        ? "border-pink-200 bg-pink-50 text-pink-700"
        : "border-slate-200 bg-slate-50 text-slate-500";
  return <Badge variant="outline" className={`rounded-full px-3 py-1 text-[11px] font-extrabold ${style}`}>{phaseStatusLabel(status)}</Badge>;
}

function StepLine({
  label,
  status,
  description,
  children,
}: {
  label: string;
  status: TerminationStepStatus;
  description?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        {TERMINAL_STEP_STATUSES.includes(status)
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          : status === "blocked"
            ? <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            : status === "in_progress" || status === "waiting_external"
              ? <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
              : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-300" />}
        <div>
          <p className="font-semibold text-slate-900">{label}</p>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children ?? <Badge variant="outline">{statusLabel(status)}</Badge>}
      </div>
    </div>
  );
}

function MiniStep({ label, done, active, blocked }: { label: string; done: boolean; active?: boolean; blocked?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {done
        ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        : blocked
          ? <LockKeyhole className="h-4 w-4 text-amber-600" />
          : active
            ? <Clock3 className="h-4 w-4 text-sky-600" />
            : <Circle className="h-4 w-4 text-slate-300" />}
      <span className={done ? "text-slate-700" : active || blocked ? "font-medium text-slate-800" : "text-slate-500"}>{label}</span>
    </div>
  );
}

function AccessRevocationPanel({
  process,
  busy,
  onAction,
}: {
  process: CltTerminationProcess;
  busy: boolean;
  onAction: (body: Record<string, unknown>) => void;
}) {
  const state = process.accessRevocation;
  const contractReached = Boolean(process.notice && new Date().toISOString().slice(0, 10) >= process.notice.contractEndDate);
  const rows = [
    { target: "pdv", label: "PDV Legal", status: state?.pdv.status ?? "pending", detail: state?.pdv.error ?? "Todos os cadastros ativos serão removidos e confirmados pela API." },
    { target: "bizneo", label: "Bizneo", status: state?.bizneo.status ?? "pending", detail: "Confirmação operacional do bloqueio no Bizneo." },
    { target: "healthPlan", label: "Odontoprev", status: state?.healthPlan.status ?? "pending", detail: "Confirmação da exclusão do benefício." },
  ] as const;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3.5">
        <p className="font-black text-slate-950">Sistemas</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          Bloqueie e confirme cada acesso do colaborador antes de concluir o desligamento.
        </p>
      </div>
      <div className="space-y-3 p-4">
      {!contractReached ? (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Os bloqueios serão liberados na data de término do contrato: {dateLabel(process.notice?.contractEndDate)}.</p>
        </div>
      ) : null}
      {rows.map((row) => {
        const done = row.status === "completed" || row.status === "not_applicable";
        return (
          <div key={row.target} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
            <div>
              <p className="font-black text-slate-900">{row.label}</p>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {row.status === "not_applicable" ? "Colaborador sem cadastro vinculado." : row.detail}
              </p>
            </div>
            {done ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Concluído</Badge>
            ) : (
              <Button
                variant={row.target === "pdv" ? "default" : "outline"}
                disabled={busy || !contractReached}
                onClick={() => {
                  if (row.target === "pdv" && !window.confirm("Remover agora todos os acessos ativos deste colaborador no PDV Legal? Cada cadastro será removido individualmente pela API.")) return;
                  onAction({ action: "revoke_access", target: row.target });
                }}
              >
                {row.target === "pdv" ? "Remover pela API" : "Confirmar bloqueio"}
              </Button>
            )}
          </div>
        );
      })}
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
        <p className="font-black text-sky-900">Coala One</p>
        <p className="mt-1 text-xs font-semibold text-sky-700">
          O login será bloqueado automaticamente quando o RH concluir o desligamento.
        </p>
      </div>
      </div>
    </div>
  );
}

export function TerminationDetailPage({ id }: { id: string }) {
  const { firebaseUser } = useAuth();
  const [process, setProcess] = useState<CltTerminationProcess | null>(null);
  const [events, setEvents] = useState<TerminationEvent[]>([]);
  const [asoWorkflow, setAsoWorkflow] = useState<AsoWorkflow>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState("worked");
  const [communicationDate, setCommunicationDate] = useState(new Date().toISOString().slice(0, 10));
  const [contractEndDate, setContractEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountantEmail, setAccountantEmail] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [pendingUniformPieces, setPendingUniformPieces] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    const data = await terminationFetch<{ process: CltTerminationProcess; events: TerminationEvent[] }>(
      firebaseUser,
      `/api/hr/terminations/${id}`,
    );
    setProcess(data.process);
    setEvents(data.events);
    const submittedDate = belemDateOnly(data.process.request.submittedAt);
    setCommunicationDate(submittedDate);
    setContractEndDate(submittedDate);
    if (data.process.hrValidation?.status === "confirmed" || data.process.processType === "clt_employee_resignation") {
      const aso = await terminationFetch<{ workflow: AsoWorkflow }>(
        firebaseUser,
        `/api/hr/onboarding/${id}/aso-workflow`,
      ).catch(() => ({ workflow: {} }));
      setAsoWorkflow(aso.workflow);
    }
  }, [firebaseUser, id]);

  useEffect(() => {
    load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Falha ao carregar."));
  }, [load]);

  async function action(body: Record<string, unknown>) {
    if (!firebaseUser) return;
    setBusy(true);
    setError(null);
    try {
      await terminationFetch(firebaseUser, `/api/hr/terminations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Falha.");
    } finally {
      setBusy(false);
    }
  }

  const stepsById = useMemo(
    () => new Map(process?.steps.map((step) => [step.id, step]) ?? []),
    [process?.steps],
  );

  if (!process) return <div className="p-8 text-muted-foreground">{error ?? "Carregando..."}</div>;

  if (process.processType === "clt_employee_resignation" || (
    process.processType === "clt_hr_termination"
    && process.terminationReason === "Dispensa sem justa causa"
    && Boolean(process.dismissalCommunication)
  )) {
    return <EmployeeResignationDetail process={process} events={events} asoWorkflow={asoWorkflow} busy={busy} error={error} onAction={action} />;
  }

  const asoStep = stepsById.get("aso")!;
  const uniformReturnStep = stepsById.get("uniform_return")!;
  const accountantStep = stepsById.get("accountant")!;
  const accountantReady = Boolean(process.notice) && asoStep.status === "completed";
  const accountantDocuments = process.documents.filter((document) => ["accountant_document", "signed_document"].includes(document.type));
  const rawPhases = PHASES.map((phase) => ({
    ...phase,
    steps: phase.stepIds.map((stepId) => stepsById.get(stepId)).filter((step): step is TerminationStep => Boolean(step)),
  }));
  const defaultPhase = rawPhases.find((phase) => phaseStatus(phase.steps) === "active")
    ?? rawPhases.find((phase) => phaseStatus(phase.steps) === "blocked")
    ?? rawPhases[0];
  const selectedPhase = rawPhases.find((phase) => phase.id === selectedPhaseId) ?? defaultPhase;
  const selectedStatus = phaseStatus(selectedPhase.steps);
  const selectedBlockedReason = selectedPhase.steps.find((step) => step.blockedReason)?.blockedReason;
  const completedSteps = process.steps.filter((step) => TERMINAL_STEP_STATUSES.includes(step.status)).length;
  const pendingSteps = process.steps.length - completedSteps;
  const isHrManaged = process.source === "hr_manual";
  const initials = process.employeeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const identityConfirmed = ["verified", "manual_verified"].includes(process.request.identityStatus);
  const identityControlStatus: TerminationStepStatus = identityConfirmed ? "completed" : "in_progress";
  const validationControlStatus: TerminationStepStatus = process.hrValidation?.status === "confirmed"
    ? "completed"
    : identityConfirmed
      ? "in_progress"
      : "pending";

  const noticeContent = process.notice ? (
    <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
      <div>
        <p className="font-semibold text-slate-900">
          {process.notice.decision === "worked"
            ? "Aviso cumprido — 30 dias"
            : process.notice.decision === "hr_defined"
              ? "Término definido pelo RH"
              : "Aviso indenizado"}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Término em {dateLabel(process.notice.contractEndDate)} · prazo legal em {dateLabel(process.notice.legalPaymentDueDate)}
        </p>
      </div>
    </div>
  ) : process.hrValidation?.status === "confirmed" ? (
    <div className="border-t border-slate-100 bg-slate-50/70 p-4">
      <p className="mb-3 text-sm font-black text-slate-900">Definição do aviso-prévio</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          Modalidade
          <Select
            value={decision}
            onValueChange={(value) => {
              setDecision(value);
              if (value !== "worked") setContractEndDate(communicationDate);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="worked">Aviso cumprido — 30 dias</SelectItem>
              <SelectItem value="waived_with_discount">Aviso indenizado</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Data da comunicação
          <Input type="date" value={communicationDate} readOnly className="bg-white" />
          <span className="block text-xs font-normal text-slate-500">
            {isHrManaged ? "Data de abertura do processo pelo RH." : "Data do envio da carta pelo colaborador."}
          </span>
        </label>
        {decision !== "worked" ? (
          <label className="space-y-1.5 text-sm font-medium">
            Término do contrato
            <Input type="date" value={communicationDate} readOnly className="bg-white" />
            <span className="block text-xs font-normal text-slate-500">
              No aviso indenizado, o contrato termina na data da comunicação.
            </span>
          </label>
        ) : <div />}
        <Button className="self-end" disabled={busy} onClick={() => action({ action: "decide_notice", decision, communicationDate, contractEndDate })}>
          Confirmar aviso
        </Button>
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
      <Circle className="h-5 w-5 shrink-0 text-slate-300" />
      <div>
        <p className="font-semibold text-slate-900">Definição do aviso-prévio</p>
        <p className="mt-0.5 text-sm text-muted-foreground">Aguardando validação do RH.</p>
      </div>
    </div>
  );

  let selectedContent: ReactNode = null;
  if (selectedPhase.id === "request") {
    selectedContent = (
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center gap-3 px-4 py-4">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div>
            <p className="font-semibold text-slate-900">
              {isHrManaged ? "Desligamento protocolado pelo RH" : "Carta e pedido protocolados"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">Protocolo {process.request.protocol}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
          {identityControlStatus === "completed"
            ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            : <Clock3 className="h-5 w-5 shrink-0 text-sky-600" />}
          <div>
            <p className="font-semibold text-slate-900">
              {isHrManaged ? "Responsável identificado" : "Identidade confirmada"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isHrManaged
                ? "Abertura vinculada ao usuário responsável e registrada no histórico."
                : "Confirmação vinculada ao pedido e registrada no histórico."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-4">
          {validationControlStatus === "completed"
            ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            : validationControlStatus === "in_progress"
              ? <Clock3 className="h-5 w-5 shrink-0 text-sky-600" />
              : <Circle className="h-5 w-5 shrink-0 text-slate-300" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">
              {isHrManaged ? "Validação da abertura pelo RH" : "Análise da manifestação pelo RH"}
            </p>
          </div>
          {process.status === "hr_review"
            ? <Button disabled={busy} onClick={() => action({ action: "validate" })}>Validar pedido</Button>
            : null}
        </div>
        {noticeContent}
      </div>
    );
  } else if (selectedPhase.id === "uniforms") {
    selectedContent = (
      <>
        <div className="rounded-xl border bg-white p-4">
          <CollaboratorUniforms
            collaborator={{
              id: process.employeeId,
              username: process.employeeName,
              email: process.employeeEmail,
            }}
            mode="return-only"
            onPossessionChange={setPendingUniformPieces}
          />
        </div>
        <div className={`rounded-xl border p-4 text-sm ${
          pendingUniformPieces === 0
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}>
          {pendingUniformPieces === null
            ? "Carregando situação dos uniformes..."
            : pendingUniformPieces === 0
              ? "Nenhuma peça permanece em posse. Valide para concluir esta etapa."
              : `${pendingUniformPieces} peça(s) ainda precisam ser devolvidas antes da validação.`}
        </div>
        <Button
          disabled={busy || selectedStatus === "upcoming" || pendingUniformPieces !== 0 || uniformReturnStep.status === "completed"}
          onClick={() => action({ action: "sync_uniform_return" })}
        >
          {uniformReturnStep.status === "completed" ? "Devolução validada" : "Validar devolução"}
        </Button>
      </>
    );
  } else if (selectedPhase.id === "aso") {
    selectedContent = (
      <>
        <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
          <MiniStep label="Guia gerada" done={Boolean(asoWorkflow.latestGuideId)} active={!asoWorkflow.latestGuideId && asoStep.status === "in_progress"} />
          <MiniStep label="Pagamento confirmado" done={asoWorkflow.paymentStatus === "paid"} active={Boolean(asoWorkflow.latestGuideId) && asoWorkflow.paymentStatus !== "paid"} />
          <MiniStep label="Enviado à clínica" done={Boolean(asoWorkflow.clinic?.sentAt)} />
          <MiniStep label="Agendamento confirmado" done={asoWorkflow.appointmentStatus === "confirmed"} />
          <MiniStep label="ASO recebido" done={Boolean(asoWorkflow.asoDocument?.storagePath)} />
          <MiniStep label="ASO aprovado pelo RH" done={asoStep.status === "completed"} blocked={asoStep.status === "blocked"} />
        </div>
        {process.hrValidation?.status === "confirmed" && process.employmentRelationshipType === "clt" ? (
          <Button asChild variant="outline">
            <Link href={`/dashboard/hr/recruitment/integration?process=${process.id}`}>Abrir operação do ASO</Link>
          </Button>
        ) : null}
      </>
    );
  } else if (selectedPhase.id === "accountant") {
    selectedContent = (
      <>
        <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
          <MiniStep label="Aviso-prévio definido" done={Boolean(process.notice)} active={!process.notice} />
          <MiniStep label="ASO concluído e aprovado" done={asoStep.status === "completed"} blocked={Boolean(process.notice) && asoStep.status !== "completed"} />
          <MiniStep label="Resumo enviado à contabilidade" done={["sent", "documents_received", "correction_requested", "approved"].includes(process.accountant?.status ?? "")} active={accountantReady && process.accountant?.status === "ready_to_send"} />
          <MiniStep label="Documentos rescisórios recebidos" done={["documents_received", "correction_requested", "approved"].includes(process.accountant?.status ?? "")} />
        </div>
        {!accountantReady ? (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Envio à contabilidade bloqueado</p>
              <p>{accountantStep.blockedReason ?? "Conclua o aviso-prévio e aprove o ASO demissional."}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row">
            <Input
              type="email"
              placeholder="E-mail da contabilidade"
              value={accountantEmail}
              onChange={(event) => setAccountantEmail(event.target.value)}
              disabled={process.accountant?.status !== "ready_to_send"}
            />
            <Button
              disabled={busy || !accountantEmail || process.accountant?.status !== "ready_to_send"}
              onClick={() => action({ action: "send_accountant", recipientEmail: accountantEmail })}
            >
              Enviar resumo e portal
            </Button>
          </div>
        )}
      </>
    );
  } else if (selectedPhase.id === "documents") {
    selectedContent = (
      <>
        {accountantDocuments.length ? accountantDocuments.map((document) => (
          <label key={document.id} className="flex items-center gap-3 rounded-xl border bg-white p-4 text-sm">
            <input
              type="checkbox"
              checked={Boolean(document.selectedForEmployee || selectedDocumentIds.includes(document.id))}
              disabled={document.type === "signed_document"}
              onChange={(event) => setSelectedDocumentIds((current) => event.target.checked
                ? [...new Set([...current, document.id])]
                : current.filter((documentId) => documentId !== document.id))}
            />
            <span className="flex-1">{document.label}</span>
            <Badge variant="outline">{document.auditStatus}</Badge>
          </label>
        )) : (
          <StepLine label="Documentos da contabilidade" status="pending" description="Aguardando o envio dos arquivos pelo portal seguro." />
        )}
        {accountantDocuments.some((document) => document.type === "accountant_document") ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                const approvedIds = process.documents.filter((document) => document.type === "accountant_document").map((document) => document.id);
                void action({ action: "audit_documents", approvedIds, selectedIds: selectedDocumentIds });
              }}
            >
              <FileCheck2 className="mr-2 h-4 w-4" /> Aprovar auditoria
            </Button>
            <Button
              disabled={busy || stepsById.get("document_audit")?.status !== "completed"}
              onClick={() => action({ action: "send_signatures" })}
            >
              Enviar para assinatura
            </Button>
          </div>
        ) : null}
      </>
    );
  } else if (selectedPhase.id === "access") {
    selectedContent = <AccessRevocationPanel process={process} busy={busy} onAction={(body) => void action(body)} />;
  } else if (selectedPhase.id === "operations") {
    selectedContent = (
      <>
        {selectedPhase.steps.map((step) => (
          <StepLine key={step.id} label={step.label} status={step.status} description={step.note}>
            <Select
              disabled={busy || process.status === "completed"}
              value={step.status}
              onValueChange={(status: TerminationStepStatus) => action({ action: "update_step", stepId: step.id, status })}
            >
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="in_progress">Em andamento</SelectItem>
                <SelectItem value="blocked">Bloqueada</SelectItem>
                <SelectItem value="completed">Concluída</SelectItem>
                <SelectItem value="waived">Dispensada</SelectItem>
              </SelectContent>
            </Select>
          </StepLine>
        ))}
      </>
    );
  } else if (selectedPhase.id === "closure") {
    const hasIncompleteSteps = process.steps.some((step) => step.required && step.id !== "closure" && !TERMINAL_STEP_STATUSES.includes(step.status));
    selectedContent = (
      <>
        {hasIncompleteSteps ? (
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Ainda existem etapas obrigatórias</p>
              <p>Conclua as etapas anteriores para liberar o fechamento.</p>
            </div>
          </div>
        ) : null}
        <Button disabled={busy || process.status === "completed" || hasIncompleteSteps} onClick={() => action({ action: "complete" })}>
          Concluir desligamento
        </Button>
      </>
    );
  }

  return (
    <div className="min-h-full bg-[#f0eee9] px-4 py-5 text-[#1d1d26] sm:px-7 sm:py-7">
      <div className="mx-auto max-w-[1280px] space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="h-10 rounded-xl border-[#e2e0da] bg-white px-4 font-bold text-slate-700 shadow-sm">
            <Link href="/dashboard/dp/terminations">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar aos desligamentos
            </Link>
          </Button>
          <div className="inline-flex h-10 items-center gap-2.5 rounded-xl border border-pink-100 bg-pink-50 px-4 text-xs font-extrabold text-pink-700">
            <span className="h-2 w-2 rounded-full bg-pink-600 shadow-[0_0_0_4px_rgba(219,39,119,0.12)]" />
            {pendingSteps} {pendingSteps === 1 ? "tarefa pendente" : "tarefas pendentes"}
          </div>
          <div className="ml-auto inline-flex items-center gap-2 font-mono text-xs font-semibold text-slate-400">
            <Clock3 className="h-4 w-4" />
            {new Date(process.lastActivityAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
          </div>
        </div>

        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p> : null}

        <section className="overflow-hidden rounded-[24px] border border-[#e2e0da] bg-white shadow-[0_12px_36px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex flex-wrap items-start justify-between gap-7 px-5 py-6 sm:px-7">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-gradient-to-br from-pink-500 to-pink-700 text-lg font-black text-white shadow-[0_12px_24px_-14px_rgba(219,39,119,0.8)] sm:h-16 sm:w-16">
                {initials}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-[#e8e6df] bg-[#f5f4f0] px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-600">
                    {process.request.protocol}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${
                    process.health === "on_track" || process.health === "completed"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : process.health === "overdue" || process.health === "blocked"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {healthLabel(process.health)}
                  </span>
                </div>
                <h1 className="mt-3 break-words text-xl font-black tracking-[-0.02em] text-slate-950 sm:text-2xl">
                  {process.employeeName}
                </h1>
                <p className="mt-1 break-all text-[13px] font-medium text-slate-500">{process.employeeEmail}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7f6f2] px-3 py-1.5 text-xs font-bold text-slate-600">
                    <BriefcaseBusiness className="h-3.5 w-3.5 text-slate-400" />
                    {process.jobRoleName ?? "Cargo não informado"}
                  </span>
                  {process.unitName ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7f6f2] px-3 py-1.5 text-xs font-bold text-slate-600">
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      {process.unitName}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex w-full items-center justify-center gap-4 sm:w-auto sm:justify-start">
              <div
                className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-[9px]"
                style={{ background: `conic-gradient(#db2777 ${Math.max(0, Math.min(process.progress, 100)) * 3.6}deg, #f0eee9 0deg)` }}
                role="img"
                aria-label={`${process.progress}% de progresso`}
              >
                <div className="grid h-full w-full place-items-center rounded-full bg-white text-center">
                  <span>
                    <strong className="block text-xl font-black leading-none text-slate-950">{process.progress}%</strong>
                    <span className="mt-1 block text-[8px] font-black uppercase tracking-[0.12em] text-slate-400">progresso</span>
                  </span>
                </div>
              </div>
              <div className="grid gap-2">
                <div className="flex min-w-[145px] items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <strong className="text-lg font-black text-emerald-700">{completedSteps}</strong>
                  <span className="text-[9px] font-black uppercase tracking-[0.08em] text-emerald-600">etapas concluídas</span>
                </div>
                <div className="flex min-w-[145px] items-center gap-3 rounded-xl border border-pink-100 bg-pink-50 px-3 py-2">
                  <strong className="text-lg font-black text-pink-700">{pendingSteps}</strong>
                  <span className="text-[9px] font-black uppercase tracking-[0.08em] text-pink-600">etapas pendentes</span>
                </div>
              </div>
            </div>
          </div>

          {process.notice ? (
            <div className="grid gap-2 border-t border-[#eeece6] bg-[#fbfaf7] px-5 py-3 text-xs font-semibold text-slate-500 sm:grid-cols-3 sm:px-7">
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-slate-400" /> Comunicação: <b className="text-slate-700">{dateLabel(process.notice.communicationDate)}</b></span>
              <span>Término: <b className="text-slate-700">{dateLabel(process.notice.contractEndDate)}</b></span>
              <span>Pagamento até: <b className="text-slate-700">{dateLabel(process.notice.legalPaymentDueDate)}</b></span>
            </div>
          ) : null}

          <div className="grid border-t border-[#eeece6] xl:grid-cols-[292px_minmax(0,1fr)]">
            <aside className="border-b border-[#eeece6] bg-[#fbfaf7] px-4 py-5 xl:border-b-0 xl:border-r xl:px-5 xl:py-6">
              <p className="mb-4 flex items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.11em] text-slate-400">
                <Clock3 className="h-3.5 w-3.5" />
                Linha do tempo
              </p>
              <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-1">
                {rawPhases.map((phase, index) => {
                  const status = phaseStatus(phase.steps);
                  const selected = phase.id === selectedPhase.id;
                  const owners = phase.id === "request"
                    ? isHrManaged ? ["RH", "Empresa"] : ["Colaborador", "RH", "Empresa"]
                    : Array.from(new Set(phase.steps.map((step) => ownerLabel(step.owner))));
                  return (
                    <button
                      key={phase.id}
                      type="button"
                      onClick={() => setSelectedPhaseId(phase.id)}
                      aria-current={selected ? "step" : undefined}
                      className={`group flex w-full gap-3 rounded-xl p-2.5 text-left transition ${
                        selected
                          ? "bg-white shadow-[0_3px_12px_-7px_rgba(15,23,42,0.35)] ring-1 ring-pink-100"
                          : "hover:bg-white/70"
                      }`}
                    >
                      <span className="flex flex-col items-center">
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-black transition ${
                          status === "completed"
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : status === "active"
                              ? "border-pink-600 bg-pink-600 text-white shadow-[0_0_0_5px_rgba(219,39,119,0.12)]"
                              : status === "blocked"
                                ? "border-amber-200 bg-white text-amber-600"
                                : "border-slate-200 bg-white text-slate-400"
                        }`}>
                          {status === "completed"
                            ? <CheckCircle2 className="h-4 w-4" />
                            : status === "blocked"
                              ? <LockKeyhole className="h-3.5 w-3.5" />
                              : index + 1}
                        </span>
                        {index < rawPhases.length - 1 ? (
                          <span className={`my-1 hidden min-h-4 w-0.5 flex-1 rounded-full xl:block ${
                            status === "completed" ? "bg-emerald-300" : "bg-slate-200"
                          }`} />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 pb-1">
                        <span className={`block text-[13px] font-extrabold leading-[1.3] ${
                          selected || status === "active"
                            ? "text-pink-700"
                            : status === "completed"
                              ? "text-slate-700"
                              : status === "blocked"
                                ? "text-amber-700"
                                : "text-slate-500"
                        }`}>
                          {phase.title}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {owners.map((owner) => (
                            <span key={owner} className={`rounded-md border px-1.5 py-0.5 text-[9px] font-extrabold ${ownerChipStyle(owner)}`}>
                              {owner}
                            </span>
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="min-w-0 px-5 py-6 sm:px-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-[0.1em] text-pink-600">
                    Etapa {rawPhases.findIndex((phase) => phase.id === selectedPhase.id) + 1} de {rawPhases.length}
                    <span className="mx-2 text-pink-200">·</span>
                    Trilha de desligamento
                  </span>
                  <h2 className="mt-2 text-xl font-black tracking-[-0.02em] text-slate-950 sm:text-2xl">{selectedPhase.title}</h2>
                  <p className="mt-2 max-w-[680px] text-sm font-medium leading-relaxed text-slate-500">
                    {selectedBlockedReason ?? selectedPhase.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedPhase.steps[0]?.dueAt ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-extrabold text-amber-700">
                      <Clock3 className="h-3.5 w-3.5" />
                      Até {dateLabel(selectedPhase.steps[0].dueAt)}
                    </span>
                  ) : null}
                  <PhaseBadge status={selectedStatus} />
                </div>
              </div>

              {selectedStatus === "upcoming" ? (
                <div className="mt-5 flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                  <LockKeyhole className="h-4 w-4 shrink-0 text-slate-400" />
                  Esta etapa ainda não está liberada. Conclua os requisitos anteriores para habilitar as ações.
                </div>
              ) : null}

              <div className="mt-5 space-y-4">{selectedContent}</div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[24px] border border-[#e2e0da] bg-white shadow-[0_12px_36px_-28px_rgba(15,23,42,0.3)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f0ec] px-5 py-5 sm:px-7">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f5f4f0] text-slate-500">
                <History className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-base font-black tracking-tight text-slate-950">Histórico auditável</h3>
                <p className="mt-0.5 text-xs font-medium text-slate-400">Eventos registrados com data, hora e responsável.</p>
              </div>
            </div>
            <span className="rounded-lg border border-[#e8e6df] bg-[#f5f4f0] px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-500">
              {events.length} {events.length === 1 ? "evento" : "eventos"}
            </span>
          </div>
          <div className="px-5 py-2 sm:px-7">
            {events.length ? events.map((event, index) => (
              <div key={event.id} className={`flex flex-wrap gap-3 py-3.5 sm:flex-nowrap ${index < events.length - 1 ? "border-b border-[#f4f3ef]" : ""}`}>
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-600 shadow-[0_0_0_3px_rgba(219,39,119,0.12)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{event.message}</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">{event.actorName}</p>
                </div>
                <time className="ml-5 shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-slate-400 sm:ml-0">
                  {new Date(event.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </time>
              </div>
            )) : (
              <p className="py-8 text-center text-sm font-medium text-slate-400">Nenhum evento registrado.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
