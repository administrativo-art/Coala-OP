"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  History,
  LockKeyhole,
  MailCheck,
  RefreshCw,
  Send,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import type { CltTerminationProcess, TerminationDocument, TerminationEvent, TerminationStep, TerminationStepId } from "./types";
import {
  TerminationAsoCard,
  TerminationUniformCard,
  type TerminationAsoWorkflow,
} from "./parallel-control-cards";

type ReviewDraft = {
  decision: "approved" | "correction_required";
  reason: string;
  selectedForEmployee: boolean;
  signatureMode: NonNullable<TerminationDocument["signatureMode"]>;
};

const MAIN_STAGES: Array<{ id: string; title: string; description: string; stepIds: TerminationStepId[] }> = [
  { id: "request", title: "Pedido recebido", description: "Protocolo, carta manuscrita e manifestação enviada pelo colaborador.", stepIds: ["request_received"] },
  { id: "letter", title: "Conferência da carta", description: "O RH aprova a carta ou devolve uma orientação para nova versão.", stepIds: ["letter_review"] },
  { id: "identity", title: "Identidade e formalização", description: "Depois da aprovação da carta, o colaborador assina com confirmação por SMS.", stepIds: ["identity_signature"] },
  { id: "notice", title: "Aviso-prévio e datas", description: "Registro da comunicação, modalidade do aviso, término e prazo legal.", stepIds: ["notice_decision"] },
  { id: "accountant", title: "Contabilidade", description: "Envio, retorno, conferência dos documentos, valores e eventuais correções.", stepIds: ["accountant"] },
  { id: "signatures", title: "Assinaturas rescisórias", description: "Envio dos documentos aprovados para as assinaturas aplicáveis.", stepIds: ["signatures"] },
  { id: "delivery", title: "Conclusão com o colaborador", description: "Disponibilização dos documentos finais após assinaturas e pagamento.", stepIds: ["employee_delivery"] },
  { id: "operations", title: "Encerramentos internos", description: "Bloqueio de acessos, escalas, benefícios e demais controles internos.", stepIds: ["access_revocation", "operational"] },
  { id: "closure", title: "Finalização total pelo RH", description: "Fechamento interno, inclusive com ressalvas documentadas de ASO e uniformes.", stepIds: ["closure"] },
];

const EMPLOYER_DISMISSAL_STAGES: Array<{ id: string; title: string; description: string; stepIds: TerminationStepId[] }> = [
  { id: "request", title: "Definição e comunicação", description: "Registro da conversa presencial e formalização do comunicado oficial.", stepIds: ["request_validation_notice"] },
  { id: "accountant", title: "Contabilidade e revisão", description: "Envio, retorno, conferência dos documentos, valores e eventuais correções.", stepIds: ["accountant", "document_audit"] },
  { id: "signatures", title: "Assinaturas rescisórias", description: "Envio dos documentos aprovados para as assinaturas aplicáveis.", stepIds: ["signatures"] },
  { id: "delivery", title: "Conclusão com a colaboradora", description: "Documentos finais e comprovante, depois das assinaturas e do pagamento.", stepIds: ["termination_payment", "employee_delivery"] },
  { id: "operations", title: "Encerramentos internos e acessos", description: "Bloqueio de acessos, escalas, benefícios e demais controles internos.", stepIds: ["access_revocation", "operational"] },
  { id: "closure", title: "Finalização total pelo RH", description: "Fechamento interno, inclusive com ressalvas documentadas de ASO e uniformes.", stepIds: ["closure"] },
];

const terminalStatuses = new Set(["completed", "waived", "cancelled"]);

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function money(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function stageState(steps: TerminationStep[]) {
  if (steps.length && steps.every((step) => terminalStatuses.has(step.status))) return "completed" as const;
  if (steps.some((step) => step.status === "blocked")) return "blocked" as const;
  if (steps.some((step) => ["in_progress", "waiting_external"].includes(step.status))) return "active" as const;
  return "pending" as const;
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    pending: "Pendente",
    in_progress: "Em andamento",
    waiting_external: "Aguardando terceiro",
    blocked: "Atenção necessária",
    completed: "Concluída",
    waived: "Encerrada com ressalva",
    not_started: "Ainda não iniciada",
    ready_to_send: "Pronta para envio",
    sent: "Enviada",
    documents_received: "Documentos recebidos",
    correction_requested: "Correção solicitada",
    approved: "Aprovada",
    awaiting_financial_authorization: "Aguardando financeiro",
    ready_to_submit: "Autorizado pelo financeiro",
    submitting: "Enviando ao Inter",
    awaiting_bank_approval: "Aguardando aprovação no Inter",
    scheduled: "Agendado",
    processing: "Processando no banco",
    paid: "Pago",
    not_applicable: "Sem pagamento devido",
    configuration_required: "Configuração necessária",
    failed: "Falha",
    rejected: "Rejeitado",
    worked: "Aviso trabalhado",
    indemnified: "Aviso indenizado",
    waived_no_discount: "Dispensa sem desconto",
    waived_with_discount: "Dispensa com desconto",
    exception_review: "Análise excepcional",
  };
  return labels[String(status)] ?? String(status ?? "Pendente");
}

