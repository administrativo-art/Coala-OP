"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  FileCheck2,
  LockKeyhole,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { terminationFetch } from "./client";
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
  { id: "request", title: "Pedido e identidade", description: "Carta, protocolo e confirmação da identidade do colaborador.", stepIds: ["employee_request", "identity_signature"] },
  { id: "validation", title: "Validação do RH", description: "Conferência da manifestação e autorização para iniciar o desligamento.", stepIds: ["hr_validation"] },
  { id: "notice", title: "Definição do aviso-prévio", description: "Modalidade, término do contrato e prazo legal da rescisão.", stepIds: ["notice_decision"] },
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

function PhaseIcon({ status }: { status: PhaseStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === "blocked") return <LockKeyhole className="h-5 w-5 text-amber-600" />;
  if (status === "active") return <Clock3 className="h-5 w-5 text-sky-600" />;
  return <Circle className="h-5 w-5 text-slate-300" />;
}

function PhaseBadge({ status }: { status: PhaseStatus }) {
  const style = status === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "blocked"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : status === "active"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-slate-200 bg-slate-50 text-slate-500";
  return <Badge variant="outline" className={style}>{phaseStatusLabel(status)}</Badge>;
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
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    const data = await terminationFetch<{ process: CltTerminationProcess; events: TerminationEvent[] }>(
      firebaseUser,
      `/api/hr/terminations/${id}`,
    );
    setProcess(data.process);
    setEvents(data.events);
    if (data.process.hrValidation?.status === "confirmed") {
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

  const asoStep = stepsById.get("aso")!;
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
  const initials = process.employeeName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  let selectedContent: ReactNode = null;
  if (selectedPhase.id === "request") {
    selectedContent = (
      <>
        <StepLine label="Carta e pedido protocolados" status={stepsById.get("employee_request")!.status} description={`Protocolo ${process.request.protocol}`} />
        <StepLine label="Identidade confirmada" status={stepsById.get("identity_signature")!.status} description="Confirmação vinculada ao pedido e registrada no histórico." />
      </>
    );
  } else if (selectedPhase.id === "validation") {
    selectedContent = (
      <StepLine label="Análise da manifestação pelo RH" status={stepsById.get("hr_validation")!.status}>
        {process.status === "hr_review"
          ? <Button disabled={busy} onClick={() => action({ action: "validate" })}>Validar pedido</Button>
          : undefined}
      </StepLine>
    );
  } else if (selectedPhase.id === "notice") {
    selectedContent = process.notice ? (
      <StepLine
        label={process.notice.decision === "worked" ? "Aviso cumprido — 30 dias" : "Aviso indenizado"}
        status="completed"
        description={`Término em ${dateLabel(process.notice.contractEndDate)} · prazo legal em ${dateLabel(process.notice.legalPaymentDueDate)}`}
      />
    ) : process.hrValidation?.status === "confirmed" ? (
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-medium">
          Modalidade
          <Select value={decision} onValueChange={setDecision}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="worked">Aviso cumprido — 30 dias</SelectItem>
              <SelectItem value="waived_with_discount">Aviso indenizado</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-sm font-medium">
          Data da comunicação
          <Input type="date" value={communicationDate} onChange={(event) => setCommunicationDate(event.target.value)} />
        </label>
        {decision !== "worked" ? (
          <label className="space-y-1.5 text-sm font-medium">
            Término do contrato
            <Input type="date" value={contractEndDate} onChange={(event) => setContractEndDate(event.target.value)} />
          </label>
        ) : <div />}
        <Button className="self-end" disabled={busy} onClick={() => action({ action: "decide_notice", decision, communicationDate, contractEndDate })}>
          Confirmar aviso
        </Button>
      </div>
    ) : <StepLine label="Definição do aviso-prévio" status="pending" description="Aguardando validação do RH." />;
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
        {process.hrValidation?.status === "confirmed" ? (
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
    <div className="space-y-4 p-4 md:p-8">
      <Button asChild variant="outline" className="rounded-xl">
        <Link href="/dashboard/dp/terminations">Voltar aos desligamentos</Link>
      </Button>

      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_8px_30px_-14px_rgba(15,23,42,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-100 p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[10.5px] font-black uppercase tracking-wide text-slate-600">
                {process.request.protocol}
              </span>
              <span className={`rounded-full px-3 py-1 text-[10.5px] font-black uppercase tracking-wide ${
                process.health === "on_track" ? "bg-emerald-50 text-emerald-700" : process.health === "overdue" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
              }`}>
                {healthLabel(process.health)}
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-pink-600 text-[15px] font-black text-white">{initials}</span>
              <div className="min-w-0">
                <h1 className="text-xl font-black tracking-tight text-slate-900">{process.employeeName}</h1>
                <p className="mt-0.5 text-[13.5px] font-medium text-slate-500">{process.employeeEmail}</p>
              </div>
            </div>
            <p className="mt-3 text-[13.5px] font-bold text-slate-600">
              {process.jobRoleName ?? "Cargo não informado"}{process.unitName ? ` · ${process.unitName}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div className="min-w-[78px] rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Progresso</div>
              <div className="mt-1 text-[19px] font-black text-slate-900">{process.progress}%</div>
            </div>
            <div className="min-w-[78px] rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Concluídas</div>
              <div className="mt-1 text-[19px] font-black text-emerald-600">{completedSteps}</div>
            </div>
            <div className="min-w-[78px] rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-center">
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Pendentes</div>
              <div className="mt-1 text-[19px] font-black text-amber-600">{pendingSteps}</div>
            </div>
          </div>
        </div>

        {process.notice ? (
          <div className="grid gap-2 border-b border-slate-100 bg-slate-50/70 px-6 py-3 text-xs font-semibold text-slate-500 sm:grid-cols-3">
            <span>Comunicação: <b className="text-slate-700">{dateLabel(process.notice.communicationDate)}</b></span>
            <span>Término: <b className="text-slate-700">{dateLabel(process.notice.contractEndDate)}</b></span>
            <span>Pagamento até: <b className="text-slate-700">{dateLabel(process.notice.legalPaymentDueDate)}</b></span>
          </div>
        ) : null}

        <div className="flex flex-wrap items-start gap-5 p-6">
          <aside className="min-w-[260px] flex-[1_1_290px] rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <p className="mb-3.5 text-[11px] font-black uppercase tracking-wide text-slate-500">Linha do tempo · desligamento</p>
            <div className="space-y-1">
              {rawPhases.map((phase, index) => {
                const status = phaseStatus(phase.steps);
                const selected = phase.id === selectedPhase.id;
                const owner = Array.from(new Set(phase.steps.map((step) => step.owner))).join(" · ");
                return (
                  <button
                    key={phase.id}
                    type="button"
                    onClick={() => setSelectedPhaseId(phase.id)}
                    className={`flex w-full gap-3 rounded-xl px-2.5 py-2 text-left transition ${selected ? "bg-white shadow-sm" : "hover:bg-white/70"}`}
                  >
                    <span className="flex flex-col items-center">
                      <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border text-[11px] font-black ${
                        status === "completed"
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : status === "active"
                            ? "border-pink-600 bg-pink-600 text-white"
                            : status === "blocked"
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-white text-slate-400"
                      }`}>
                        {status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : status === "blocked" ? <LockKeyhole className="h-3.5 w-3.5" /> : index + 1}
                      </span>
                      {index < rawPhases.length - 1 ? (
                        <span className={`my-0.5 min-h-[22px] w-0.5 flex-1 ${status === "completed" ? "bg-emerald-300" : "bg-slate-200"}`} />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 pb-3">
                      <span className={`block text-[13px] font-black ${
                        selected ? "text-pink-600" : status === "completed" ? "text-slate-700" : status === "blocked" ? "text-amber-700" : "text-slate-400"
                      }`}>
                        {phase.title}
                      </span>
                      <span className="mt-0.5 block text-[11.5px] font-semibold capitalize text-slate-400">{owner}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-[320px] flex-[100_1_520px]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3.5">
              <div className="min-w-0">
                <span className="text-[11px] font-black uppercase tracking-[0.07em] text-pink-600">Trilha de desligamento</span>
                <h2 className="mt-1 text-lg font-black tracking-tight text-slate-900">{selectedPhase.title}</h2>
                <p className="mt-1 max-w-[560px] text-[13px] font-medium text-slate-500">{selectedBlockedReason ?? selectedPhase.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedPhase.steps[0]?.dueAt ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-bold text-amber-700">
                    <Clock3 className="h-3.5 w-3.5" />
                    Até {dateLabel(selectedPhase.steps[0].dueAt)}
                  </span>
                ) : null}
                <PhaseBadge status={selectedStatus} />
              </div>
            </div>

            {selectedStatus === "upcoming" ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">
                Esta etapa ainda não está liberada. Conclua os requisitos anteriores para habilitar as ações.
              </div>
            ) : null}

            <div className="mt-4 space-y-4">{selectedContent}</div>
          </div>
        </div>
      </section>

      {false && ((process: CltTerminationProcess) => (
      <div className="space-y-3">
        {rawPhases.map((phase, index) => {
          const status = phaseStatus(phase.steps);
          const blockedReason = phase.steps.find((step) => step.blockedReason)?.blockedReason;
          return (
            <details
              key={phase.id}
              className={`group overflow-hidden rounded-2xl border bg-card shadow-sm ${status === "active" ? "border-sky-200 ring-1 ring-sky-100" : status === "blocked" ? "border-amber-200" : ""}`}
              open={openPhases[phase.id] ?? (status === "active" || phase.id === "notice" && !process.notice)}
              onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setOpenPhases((current) => ({ ...current, [phase.id]: isOpen }));
              }}
            >
              <summary className="flex cursor-pointer list-none items-center gap-4 p-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-bold">
                  {status === "completed" ? <PhaseIcon status={status} /> : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-slate-900">{phase.title}</h2>
                    <PhaseBadge status={status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{blockedReason ?? phase.description}</p>
                </div>
                <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>

              <div className="space-y-4 border-t bg-slate-50/60 p-4 md:p-5">
                {phase.id === "request" ? (
                  <>
                    <StepLine label="Carta e pedido protocolados" status={stepsById.get("employee_request")!.status} description={`Protocolo ${process.request.protocol}`} />
                    <StepLine label="Identidade confirmada" status={stepsById.get("identity_signature")!.status} description="Confirmação vinculada ao pedido e registrada no histórico." />
                  </>
                ) : null}

                {phase.id === "validation" ? (
                  <StepLine label="Análise da manifestação pelo RH" status={stepsById.get("hr_validation")!.status}>
                    {process.status === "hr_review"
                      ? <Button disabled={busy} onClick={() => action({ action: "validate" })}>Validar pedido</Button>
                      : undefined}
                  </StepLine>
                ) : null}

                {phase.id === "notice" ? (
                  process.notice ? (
                    <StepLine
                      label={process.notice.decision === "worked" ? "Aviso cumprido — 30 dias" : "Aviso indenizado"}
                      status="completed"
                      description={`Término em ${dateLabel(process.notice.contractEndDate)} · prazo legal em ${dateLabel(process.notice.legalPaymentDueDate)}`}
                    />
                  ) : process.hrValidation?.status === "confirmed" ? (
                    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
                      <label className="space-y-1.5 text-sm font-medium">
                        Modalidade
                        <Select value={decision} onValueChange={setDecision}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="worked">Aviso cumprido — 30 dias</SelectItem>
                            <SelectItem value="waived_with_discount">Aviso indenizado</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="space-y-1.5 text-sm font-medium">
                        Data da comunicação
                        <Input type="date" value={communicationDate} onChange={(event) => setCommunicationDate(event.target.value)} />
                      </label>
                      {decision !== "worked" ? (
                        <label className="space-y-1.5 text-sm font-medium">
                          Término do contrato
                          <Input type="date" value={contractEndDate} onChange={(event) => setContractEndDate(event.target.value)} />
                        </label>
                      ) : <div />}
                      <Button className="self-end" disabled={busy} onClick={() => action({ action: "decide_notice", decision, communicationDate, contractEndDate })}>
                        Confirmar aviso
                      </Button>
                    </div>
                  ) : <StepLine label="Definição do aviso-prévio" status="pending" description="Aguardando validação do RH." />
                ) : null}

                {phase.id === "aso" ? (
                  <>
                    <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <MiniStep label="Guia gerada" done={Boolean(asoWorkflow.latestGuideId)} active={!asoWorkflow.latestGuideId && asoStep.status === "in_progress"} />
                      <MiniStep label="Pagamento confirmado" done={asoWorkflow.paymentStatus === "paid"} active={Boolean(asoWorkflow.latestGuideId) && asoWorkflow.paymentStatus !== "paid"} />
                      <MiniStep label="Enviado à clínica" done={Boolean(asoWorkflow.clinic?.sentAt)} />
                      <MiniStep label="Agendamento confirmado" done={asoWorkflow.appointmentStatus === "confirmed"} />
                      <MiniStep label="ASO recebido" done={Boolean(asoWorkflow.asoDocument?.storagePath)} />
                      <MiniStep label="ASO aprovado pelo RH" done={asoStep.status === "completed"} blocked={asoStep.status === "blocked"} />
                    </div>
                    {process.hrValidation?.status === "confirmed" ? (
                      <Button asChild variant="outline">
                        <Link href={`/dashboard/hr/recruitment/integration?process=${process.id}`}>Abrir operação do ASO</Link>
                      </Button>
                    ) : null}
                  </>
                ) : null}

                {phase.id === "accountant" ? (
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
                ) : null}

                {phase.id === "documents" ? (
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
                ) : null}

                {phase.id === "access" ? (
                  <AccessRevocationPanel process={process} busy={busy} onAction={(body) => void action(body)} />
                ) : null}

                {phase.id === "operations" ? (
                  phase.steps.map((step) => (
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
                  ))
                ) : null}

                {phase.id === "closure" ? (
                  <>
                    {process.steps.filter((step) => step.required && step.id !== "closure" && !TERMINAL_STEP_STATUSES.includes(step.status)).length ? (
                      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                        <div>
                          <p className="font-semibold">Ainda existem etapas obrigatórias</p>
                          <p>Conclua as etapas anteriores para liberar o fechamento.</p>
                        </div>
                      </div>
                    ) : null}
                    <Button
                      disabled={busy || process.status === "completed" || process.steps.some((step) => step.required && step.id !== "closure" && !TERMINAL_STEP_STATUSES.includes(step.status))}
                      onClick={() => action({ action: "complete" })}
                    >
                      Concluir desligamento
                    </Button>
                  </>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
      ))(process!)}

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico auditável</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="border-l-2 pl-3">
              <p className="text-sm">{event.message}</p>
              <p className="text-xs text-muted-foreground">{event.actorName} · {new Date(event.at).toLocaleString("pt-BR")}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
