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

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{process.employeeName}</h1>
          <p className="text-muted-foreground">{process.request.protocol} · {process.currentSummary}</p>
        </div>
        <Badge variant="outline">{healthLabel(process.health)}</Badge>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold">{process.progress}% concluído</span>
            <span>{process.notice ? `Prazo legal: ${dateLabel(process.notice.legalPaymentDueDate)}` : "Prazo aguardando definição do aviso"}</span>
          </div>
          <Progress value={process.progress} />
          {process.notice ? (
            <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
              <span>Comunicação: <b className="text-foreground">{dateLabel(process.notice.communicationDate)}</b></span>
              <span>Término: <b className="text-foreground">{dateLabel(process.notice.contractEndDate)}</b></span>
              <span>Pagamento até: <b className="text-foreground">{dateLabel(process.notice.legalPaymentDueDate)}</b></span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}

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