function ownerLabel(owner?: TerminationStep["owner"]) {
  if (owner === "employee") return "Colaborador";
  if (owner === "finance") return "Financeiro";
  if (owner === "accountant") return "Contabilidade";
  if (owner === "clinic") return "Clínica";
  if (owner === "manager") return "Gestor";
  if (owner === "system") return "Sistema";
  if (owner === "employer") return "Empresa";
  return "RH";
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

function StatusIcon({ state }: { state: "completed" | "blocked" | "active" | "pending" }) {
  if (state === "completed") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (state === "blocked") return <LockKeyhole className="h-5 w-5 text-amber-600" />;
  if (state === "active") return <Clock3 className="h-5 w-5 text-pink-600" />;
  return <Circle className="h-5 w-5 text-slate-300" />;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</p><div className="mt-1 text-sm font-bold text-slate-800">{value}</div></div>;
}

export function EmployeeResignationDetail({
  process,
  events,
  asoWorkflow,
  busy,
  error,
  onAction,
}: {
  process: CltTerminationProcess;
  events: TerminationEvent[];
  asoWorkflow: TerminationAsoWorkflow;
  busy: boolean;
  error: string | null;
  onAction: (body: Record<string, unknown>) => Promise<void>;
}) {
  const { firebaseUser } = useAuth();
  const [selectedStageId, setSelectedStageId] = useState("");
  const [letterNotes, setLetterNotes] = useState("");
  const [noticeDecision, setNoticeDecision] = useState("worked");
  const submittedDate = process.request.submittedAt.slice(0, 10);
  const [communicationDate, setCommunicationDate] = useState(submittedDate);
  const [contractEndDate, setContractEndDate] = useState(addDays(submittedDate, 30));
  const [noticeNotes, setNoticeNotes] = useState("");
  const [accountantEmail, setAccountantEmail] = useState(process.accountant?.recipientEmail ?? "");
  const [employeeEmail, setEmployeeEmail] = useState(process.employeeCompletion?.recipientEmail ?? process.employeeEmail);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [pendingUniformPieces, setPendingUniformPieces] = useState<number | null>(null);
  const [scheduleRemoved, setScheduleRemoved] = useState(process.operational?.scheduleRemoved === true);
  const [benefitsClosed, setBenefitsClosed] = useState(process.operational?.benefitsClosed === true);
  const [assetsReturned, setAssetsReturned] = useState(process.operational?.assetsReturned === true);
  const [operationNotes, setOperationNotes] = useState(process.operational?.notes ?? "");
  const [uniformReservation, setUniformReservation] = useState("");
  const [asoReservation, setAsoReservation] = useState("");
  const [showRefusal, setShowRefusal] = useState(false);
  const [refusalWitnesses, setRefusalWitnesses] = useState("");
  const [refusalNotes, setRefusalNotes] = useState("");

  const stepsById = useMemo(() => new Map(process.steps.map((step) => [step.id, step])), [process.steps]);
  const isEmployerDismissal = process.processType === "clt_hr_termination" && process.terminationReason === "Dispensa sem justa causa" && Boolean(process.dismissalCommunication);
  const stageDefinitions = isEmployerDismissal ? EMPLOYER_DISMISSAL_STAGES : MAIN_STAGES;
  const stages = stageDefinitions.map((stage) => ({ ...stage, steps: stage.stepIds.map((id) => stepsById.get(id)).filter((step): step is TerminationStep => Boolean(step)) }));
  const defaultStage = stages.find((stage) => stageState(stage.steps) === "active")
    ?? stages.find((stage) => stageState(stage.steps) === "blocked")
    ?? stages.find((stage) => stageState(stage.steps) === "pending")
    ?? stages[stages.length - 1];
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) ?? defaultStage;
  const letter = process.documents.find((document) => document.type === "resignation_letter" && document.isCurrent !== false);
  const dismissalNotice = process.documents.find((document) => document.type === "dismissal_notice" && document.isCurrent !== false);
  const accountantDocuments = process.documents.filter((document) => document.type === "accountant_document" && document.isCurrent !== false);
  const asoStep = stepsById.get("aso");
  const uniformStep = stepsById.get("uniform_return");
  const accessDone = stepsById.get("access_revocation")?.status === "completed";
  const operationsDone = stepsById.get("operational")?.status === "completed";
  const employeeDone = process.employeeCompletion?.status === "completed";

  async function openAsset(query: string) {
    if (!firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/hr/terminations/${process.id}/asset?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      window.alert(body.error ?? "Não foi possível abrir o arquivo.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function reviewFor(document: TerminationDocument): ReviewDraft {
    return reviewDrafts[document.id] ?? {
      decision: document.auditStatus === "correction_required" ? "correction_required" : "approved",
      reason: document.correctionReason ?? "",
      selectedForEmployee: document.selectedForEmployee !== false,
      signatureMode: document.signatureMode ?? (document.documentKind === "trct" ? "both" : "delivery_only"),
    };
  }

  function patchReview(id: string, patch: Partial<ReviewDraft>) {
    const document = accountantDocuments.find((item) => item.id === id);
    if (!document) return;
    setReviewDrafts((current) => ({ ...current, [id]: { ...reviewFor(document), ...patch } }));
  }

  let content: ReactNode = null;
  if (selectedStage.id === "request") {
    if (isEmployerDismissal && process.dismissalCommunication) {
      const communication = process.dismissalCommunication;
      const noticeState = communication.officialNoticeStatus;
      content = <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3"><InfoRow label="Comunicação presencial" value={new Date(communication.occurredAt).toLocaleString("pt-BR")} /><InfoRow label="Local" value={communication.location} /><InfoRow label="Responsável" value={communication.responsibleName} /><InfoRow label="Outros participantes" value={communication.participants.join(", ") || "Não informados"} /><InfoRow label="Aviso-prévio" value={statusLabel(process.notice?.decision)} /><InfoRow label="Último dia" value={dateLabel(process.notice?.contractEndDate)} /><InfoRow label="Motivo interno e confidencial" value={process.terminationInternalReason || "Não informado"} /><InfoRow label="Observações internas" value={process.terminationNotes || "Sem observações"} /></div>
        <div className={`rounded-xl border p-4 ${noticeState === "signed" || noticeState === "refusal_formalized" ? "border-emerald-200 bg-emerald-50" : noticeState === "failed" ? "border-rose-200 bg-rose-50" : "border-sky-200 bg-sky-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">Comunicado oficial</p><p className="mt-1 text-sm font-medium">{noticeState === "signed" ? "Assinado pela empresa e pela colaboradora." : noticeState === "refusal_formalized" ? "Recusa formalizada com testemunhas." : noticeState === "failed" ? communication.officialNoticeError ?? "Falha ao preparar o comunicado." : "Aguardando assinatura eletrônica."}</p></div>{dismissalNotice ? <Button variant="outline" onClick={() => void openAsset(`documentId=${encodeURIComponent(dismissalNotice.id)}`)}><ExternalLink className="h-4 w-4" />Abrir comunicado</Button> : null}</div>
        </div>
        {noticeState === "failed" ? <Button disabled={busy} onClick={() => void onAction({ action: "retry_dismissal_notice" })}><RefreshCw className="h-4 w-4" />Gerar e enviar novamente</Button> : null}
        {!["signed", "refusal_formalized"].includes(noticeState) ? <div className="rounded-xl border bg-white p-4"><Button type="button" variant="outline" onClick={() => setShowRefusal((value) => !value)}>Registrar recusa de assinatura</Button>{showRefusal ? <div className="mt-4 space-y-3"><label className="block text-sm font-black">Testemunhas<Textarea className="mt-2" value={refusalWitnesses} onChange={(event) => setRefusalWitnesses(event.target.value)} placeholder="Informe pelo menos dois nomes, separados por vírgula ou linha." /></label><label className="block text-sm font-black">Descrição da recusa<Textarea className="mt-2" value={refusalNotes} onChange={(event) => setRefusalNotes(event.target.value)} placeholder="Registre quando e como a recusa ocorreu." /></label><Button disabled={busy} onClick={() => void onAction({ action: "formalize_dismissal_notice_refusal", witnessNames: refusalWitnesses.split(/[,\n]/).map((value) => value.trim()).filter(Boolean), notes: refusalNotes })}>Formalizar recusa e liberar contabilidade</Button></div> : null}</div> : null}
      </div>;
    } else {
      content = <div className="grid gap-3 sm:grid-cols-3"><InfoRow label="Protocolo" value={process.request.protocol} /><InfoRow label="Recebido em" value={new Date(process.request.submittedAt).toLocaleString("pt-BR")} /><InfoRow label="Preferência de aviso" value={process.request.noticePreference === "work" ? "Pretende cumprir" : "Solicita dispensa"} /><InfoRow label="Último dia desejado" value={dateLabel(process.request.desiredLastDay)} /><InfoRow label="Carta manuscrita" value="Confirmada pelo colaborador" /><InfoRow label="Observação" value={process.request.notes || "Sem observação"} /></div>;
    }
  } else if (selectedStage.id === "letter") {
    content = (
      <div className="space-y-4">
        {letter ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4"><div className="flex gap-3"><FileText className="h-5 w-5 text-pink-600" /><div><p className="font-black">{letter.label}</p><p className="text-xs text-slate-500">{letter.fileName} · versão {letter.version ?? 1}</p></div></div><Button variant="outline" onClick={() => void openAsset(`documentId=${encodeURIComponent(letter.id)}`)}><ExternalLink className="h-4 w-4" />Abrir carta</Button></div> : null}
        {process.hrValidation?.status === "correction_requested" ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900"><b>Correção enviada ao colaborador:</b><p className="mt-1">{process.hrValidation.notes}</p></div> : null}
        {stepsById.get("letter_review")?.status === "completed" ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Carta aprovada. O comprovante eletrônico foi encaminhado para assinatura com confirmação por SMS.</div> : (
          <div className="space-y-3 rounded-xl border bg-white p-4"><label className="text-sm font-black">Parecer ou orientação<Textarea className="mt-2" value={letterNotes} onChange={(event) => setLetterNotes(event.target.value)} placeholder="Obrigatório quando houver correção ou exceção." /></label><div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void onAction({ action: "review_letter", decision: "approved", notes: letterNotes })}><FileCheck2 className="h-4 w-4" />Aprovar carta e solicitar assinatura</Button><Button variant="outline" disabled={busy} onClick={() => void onAction({ action: "review_letter", decision: "correction_requested", notes: letterNotes })}>Solicitar nova versão</Button><Button variant="outline" disabled={busy} onClick={() => void onAction({ action: "review_letter", decision: "exception_review", notes: letterNotes })}>Marcar análise excepcional</Button></div></div>
        )}
      </div>
    );
  } else if (selectedStage.id === "identity") {
    const signed = ["verified", "manual_verified"].includes(process.request.identityStatus);
    content = <div className={`rounded-xl border p-5 ${signed ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}><div className="flex gap-3">{signed ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <Clock3 className="h-6 w-6 text-sky-600" />}<div><p className="font-black">{signed ? "Identidade confirmada e pedido formalizado" : process.request.identityStatus === "not_requested" ? "Aguardando aprovação da carta" : "Aguardando assinatura do colaborador"}</p><p className="mt-1 text-sm font-medium">{signed ? `Formalizado em ${process.request.formalizedAt ? new Date(process.request.formalizedAt).toLocaleString("pt-BR") : "data registrada"}.` : process.request.identityStatus === "pending_signature" ? "O colaborador recebeu o link da assinatura eletrônica com confirmação por SMS." : "A assinatura só será criada depois que o RH aprovar a carta."}</p></div></div></div>;
  } else if (selectedStage.id === "notice") {
    content = process.notice ? <div className="grid gap-3 sm:grid-cols-4"><InfoRow label="Decisão" value={statusLabel(process.notice.decision)} /><InfoRow label="Comunicação" value={dateLabel(process.notice.communicationDate)} /><InfoRow label="Término" value={dateLabel(process.notice.contractEndDate)} /><InfoRow label="Pagamento até" value={dateLabel(process.notice.legalPaymentDueDate)} /></div> : (
      <div className="space-y-4 rounded-xl border bg-white p-4"><div className="grid gap-4 md:grid-cols-2"><label className="space-y-2 text-sm font-black">Modalidade<Select value={noticeDecision} onValueChange={(value) => { setNoticeDecision(value); setContractEndDate(value === "worked" ? addDays(communicationDate, 30) : communicationDate); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="worked">Aviso trabalhado</SelectItem><SelectItem value="waived_no_discount">Dispensa sem desconto</SelectItem><SelectItem value="waived_with_discount">Dispensa com desconto</SelectItem><SelectItem value="exception_review">Análise excepcional</SelectItem></SelectContent></Select></label><label className="space-y-2 text-sm font-black">Data efetiva da comunicação<Input type="date" value={communicationDate} onChange={(event) => { const value = event.target.value; setCommunicationDate(value); setContractEndDate(noticeDecision === "worked" ? addDays(value, 30) : value); }} /></label><label className="space-y-2 text-sm font-black">Data de término do contrato<Input type="date" value={contractEndDate} onChange={(event) => setContractEndDate(event.target.value)} /></label><label className="space-y-2 text-sm font-black">Observação<Textarea value={noticeNotes} onChange={(event) => setNoticeNotes(event.target.value)} /></label></div><Button disabled={busy || !["verified", "manual_verified"].includes(process.request.identityStatus)} onClick={() => void onAction({ action: "decide_notice", decision: noticeDecision, communicationDate, contractEndDate, notes: noticeNotes })}>Confirmar aviso e liberar contabilidade</Button></div>
    );
  } else if (selectedStage.id === "accountant") {
    content = (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4"><InfoRow label="Situação" value={statusLabel(process.accountant?.status)} /><InfoRow label="Bruto" value={money(process.accountant?.grossAmount)} /><InfoRow label="Descontos" value={money(process.accountant?.discountAmount)} /><InfoRow label="Líquido para o financeiro" value={process.accountant?.noPaymentDue ? "Sem pagamento" : money(process.accountant?.netAmount)} /></div>
        {process.accountant?.status === "ready_to_send" ? <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row"><Input type="email" value={accountantEmail} onChange={(event) => setAccountantEmail(event.target.value)} placeholder="E-mail da contabilidade" /><Button disabled={busy || !accountantEmail} onClick={() => void onAction({ action: "send_accountant", recipientEmail: accountantEmail })}><Send className="h-4 w-4" />Enviar informações e portal</Button></div> : null}
        {process.accountant?.status === "sent" ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">Aguardando a contabilidade anexar o TRCT, o demonstrativo e os valores pelo link seguro.</div> : null}
        {process.accountant?.correctionMessage ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900"><b>Devolutiva enviada:</b><p className="mt-1 whitespace-pre-line">{process.accountant.correctionMessage}</p></div> : null}
        {accountantDocuments.map((document) => {
          const draft = reviewFor(document);
          return <div key={document.id} className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-black">{document.label} · v{document.version ?? 1}</p><p className="text-xs text-slate-500">{document.fileName}</p></div><Button variant="outline" size="sm" onClick={() => void openAsset(`documentId=${encodeURIComponent(document.id)}`)}><ExternalLink className="h-4 w-4" />Conferir</Button></div><div className="grid gap-3 md:grid-cols-3"><label className="space-y-1 text-xs font-black">Decisão<Select value={draft.decision} onValueChange={(value) => patchReview(document.id, { decision: value as ReviewDraft["decision"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="approved">Aprovar</SelectItem><SelectItem value="correction_required">Devolver para correção</SelectItem></SelectContent></Select></label><label className="space-y-1 text-xs font-black">Tratamento<Select value={draft.signatureMode} onValueChange={(value) => patchReview(document.id, { signatureMode: value as ReviewDraft["signatureMode"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">Assinam colaborador e empresa</SelectItem><SelectItem value="employee">Assina o colaborador</SelectItem><SelectItem value="company">Assina a empresa</SelectItem><SelectItem value="delivery_only">Somente entregar</SelectItem><SelectItem value="internal_only">Somente interno</SelectItem></SelectContent></Select></label><label className="flex items-center gap-2 self-end rounded-lg border p-2.5 text-xs font-bold"><Checkbox checked={draft.selectedForEmployee} onCheckedChange={(checked) => patchReview(document.id, { selectedForEmployee: checked === true })} />Incluir no pacote final</label></div>{draft.decision === "correction_required" ? <Textarea value={draft.reason} onChange={(event) => patchReview(document.id, { reason: event.target.value })} placeholder="Explique objetivamente o que precisa ser corrigido." /> : null}</div>;
        })}
        {accountantDocuments.length && ["documents_received", "correction_requested"].includes(process.accountant?.status ?? "") ? <Button disabled={busy} onClick={() => void onAction({ action: "audit_documents", reviews: accountantDocuments.map((document) => ({ id: document.id, ...reviewFor(document) })) })}><FileCheck2 className="h-4 w-4" />Registrar revisão dos documentos e valores</Button> : null}
        {process.accountant?.status === "approved" ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Documentos e valor líquido aprovados. A solicitação de pagamento foi criada automaticamente para o financeiro.</div> : null}
      </div>
    );
  } else if (selectedStage.id === "signatures") {
    const signatureStep = stepsById.get("signatures");
    content = <div className="space-y-4"><div className="rounded-xl border bg-white p-4"><p className="font-black">{statusLabel(signatureStep?.status)}</p><p className="mt-1 text-sm text-slate-500">Somente documentos aprovados e configurados para assinatura são encaminhados. Arquivos de simples entrega permanecem no pacote final.</p></div>{signatureStep?.status === "in_progress" ? <Button disabled={busy} onClick={() => void onAction({ action: "send_signatures" })}><Send className="h-4 w-4" />Enviar documentos para assinatura</Button> : null}</div>;
  } else if (selectedStage.id === "delivery") {
    const communication = process.employeeCompletion?.communication;
    content = <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><InfoRow label="Assinaturas" value={statusLabel(stepsById.get("signatures")?.status)} /><InfoRow label="Pagamento" value={statusLabel(process.payment?.status)} /><InfoRow label="Entrega" value={statusLabel(process.employeeCompletion?.status)} /></div>{employeeDone ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><p className="font-black">Relação concluída com o colaborador</p><p className="mt-1">Pacote enviado para {process.employeeCompletion?.recipientEmail}. Entrega: {communication?.deliveredAt ? new Date(communication.deliveredAt).toLocaleString("pt-BR") : statusLabel(communication?.status)}. Abertura detectada: {communication?.openedAt ? new Date(communication.openedAt).toLocaleString("pt-BR") : "ainda não"}.</p></div> : <div className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row"><Input type="email" value={employeeEmail} onChange={(event) => setEmployeeEmail(event.target.value)} /><Button disabled={busy || process.employeeCompletion?.status !== "ready"} onClick={() => void onAction({ action: "send_employee_package", recipientEmail: employeeEmail })}><MailCheck className="h-4 w-4" />Enviar documentos e concluir com o colaborador</Button></div>}</div>;
  } else if (selectedStage.id === "operations") {
    const contractReached = Boolean(process.notice && new Date().toISOString().slice(0, 10) >= process.notice.contractEndDate);
    const accessRows = [{ target: "pdv", label: "PDV Legal", status: process.accessRevocation?.pdv.status }, { target: "bizneo", label: "Bizneo", status: process.accessRevocation?.bizneo.status }, { target: "healthPlan", label: "Plano de saúde", status: process.accessRevocation?.healthPlan.status }] as const;
    content = <div className="space-y-4"><div className="space-y-2 rounded-xl border bg-white p-4">{accessRows.map((row) => <div key={row.target} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><p className="font-black">{row.label}</p><p className="text-xs text-slate-500">{statusLabel(row.status)}</p></div>{!["completed", "not_applicable"].includes(row.status ?? "") ? <Button variant="outline" size="sm" disabled={busy || !employeeDone || !contractReached} onClick={() => void onAction({ action: "revoke_access", target: row.target })}>{row.target === "pdv" ? "Remover pela API" : "Confirmar encerramento"}</Button> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}</div>)}</div><div className="space-y-3 rounded-xl border bg-white p-4"><label className="flex items-center gap-3 text-sm font-bold"><Checkbox checked={scheduleRemoved} onCheckedChange={(checked) => setScheduleRemoved(checked === true)} />Retirado das escalas</label><label className="flex items-center gap-3 text-sm font-bold"><Checkbox checked={benefitsClosed} onCheckedChange={(checked) => setBenefitsClosed(checked === true)} />Benefícios aplicáveis encerrados</label><label className="flex items-center gap-3 text-sm font-bold"><Checkbox checked={assetsReturned} onCheckedChange={(checked) => setAssetsReturned(checked === true)} />Outros bens e materiais devolvidos ou tratados</label><Textarea value={operationNotes} onChange={(event) => setOperationNotes(event.target.value)} placeholder="Observações internas" /><Button disabled={busy || !employeeDone || !accessDone || operationsDone} onClick={() => void onAction({ action: "complete_operations", scheduleRemoved, benefitsClosed, assetsReturned, notes: operationNotes })}>{operationsDone ? "Encerramentos concluídos" : "Concluir encerramentos internos"}</Button></div></div>;
  } else if (selectedStage.id === "closure") {
    const asoComplete = ["completed", "waived"].includes(asoStep?.status ?? "");
    const uniformComplete = ["completed", "waived"].includes(uniformStep?.status ?? "") || pendingUniformPieces === 0;
    content = process.status === "completed" ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900"><p className="font-black">Processo totalmente finalizado</p><p className="mt-1 text-sm font-medium">{process.internalClosure?.status === "completed_with_reservations" ? "Finalizado com ressalvas internas registradas e comunicadas ao colaborador." : "Finalizado sem pendências."}</p>{process.internalClosure?.communication ? <p className="mt-2 text-xs font-semibold">Abertura do e-mail detectada: {process.internalClosure.communication.openedAt ? new Date(process.internalClosure.communication.openedAt).toLocaleString("pt-BR") : "ainda não"}. Esse registro indica abertura técnica, não comprova ciência do conteúdo.</p> : null}</div> : <div className="space-y-4"><div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold text-sky-900">ASO e uniformes bloqueiam somente esta finalização total. O processo com o colaborador já pode estar concluído.</div>{!uniformComplete ? <label className="block space-y-2 text-sm font-black">Ressalva — uniformes não devolvidos<Textarea value={uniformReservation} onChange={(event) => setUniformReservation(event.target.value)} placeholder="Registre as peças pendentes e as tentativas de devolução." /></label> : null}{!asoComplete ? <label className="block space-y-2 text-sm font-black">Ressalva — não comparecimento ao ASO<Textarea value={asoReservation} onChange={(event) => setAsoReservation(event.target.value)} placeholder="Disponível somente depois de um agendamento vencido." /></label> : null}<Button disabled={busy || !operationsDone} onClick={() => { const reservations = []; if (!uniformComplete) reservations.push({ type: "uniforms_not_returned", note: uniformReservation }); if (!asoComplete) reservations.push({ type: "aso_no_show", note: asoReservation }); void onAction({ action: isEmployerDismissal ? "complete_guided_termination" : "complete_resignation", reservations, recipientEmail: employeeEmail }); }}>Finalizar totalmente o desligamento{!uniformComplete || !asoComplete ? " com ressalvas" : ""}</Button></div>;
  }

  const completedMain = stages.filter((stage) => stageState(stage.steps) === "completed").length;
  const nextPrimaryStep = defaultStage.steps.find((step) => !terminalStatuses.has(step.status)) ?? defaultStage.steps[0];
  const nextActionLabel = process.status === "completed" ? "Processo concluído" : defaultStage.title;
  const nextActionOwner = ownerLabel(nextPrimaryStep?.owner);
  return (
    <div className="min-h-full bg-[#f0eee9] px-4 py-5 text-slate-950 sm:px-7 sm:py-7">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-3"><Button asChild variant="outline" className="rounded-xl bg-white"><Link href="/dashboard/dp/terminations"><ArrowLeft className="h-4 w-4" />Voltar</Link></Button><Badge className="bg-pink-100 text-pink-700 hover:bg-pink-100">{isEmployerDismissal ? "Dispensa sem justa causa" : "Pedido de demissão"}</Badge><span className="ml-auto font-mono text-xs text-slate-400">{process.request.protocol}</span></div>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : null}
        <section className="overflow-hidden rounded-[24px] border bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5 p-5 sm:p-7">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-black uppercase tracking-[0.1em] text-pink-600">
                  {isEmployerDismissal ? "Desligamento CLT iniciado pela empresa" : "Desligamento CLT solicitado pelo colaborador"}
                </p>
                <Badge variant="outline" className={`rounded-full text-[10px] font-black ${
                  process.health === "on_track" || process.health === "completed"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : process.health === "overdue" || process.health === "blocked"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                }`}>
                  {healthLabel(process.health)}
                </Badge>
              </div>
              <h1 className="mt-2 text-2xl font-black">{process.employeeName}</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">{process.jobRoleName ?? "Cargo não informado"} · Unidade de trabalho: {process.unitName ?? "não informada"}</p>
              <p className={`mt-2 text-xs font-black ${process.employer ? "text-emerald-700" : "text-amber-700"}`}>
                {process.employer ? `Empregadora: ${process.employer.legalName} · ${CnpjValidator.format(process.employer.cnpj)}` : "CNPJ empregador pendente"}
              </p>
            </div>
            <div className="w-full max-w-[250px]">
              <div className="flex items-end justify-between gap-3">
                <div><p className="text-3xl font-black text-pink-600">{process.progress}%</p><p className="text-xs font-bold text-slate-400">progresso geral</p></div>
                <div className="text-right"><p className="text-lg font-black text-slate-700">{completedMain}/{stages.length}</p><p className="text-[10px] font-bold text-slate-400">etapas principais</p></div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-pink-600 transition-[width]" style={{ width: `${Math.max(0, Math.min(process.progress, 100))}%` }} />
              </div>
            </div>
          </div>
          <div className="grid gap-px border-t bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-[#fbfaf7] px-5 py-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Tipo</p><p className="mt-1.5 text-xs font-extrabold text-slate-700">{process.terminationReason ?? (isEmployerDismissal ? "Dispensa sem justa causa" : "Pedido de demissão")}</p></div>
            <div className="bg-[#fbfaf7] px-5 py-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Último dia</p><p className="mt-1.5 inline-flex items-center gap-2 text-xs font-extrabold text-slate-700"><CalendarDays className="h-3.5 w-3.5 text-slate-400" />{dateLabel(process.notice?.contractEndDate ?? process.request.desiredLastDay)}</p></div>
            <div className="bg-[#fbfaf7] px-5 py-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Próxima ação</p><p className="mt-1.5 text-xs font-extrabold text-slate-700">{nextActionLabel}</p></div>
            <div className="bg-[#fbfaf7] px-5 py-4"><p className="text-[9px] font-black uppercase tracking-[0.1em] text-slate-400">Responsável</p><p className="mt-1.5 text-xs font-extrabold text-slate-700">{nextActionOwner}</p></div>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.11em] text-pink-600">Controles paralelos</p>
            <h2 className="mt-1.5 text-lg font-black text-slate-950">ASO, uniformes e pagamento avançam junto das etapas principais</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Cada card mostra a situação atual e a próxima ação disponível.</p>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <TerminationUniformCard
              collaborator={{ id: process.employeeId, username: process.employeeName, email: process.employeeEmail }}
              step={uniformStep}
              pendingPieces={pendingUniformPieces}
              busy={busy}
              description={`Disponível desde ${isEmployerDismissal ? "a comunicação presencial" : "o envio da carta"}.`}
              onPossessionChange={setPendingUniformPieces}
              onValidate={() => onAction({ action: "sync_uniform_return" })}
            />
            <TerminationAsoCard processId={process.id} workflow={asoWorkflow} step={asoStep} />
            <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">
              <div className="border-b border-emerald-100 bg-emerald-50/60 p-4">
                <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><WalletCards className="h-5 w-5" /></span><div><p className="font-black">Pagamento rescisório</p><p className="mt-0.5 text-xs font-semibold text-slate-500">Disponível após a aprovação da contabilidade.</p></div></div>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <div className="grid gap-2"><InfoRow label="Situação" value={statusLabel(process.payment?.status)} /><InfoRow label="Valor e prazo" value={`${money(process.payment?.amount)} · ${dateLabel(process.payment?.dueAt)}`} /></div>
                {process.payment?.lastError ? <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800">{process.payment.lastError}</p> : null}
                <div className="mt-auto flex flex-wrap gap-2 pt-4">{process.payment?.requestId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void onAction({ action: "sync_payment" })}><RefreshCw className="h-4 w-4" />Atualizar</Button> : process.payment?.status === "configuration_required" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void onAction({ action: "prepare_payment" })}><RefreshCw className="h-4 w-4" />Tentar novamente</Button> : null}{process.payment?.proofStoragePath ? <Button size="sm" variant="outline" onClick={() => void openAsset("paymentProof=1")}><Download className="h-4 w-4" />Comprovante</Button> : null}</div>
              </div>
            </article>
          </div>
        </section>

        <section className="grid overflow-hidden rounded-[24px] border bg-white shadow-sm xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="border-b bg-[#fbfaf7] p-4 xl:border-b-0 xl:border-r"><p className="mb-3 px-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Etapas principais</p><div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-1">{stages.map((stage, index) => { const state = stageState(stage.steps); const selected = stage.id === selectedStage.id; return <button type="button" key={stage.id} onClick={() => setSelectedStageId(stage.id)} className={`flex items-start gap-3 rounded-xl p-3 text-left ${selected ? "bg-white shadow-sm ring-1 ring-pink-100" : "hover:bg-white/70"}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-white text-xs font-black">{state === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : index + 1}</span><span><span className={`block text-sm font-black ${selected ? "text-pink-700" : "text-slate-700"}`}>{stage.title}</span><span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400"><StatusIcon state={state} />{statusLabel(stage.steps[0]?.status)}</span></span></button>; })}</div></aside>
          <div className="min-w-0 p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[0.1em] text-pink-600">Etapa {stages.findIndex((stage) => stage.id === selectedStage.id) + 1} de {stages.length}</p><h2 className="mt-2 text-xl font-black">{selectedStage.title}</h2><p className="mt-1 text-sm font-medium text-slate-500">{selectedStage.description}</p></div><StatusIcon state={stageState(selectedStage.steps)} /></div><div className="mt-5">{content}</div></div>
        </section>

        <section className="rounded-[24px] border bg-white p-5 shadow-sm sm:p-7"><div className="flex items-center gap-3"><History className="h-5 w-5 text-slate-500" /><div><h3 className="font-black">Histórico auditável</h3><p className="text-xs text-slate-400">{events.length} evento(s) registrado(s)</p></div></div><div className="mt-4 divide-y">{events.map((event) => <div key={event.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-bold text-slate-800">{event.message}</p><p className="text-xs text-slate-400">{event.actorName}</p></div><time className="font-mono text-xs text-slate-400">{new Date(event.at).toLocaleString("pt-BR")}</time></div>)}</div></section>
      </div>
    </div>
  );
}
