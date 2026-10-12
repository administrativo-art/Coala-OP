"use client";

import Link from "next/link";
import { BulkBar } from "@/components/patterns/bulk-bar";
import { ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { HeroChip } from "@/components/patterns/hero-chip";
import { LiftRow } from "@/components/patterns/lift-row";
import { PageHero } from "@/components/patterns/page-hero";
import { Segmented } from "@/components/patterns/segmented";
import { SidePanel } from "@/components/patterns/side-panel";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CircleDot,
  Download,
  ExternalLink,
  FileText,
  History,
  Inbox,
  Landmark,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import {
  financialInboxStageForStatus,
  isFinancialInboxBulkDiscardEligible,
} from "./presentation";
import { resolutionForDisplay } from "./resolution-contract";
import { equivalentSupplier } from "./expense-suggestions";
import { groupFinancialInboxMessages } from "./message-groups";
import { trustedFinancialDocumentProvider } from "./trusted-document-providers";
import type {
  FinancialInboxAutomationSettings,
  FinancialInboxBillingIdentity,
  FinancialInboxExpenseAlternative,
  FinancialInboxMessage,
  FinancialInboxFinancialState,
  FinancialInboxResolutionKind,
  FinancialInboxStage,
  FinancialInboxStatus,
  FinancialInboxSummary,
  FinancialInboxView,
} from "./types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<FinancialInboxStatus, string> = {
  pending_review: "Aguardando revisão",
  document_pending: "Documento pendente",
  suggestion_available: "Sugestão disponível",
  under_review: "Em análise",
  identified: "Identificada",
  linked: "Vinculada",
  awaiting_authorization: "Aguardando autorização",
  scheduled: "Agendada",
  awaiting_statement: "Aguardando extrato",
  reconciled: "Conciliada",
  divergent: "Divergente",
  ignored: "Ignorada",
  archived: "Arquivada",
  error: "Erro",
};

const STATUS_PILL: Record<FinancialInboxStatus, StatusPillVariant> = {
  pending_review: "warn",
  document_pending: "warn",
  suggestion_available: "info",
  under_review: "info",
  identified: "ok",
  linked: "info",
  awaiting_authorization: "info",
  scheduled: "info",
  awaiting_statement: "info",
  reconciled: "ok",
  divergent: "warn",
  ignored: "neutral",
  archived: "neutral",
  error: "danger",
};

const TYPE_LABEL: Record<FinancialInboxMessage["classification"]["documentType"], string> = {
  fgts: "FGTS",
  inss_darf: "INSS / DARF",
  accounting_fee: "Honorário contábil",
  tax: "Tributo",
  utility_bill: "Conta de consumo",
  charge: "Cobrança",
  other: "A classificar",
};

const FISCAL_KIND_LABEL = {
  das: "DAS — Simples Nacional",
  darf: "DARF",
  dctfweb: "DCTFWeb",
  dare: "DARE estadual",
  fgts: "FGTS",
  municipal_tax: "Arrecadação municipal",
  other: "Guia fiscal",
} as const;

const WORK_STAGE_OPTIONS: Array<{ value: FinancialInboxStage | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "classify", label: "Classificar" },
  { value: "link", label: "Confirmar" },
  { value: "pay", label: "Preparar" },
  { value: "bank", label: "No banco" },
];

type AuditFilter = "all" | "reminder" | "new_charge" | "scheduled" | "reconciled" | "off" | "archive";

const AUDIT_FILTER_OPTIONS: Array<{ value: AuditFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "reminder", label: "Lembretes" },
  { value: "new_charge", label: "Novas cobranças" },
  { value: "scheduled", label: "Agendadas" },
  { value: "reconciled", label: "Conciliadas" },
  { value: "off", label: "Descartadas" },
  { value: "archive", label: "Arquivadas" },
];

const RESOLUTION_KIND_LABEL: Record<FinancialInboxResolutionKind, string> = {
  new_charge: "Nova cobrança",
  reminder: "Lembrete",
  duplicate: "Duplicata",
  forecast_confirmation: "Confirmação de previsão",
  non_financial: "Não financeira",
};

const FINANCIAL_STATE_LABEL: Record<FinancialInboxFinancialState, string> = {
  forecast: "Somente prevista",
  open: "Despesa aberta",
  payment_prepared: "Pagamento preparado",
  scheduled: "Pagamento agendado",
  reconciled: "Pagamento conciliado",
};

const EMPTY_SUMMARY: FinancialInboxSummary = {
  total: { count: 0, amountCents: 0 },
  stages: {
    classify: { count: 0, amountCents: 0 },
    link: { count: 0, amountCents: 0 },
    pay: { count: 0, amountCents: 0 },
    bank: { count: 0, amountCents: 0 },
    done: { count: 0, amountCents: 0 },
    off: { count: 0, amountCents: 0 },
    archive: { count: 0, amountCents: 0 },
  },
  generatedAt: "",
};

type Confirmation =
  | { kind: "discard"; ids: string[] }
  | { kind: "link"; message: FinancialInboxMessage; alternative?: FinancialInboxExpenseAlternative; resolutionOnly?: boolean }
  | { kind: "create"; message: FinancialInboxMessage }
  | { kind: "payment"; message: FinancialInboxMessage }
  | { kind: "external"; url: string; domain: string; provider: string };

type ComparisonRow = {
  label: string;
  received: string;
  registered: string;
  state: "same" | "different" | "missing" | "enrich";
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Belem",
      });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCompetence(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month] = value.split("-");
  return year && month ? `${month}/${year}` : value;
}

function formatAmount(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function senderLabel(message: FinancialInboxMessage) {
  return message.classification.supplierName || message.from;
}

function installmentLabel(message: FinancialInboxMessage) {
  const suggestion = message.existingExpenseSuggestion;
  if (!suggestion?.installmentNumber) return null;
  return suggestion.installmentTotal
    ? `Parcela ${suggestion.installmentNumber}/${suggestion.installmentTotal}`
    : `Parcela ${suggestion.installmentNumber}`;
}

function identityValue(identity: FinancialInboxBillingIdentity | null | undefined, field: "account" | "contract" | "phone") {
  if (field === "account") return identity?.customerAccount || "—";
  if (field === "contract") return identity?.contractNumber || "—";
  return identity?.serviceNumbers?.join(", ") || "—";
}

function maskedTaxId(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  return "—";
}

function normalizedComparable(value: string) {
  const accentless = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const digits = accentless.replace(/\D/g, "");
  return digits || accentless.replace(/[^a-z0-9]/g, "");
}

function comparisonState(received: string, registered: string): ComparisonRow["state"] {
  if (received === "—" || registered === "—") return "missing";
  return normalizedComparable(received) === normalizedComparable(registered) ? "same" : "different";
}

function comparisonRows(message: FinancialInboxMessage): ComparisonRow[] {
  const expense = message.existingExpenseSuggestion;
  const provision = message.provisionSuggestion;
  const target = expense && ["suggested", "linked"].includes(expense.status) ? expense : provision;
  if (!target || !["suggested", "linked"].includes(target.status)) return [];
  const supplierMatches = equivalentSupplier(message.classification.supplierName, target.supplier)
    || Boolean(expense?.reasons.some((reason) => reason === "mesmo CNPJ do fornecedor"));
  const rows: ComparisonRow[] = [
    {
      label: message.classification.fiscalIdentity ? "Beneficiário / arrecadador" : "Fornecedor / beneficiário",
      received: message.classification.supplierName || "—",
      registered: target.supplier || "—",
      state: supplierMatches ? "same" : "missing",
    },
    {
      label: "Competência",
      received: formatCompetence(message.classification.competence),
      registered: formatCompetence(target.competence),
      state: "missing",
    },
    {
      label: "Vencimento",
      received: formatDate(message.classification.dueDate),
      registered: formatDate(target.dueDate),
      state: "missing",
    },
    {
      label: "Valor",
      received: formatAmount(message.classification.amountCents),
      registered: formatAmount("amountCents" in target ? target.amountCents : target.provisionedAmountCents),
      state: "missing",
    },
  ];
  const sourceIdentity = message.classification.billingIdentity;
  const targetIdentity = target.billingIdentity;
  if (sourceIdentity?.supplierTaxId || targetIdentity?.supplierTaxId) {
    rows.push({ label: "CNPJ/CPF", received: maskedTaxId(sourceIdentity?.supplierTaxId), registered: maskedTaxId(targetIdentity?.supplierTaxId), state: "missing" });
  }
  if (expense?.matchedBarcodeMasked || message.classification.barcodeMasked) {
    rows.push({ label: "Boleto", received: message.classification.barcodeMasked || "—", registered: expense?.matchedBarcodeMasked || "—", state: "missing" });
  }
  if ((message.classification.documentReferences?.length ?? 0) > 0 || (expense?.matchedDocumentReferences?.length ?? 0) > 0) {
    rows.push({
      label: "NF / documento",
      received: message.classification.documentReferences?.join(", ") || "—",
      registered: expense?.matchedDocumentReferences?.join(", ") || "—",
      state: "missing",
    });
  }
  if (message.classification.installmentNumber != null || expense?.installmentNumber != null) {
    rows.push({
      label: "Parcela",
      received: message.classification.installmentNumber == null
        ? "—"
        : `${message.classification.installmentNumber}/${message.classification.installmentTotal ?? "?"}`,
      registered: expense?.installmentNumber == null
        ? "—"
        : `${expense.installmentNumber}/${expense.installmentTotal ?? "?"}`,
      state: "missing",
    });
  }
  if (sourceIdentity?.customerAccount || targetIdentity?.customerAccount) {
    rows.push({ label: "Conta do cliente", received: identityValue(sourceIdentity, "account"), registered: identityValue(targetIdentity, "account"), state: "missing" });
  }
  if (sourceIdentity?.contractNumber || targetIdentity?.contractNumber) {
    rows.push({ label: "Contrato", received: identityValue(sourceIdentity, "contract"), registered: identityValue(targetIdentity, "contract"), state: "missing" });
  }
  if ((sourceIdentity?.serviceNumbers?.length ?? 0) > 0 || (targetIdentity?.serviceNumbers?.length ?? 0) > 0) {
    rows.push({ label: "Linha / telefone", received: identityValue(sourceIdentity, "phone"), registered: identityValue(targetIdentity, "phone"), state: "missing" });
  }
  const enrichableFields = new Set(["CNPJ/CPF", "Boleto", "NF / documento", "Conta do cliente", "Contrato", "Linha / telefone"]);
  return rows.map((row) => {
    const state = row.state === "same" ? "same" : comparisonState(row.received, row.registered);
    return {
      ...row,
      state: state === "missing"
        && row.received !== "—"
        && row.registered === "—"
        && message.provisionSuggestion?.status === "suggested"
        && enrichableFields.has(row.label)
        ? "enrich"
        : state,
    };
  });
}

function SuggestedPostingCard({
  message,
  canIdentify,
  onSelectAlternative,
}: {
  message: FinancialInboxMessage;
  canIdentify: boolean;
  onSelectAlternative: (alternative: FinancialInboxExpenseAlternative) => void;
}) {
  return (
    <section className="rounded-2xl border border-ds-info bg-ds-info-bg p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ds-info">1. Lançamento sugerido</p>
      <h3 className="mt-1 flex items-center gap-2 text-sm font-bold"><Link2 className="h-4 w-4 text-ds-info" />O que o sistema encontrou</h3>
      {["suggested", "linked"].includes(message.existingExpenseSuggestion?.status ?? "") ? (
        <div className="mt-3"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{message.existingExpenseSuggestion?.description || "Despesa encontrada"}</p>{message.existingExpenseSuggestion?.automaticLinkEligible ? <Badge variant="outline" className="border-ds-info bg-ds-info-bg text-[10px] text-ds-info">Identidade documental forte</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{[message.existingExpenseSuggestion?.supplier, installmentLabel(message), formatAmount(message.existingExpenseSuggestion?.amountCents), formatDate(message.existingExpenseSuggestion?.dueDate)].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{message.existingExpenseSuggestion?.reasons.join(" · ")}</p>{message.existingExpenseSuggestion?.automaticLinkEligible ? <p className="mt-1 text-xs font-medium text-ds-info">{message.existingExpenseSuggestion.automaticLinkReasons?.join(" · ")}</p> : null}</div>
      ) : message.provisionSuggestion?.status === "suggested" ? (
        <div className="mt-3"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{message.provisionSuggestion.description || "Previsão encontrada"}</p><Badge variant="outline" className="border-ds-warn bg-ds-warn-bg text-[10px] text-ds-warn">Previsão a vincular</Badge></div><p className="mt-1 text-sm text-muted-foreground">{formatAmount(message.provisionSuggestion.provisionedAmountCents)} · {message.provisionSuggestion.reasons.join(" · ")}</p></div>
      ) : message.creationSuggestion?.status === "suggested" ? (
        <div className="mt-3"><p className="font-semibold">Nova despesa sugerida</p><p className="mt-1 text-sm text-muted-foreground">Nenhum lançamento compatível foi encontrado. O cadastro ficará preenchido para sua revisão.</p></div>
      ) : message.creationSuggestion?.status === "incomplete" ? (
        <p className="mt-3 text-sm text-ds-warn">Ainda falta confirmar: {message.creationSuggestion.missingFields.join(", ")}.</p>
      ) : <p className="mt-3 text-sm text-muted-foreground">Nenhuma correspondência única foi encontrada.</p>}
      {message.classification.fiscalIdentity?.documentKind === "das" ? <p className="mt-3 rounded-xl bg-background p-3 text-xs text-muted-foreground"><strong className="text-foreground">Uma única despesa de {formatAmount(message.classification.amountCents)}.</strong> A distribuição entre as unidades é apenas o rateio contábil deste total; não cria novas cobranças.</p> : null}

      {!message.linkedExpenseId && message.existingExpenseSuggestion?.status !== "suggested" && (message.existingExpenseSuggestion?.alternatives?.length ?? 0) > 0 ? (
        <div className="mt-4 space-y-2 border-t pt-4"><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Alternativas — confirmação manual</p>{message.existingExpenseSuggestion!.alternatives!.map((alternative) => <div key={`${alternative.expenseId}:${alternative.installmentNumber ?? "expense"}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-3"><div><p className="text-sm font-semibold">{alternative.description}</p><p className="text-xs text-muted-foreground">{[alternative.supplier, alternative.installmentNumber ? `Parcela ${alternative.installmentNumber}${alternative.installmentTotal ? `/${alternative.installmentTotal}` : ""}` : null, formatAmount(alternative.amountCents), formatDate(alternative.dueDate)].filter(Boolean).join(" · ")}</p><p className="mt-1 text-[11px] text-muted-foreground">{alternative.reasons.join(" · ")}</p></div>{canIdentify ? <Button variant="outline" size="sm" onClick={() => onSelectAlternative(alternative)}>Identificar lançamento</Button> : null}</div>)}</div>
      ) : null}

      {message.linkedExpenseId ? <div className="mt-4 flex gap-2 rounded-xl bg-ds-ok-bg p-3 text-sm text-ds-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Vinculada à despesa {message.linkedExpenseId}{message.linkedExpenseInstallmentNumber ? `, parcela ${message.linkedExpenseInstallmentNumber}` : ""}.</span></div> : null}
      {!message.linkedExpenseId && message.resolution?.status === "identified" && message.resolution.targetId ? <div className="mt-4 flex gap-2 rounded-xl bg-ds-ok-bg p-3 text-sm text-ds-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Identificada como referência da despesa {message.resolution.targetId}{message.resolution.installmentNumber ? `, parcela ${message.resolution.installmentNumber}` : ""}. A despesa, o agendamento e o pagamento não serão alterados. Somente identificadores documentais confirmados podem ser agregados.</span></div> : null}
      {message.existingExpenseSuggestion?.paymentState === "paid" ? <div className="mt-3 flex gap-2 rounded-xl bg-ds-ok-bg p-3 text-sm text-ds-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Liquidação confirmada pelo extrato{message.existingExpenseSuggestion.existingSettlement?.paidAt ? ` em ${formatDate(message.existingExpenseSuggestion.existingSettlement.paidAt)}` : ""}.</span></div> : null}
      {message.existingExpenseSuggestion?.paymentState === "scheduled" ? <div className="mt-3 flex gap-2 rounded-xl bg-ds-info-bg p-3 text-sm text-ds-info"><Landmark className="mt-0.5 h-4 w-4 shrink-0" /><span>Há uma solicitação bancária existente. O agendamento não é tratado como liquidação.</span></div> : null}
    </section>
  );
}

function StatusChip({ status }: { status: FinancialInboxStatus }) {
  return <StatusPill variant={STATUS_PILL[status]}>{STATUS_LABEL[status]}</StatusPill>;
}

function ResolutionChips({ message }: { message: FinancialInboxMessage }) {
  const resolution = resolutionForDisplay(message);
  if (resolution.status !== "identified") return null;
  return (
    <>
      {resolution.kind ? <StatusPill variant="ok">{RESOLUTION_KIND_LABEL[resolution.kind]}</StatusPill> : null}
      {resolution.financialState ? <StatusPill variant="neutral">{FINANCIAL_STATE_LABEL[resolution.financialState]}</StatusPill> : null}
    </>
  );
}

/** Indicador de etapa no painel escuro; clicar filtra a caixa pela etapa. */
function StageChip(props: {
  title: string;
  count: number;
  amountCents: number;
  tone: "warning" | "info" | "danger" | "neutral";
  active: boolean;
  onClick: () => void;
  detail: string;
}) {
  return (
    <span title={`${props.count} ${props.count === 1 ? "cobrança" : "cobranças"} · ${props.detail}`}>
      <HeroChip value={formatAmount(props.amountCents)} label={`${props.title} · ${props.count}`} tone={props.tone} active={props.active} onClick={props.onClick} />
    </span>
  );
}

export function FinancialInboxPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<FinancialInboxMessage[]>([]);
  const [summary, setSummary] = useState<FinancialInboxSummary>(EMPTY_SUMMARY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<FinancialInboxView>("work");
  const [stage, setStage] = useState<FinancialInboxStage | "all">("all");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [paymentDateMode, setPaymentDateMode] = useState<"today" | "due" | "custom">("due");
  const [customPaymentDate, setCustomPaymentDate] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [beneficiaryDocument, setBeneficiaryDocument] = useState("");
  const [automationSettings, setAutomationSettings] = useState<FinancialInboxAutomationSettings>({
    mode: "manual",
    policyVersion: 1,
    updatedAt: null,
    updatedBy: null,
  });
  const [automationSettingsLoading, setAutomationSettingsLoading] = useState(true);
  const [automationSettingsSaving, setAutomationSettingsSaving] = useState(false);

  const canAnalyze = permissions.financial?.inbox?.analyze === true;
  const canIdentify = permissions.financial?.inbox?.link === true;
  const canLink = canIdentify
    && permissions.financial?.expenses?.create === true
    && permissions.financial?.expenses?.edit === true;
  const canDiscard = permissions.financial?.inbox?.discard === true;
  const canPreparePayment = permissions.financial?.expenses?.edit === true
    && permissions.financial?.paymentRequests?.view === true
    && permissions.financial?.paymentRequests?.create === true;
  const messageGroups = useMemo(() => groupFinancialInboxMessages(messages), [messages]);
  const selected = useMemo(() => messages.find((message) => message.id === selectedId) ?? null, [messages, selectedId]);
  const selectedGroup = useMemo(
    () => messageGroups.find((group) => group.messages.some((message) => message.id === selectedId)) ?? null,
    [messageGroups, selectedId],
  );
  const selectedThreadMessages = useMemo(() => selected?.thread?.messages?.length
    ? selected.thread.messages
    : (selectedGroup?.messages ?? []).map((message) => ({
      id: message.id,
      subject: message.subject,
      receivedAt: message.receivedAt,
      status: message.status,
      kind: resolutionForDisplay(message).kind === "new_charge"
        || resolutionForDisplay(message).kind === "reminder"
        || resolutionForDisplay(message).kind === "duplicate"
        ? resolutionForDisplay(message).kind as "new_charge" | "reminder" | "duplicate"
        : null,
    })), [selected, selectedGroup]);
  const selectedThreadCount = Math.max(selected?.thread?.messageCount ?? 0, selectedGroup?.messageCount ?? 0);
  const selectedForDiscard = useMemo(
    () => messages.filter((message) => selectedIds.has(message.id) && isFinancialInboxBulkDiscardEligible(message)),
    [messages, selectedIds],
  );
  const selectedComparison = useMemo(() => selected ? comparisonRows(selected) : [], [selected]);
  const selectedResolution = useMemo(() => selected ? resolutionForDisplay(selected) : null, [selected]);
  const workSummary = useMemo(() => ["classify", "link", "pay", "bank"].reduce((total, key) => ({
    count: total.count + summary.stages[key as FinancialInboxStage].count,
    amountCents: total.amountCents + summary.stages[key as FinancialInboxStage].amountCents,
  }), { count: 0, amountCents: 0 }), [summary]);
  const identifiedSummary = useMemo(() => ["pay", "bank", "done"].reduce((total, key) => ({
    count: total.count + summary.stages[key as FinancialInboxStage].count,
    amountCents: total.amountCents + summary.stages[key as FinancialInboxStage].amountCents,
  }), { count: 0, amountCents: 0 }), [summary]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setCursor(null);
      setCursorStack([]);
      setNextCursor(null);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    setManualBarcode("");
    setCustomPaymentDate("");
    setPaymentDateMode("due");
  }, [selectedId, confirmation?.kind]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || "Falha na operação.");
    }
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "25", view });
      if (view === "work" && stage !== "all") query.set("stage", stage);
      if (view === "identified") {
        if (auditFilter === "reminder" || auditFilter === "new_charge") query.set("kind", auditFilter);
        if (auditFilter === "scheduled" || auditFilter === "reconciled") query.set("financialState", auditFilter);
        if (auditFilter === "off" || auditFilter === "archive") query.set("stage", auditFilter);
      }
      if (search) query.set("q", search);
      if (cursor) query.set("cursor", cursor);
      const payload = await api(`/api/financial/inbox?${query.toString()}`);
      const nextMessages = (payload.messages ?? []) as FinancialInboxMessage[];
      setMessages(nextMessages);
      setSummary((payload.summary ?? EMPTY_SUMMARY) as FinancialInboxSummary);
      setNextCursor(payload.nextCursor ?? null);
      setSearchTruncated(payload.searchTruncated === true);
      setLastLoadedAt(new Date().toISOString());
      setSelectedIds(new Set());
      setSelectedId((current) => nextMessages.some((message) => message.id === current) ? current : null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar cobranças." });
    } finally {
      setLoading(false);
    }
  }, [api, auditFilter, cursor, firebaseUser, search, stage, toast, view]);

  const loadAutomationSettings = useCallback(async () => {
    if (!firebaseUser) return;
    setAutomationSettingsLoading(true);
    try {
      const payload = await api("/api/financial/inbox/settings");
      setAutomationSettings(payload.settings as FinancialInboxAutomationSettings);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar a vinculação automática." });
    } finally {
      setAutomationSettingsLoading(false);
    }
  }, [api, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadAutomationSettings(); }, [loadAutomationSettings]);

  async function updateAutomationMode(enabled: boolean) {
    setAutomationSettingsSaving(true);
    try {
      const payload = await api("/api/financial/inbox/settings", {
        method: "PUT",
        body: JSON.stringify({ mode: enabled ? "document_identity" : "manual" }),
      });
      setAutomationSettings(payload.settings as FinancialInboxAutomationSettings);
      toast({
        title: enabled ? "Vinculação automática ativada." : "Vinculação automática desativada.",
        description: enabled
          ? "Será usada apenas com identidade documental forte e um único candidato."
          : "As próximas correspondências voltarão a exigir confirmação manual.",
      });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao alterar a vinculação automática." });
    } finally {
      setAutomationSettingsSaving(false);
    }
  }

  function changeStage(nextStage: FinancialInboxStage | "all") {
    setStage(nextStage);
    setCursor(null);
    setCursorStack([]);
    setNextCursor(null);
  }

  function changeView(nextView: FinancialInboxView) {
    setView(nextView);
    setStage("all");
    setAuditFilter("all");
    setCursor(null);
    setCursorStack([]);
    setNextCursor(null);
  }

  function changeAuditFilter(nextFilter: AuditFilter) {
    setAuditFilter(nextFilter);
    setCursor(null);
    setCursorStack([]);
    setNextCursor(null);
  }

  function toggleSelected(message: FinancialInboxMessage, checked: boolean) {
    if (!isFinancialInboxBulkDiscardEligible(message)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(message.id);
      else next.delete(message.id);
      return next;
    });
  }

  async function review(message: FinancialInboxMessage, nextStatus: "pending_review" | "ignored") {
    setWorking(`review:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      toast({ title: nextStatus === "ignored" ? "Mensagem descartada sem gerar despesa." : "Mensagem reaberta para revisão." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao revisar mensagem." });
    } finally {
      setWorking(null);
    }
  }

  async function discardMany(ids: string[]) {
    setWorking("discard:many");
    try {
      const payload = await api("/api/financial/inbox/bulk-review", {
        method: "POST",
        body: JSON.stringify({ ids, status: "ignored" }),
      });
      toast({ title: `${payload.updated ?? ids.length} ${ids.length === 1 ? "mensagem descartada" : "mensagens descartadas"}.`, description: "Nenhuma despesa ou pagamento foi criado." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao descartar mensagens." });
    } finally {
      setWorking(null);
    }
  }

  async function restoreArchived(message: FinancialInboxMessage) {
    setWorking(`restore:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/restore`, { method: "POST" });
      toast({ title: "Cobrança restaurada.", description: "O status tratado original e toda a trilha foram preservados." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao restaurar a cobrança." });
    } finally {
      setWorking(null);
    }
  }

  async function analyze(message: FinancialInboxMessage) {
    setWorking(`analyze:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/analyze`, { method: "POST" });
      toast({ title: "Cobrança analisada contra despesas, previsões e pagamentos." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao analisar a cobrança." });
    } finally {
      setWorking(null);
    }
  }

  async function linkSuggestion(
    message: FinancialInboxMessage,
    alternative?: FinancialInboxExpenseAlternative,
    resolutionOnly = false,
  ) {
    const key = alternative ? `${alternative.expenseId}:${alternative.installmentNumber ?? "expense"}` : "suggestion";
    setWorking(`link:${message.id}:${key}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/link`, {
        method: "POST",
        ...(alternative || resolutionOnly ? {
          body: JSON.stringify({
            expenseId: alternative?.expenseId ?? message.existingExpenseSuggestion?.expenseId,
            installmentNumber: alternative?.installmentNumber ?? message.existingExpenseSuggestion?.installmentNumber ?? null,
            resolutionOnly,
          }),
        } : {}),
      });
      toast({
        title: resolutionOnly ? "Cobrança identificada." : "Cobrança vinculada.",
        description: resolutionOnly
          ? "Registrada como lembrete; nome, valor e pagamento foram preservados, e os identificadores documentais foram agregados."
          : alternative
          ? "A escolha manual e os identificadores da cobrança foram registrados."
          : message.existingExpenseSuggestion?.paymentState === "paid"
            ? "O pagamento confirmado no extrato foi preservado."
            : message.existingExpenseSuggestion?.paymentState === "scheduled"
              ? "O registro bancário existente foi preservado."
              : "A vinculação foi registrada sem executar pagamento.",
      });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao vincular a cobrança." });
    } finally {
      setWorking(null);
    }
  }

  async function preparePayment(message: FinancialInboxMessage) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const scheduledFor = paymentDateMode === "today"
      ? today
      : paymentDateMode === "due"
        ? message.classification.dueDate
        : customPaymentDate;
    if (!scheduledFor) {
      toast({ variant: "destructive", title: "Escolha a data pretendida para o pagamento." });
      return;
    }
    if (!message.classification.barcode && !manualBarcode.trim()) {
      toast({ variant: "destructive", title: "Informe o código de barras antes de preparar." });
      return;
    }
    if (!beneficiaryDocument.trim()) {
      toast({ variant: "destructive", title: "Informe o CNPJ do favorecido antes de preparar." });
      return;
    }
    setWorking(`payment:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/payment`, {
        method: "POST",
        body: JSON.stringify({
          scheduledFor,
          beneficiaryDocument,
          ...(message.classification.barcode ? {} : { barcode: manualBarcode.trim() }),
        }),
      });
      toast({ title: "Pagamento preparado.", description: "Nenhum pagamento foi autorizado, agendado ou executado. A solicitação aguarda autorização financeira." });
      setConfirmation(null);
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao preparar o pagamento." });
    } finally {
      setWorking(null);
    }
  }

  function openPaymentPreparation(message: FinancialInboxMessage) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const extractedDocument = message.classification.billingIdentity?.supplierTaxId
      ?? message.attachments.find((attachment) => attachment.extractedHints?.supplierTaxId)?.extractedHints?.supplierTaxId
      ?? "";
    setPaymentDateMode(message.classification.dueDate && message.classification.dueDate >= today ? "due" : "today");
    setCustomPaymentDate("");
    setManualBarcode("");
    setBeneficiaryDocument(extractedDocument);
    setConfirmation({ kind: "payment", message });
  }

  async function openFile(message: FinancialInboxMessage, fileId: string) {
    if (!firebaseUser) return;
    const preview = window.open("", "_blank");
    if (preview) preview.opener = null;
    setWorking(`file:${fileId}`);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/inbox/${encodeURIComponent(message.id)}/files/${encodeURIComponent(fileId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao abrir o arquivo.");
      }
      const url = URL.createObjectURL(await response.blob());
      if (preview) preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir o arquivo." });
    } finally {
      setWorking(null);
    }
  }

  function openExternalConfirmation(url: string) {
    try {
      const parsed = new URL(url);
      const provider = trustedFinancialDocumentProvider(parsed);
      if (!provider) {
        toast({
          variant: "destructive",
          title: "Link externo bloqueado.",
          description: "O domínio ou a rota ainda não pertence à lista de provedores documentais verificados.",
        });
        return;
      }
      setConfirmation({ kind: "external", url, domain: parsed.hostname, provider: provider.name });
    } catch {
      toast({ variant: "destructive", title: "Esse link não é HTTPS ou não é válido." });
    }
  }

  function confirmAction() {
    const action = confirmation;
    if (!action) return;
    if (action.kind === "payment") {
      void preparePayment(action.message);
      return;
    }
    setConfirmation(null);
    if (action.kind === "discard") void discardMany(action.ids);
    if (action.kind === "link") void linkSuggestion(action.message, action.alternative, action.resolutionOnly === true);
    if (action.kind === "external") window.open(action.url, "_blank", "noopener,noreferrer");
  }

  if (!permissions.financial?.inbox?.view) {
    return <FinancialAccessGuard title="Caixa de cobranças" description="Seu perfil não possui permissão para consultar cobranças recebidas." />;
  }

  return (
    <PageContainer variant="default" className="space-y-5 pb-28">
      <PageHero
        kicker="Financeiro · Despesas"
        title={view === "work" ? "Caixa de cobranças" : "Cobranças identificadas"}
        subtitle={view === "work" ? "Analise, confirme e prepare somente o que ainda exige ação." : "Audite a origem, a identificação e a situação financeira de cada cobrança tratada."}
        actions={<>
          {lastLoadedAt ? <span className="text-xs text-ds-on-dark-sub">Atualizada às {formatDateTime(lastLoadedAt).split(" ").at(-1)}</span> : null}
          <Button variant="on-dark-secondary" size="md" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Atualizar lista</Button>
          <Button variant="on-dark-secondary" size="md" asChild><Link href={FINANCIAL_ROUTES.expenses}><ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />Despesas</Link></Button>
        </>}
        chips={view === "work" ? <>
          <StageChip title="Para classificar" count={summary.stages.classify.count} amountCents={summary.stages.classify.amountCents} tone="warning" detail="revisão ou documento" active={stage === "classify"} onClick={() => changeStage("classify")} />
          <StageChip title="Para confirmar" count={summary.stages.link.count} amountCents={summary.stages.link.amountCents} tone="info" detail="correspondência a conferir" active={stage === "link"} onClick={() => changeStage("link")} />
          <StageChip title="Para preparar" count={summary.stages.pay.count} amountCents={summary.stages.pay.amountCents} tone="info" detail="despesa principal vinculada" active={stage === "pay"} onClick={() => changeStage("pay")} />
          <StageChip title="No banco" count={summary.stages.bank.count} amountCents={summary.stages.bank.amountCents} tone="neutral" detail="acompanhamento bancário" active={stage === "bank"} onClick={() => changeStage("bank")} />
        </> : undefined}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            aria-label="Visão das cobranças"
            value={view}
            onChange={changeView}
            options={[
              { value: "work", label: <span className="inline-flex items-center gap-1.5"><Inbox className="h-3.5 w-3.5" />Caixa de cobranças <span className="text-xs opacity-60">{workSummary.count}</span></span> },
              { value: "identified", label: <span className="inline-flex items-center gap-1.5"><History className="h-3.5 w-3.5" />Cobranças identificadas <span className="text-xs opacity-60">{identifiedSummary.count}</span></span> },
            ]}
          />
          <ControlSearch value={searchInput} onChange={setSearchInput} placeholder="Buscar fornecedor, assunto, valor, conta ou telefone..." />
        </div>
        {view === "work" ? (
          <FilterChips
            value={stage === "all" ? null : stage}
            onChange={(value) => changeStage((value ?? "all") as FinancialInboxStage | "all")}
            allCount={workSummary.count}
            chips={WORK_STAGE_OPTIONS.filter((option) => option.value !== "all").map((option) => ({ value: option.value, label: option.label, count: summary.stages[option.value as FinancialInboxStage].count }))}
          />
        ) : (
          <FilterChips
            value={auditFilter === "all" ? null : auditFilter}
            onChange={(value) => changeAuditFilter((value ?? "all") as AuditFilter)}
            chips={AUDIT_FILTER_OPTIONS.filter((option) => option.value !== "all").map((option) => ({ value: option.value, label: option.label }))}
          />
        )}
      </PageHero>

      <div className="flex items-start gap-3 rounded-xl border border-ds-ok bg-ds-ok-bg p-4 text-sm text-ds-ok">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <div><strong>{view === "work" ? "Entrada protegida." : "Trilha preservada."}</strong> {view === "work" ? "Receber ou analisar não cria despesa, não autoriza pagamento e não envia nada ao banco." : "Uma identificação preserva os dados financeiros e pode enriquecer somente os identificadores documentais, sem executar pagamento."} O e-mail original permanece arquivado.</div>
      </div>

      {view === "work" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-ds-info bg-ds-info-bg p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-ds-info" />
            <div>
              <p className="text-sm font-bold">Vinculação automática por identidade documental</p>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                Opt-in: identifica sem clique somente um candidato com a mesma linha digitável/código de barras; ou com CNPJ, NF/documento, parcela, valor e vencimento idênticos. Não cria despesa, não prepara e não executa pagamento.
              </p>
              {automationSettings.updatedAt ? <p className="mt-1 text-[11px] text-muted-foreground">Última alteração em {formatDateTime(automationSettings.updatedAt)}.</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-semibold">{automationSettings.mode === "document_identity" ? "Automática" : "Manual"}</span>
            <Switch
              aria-label="Ativar vinculação automática por identidade documental"
              checked={automationSettings.mode === "document_identity"}
              onCheckedChange={(checked) => void updateAutomationMode(checked)}
              disabled={!canIdentify || automationSettingsLoading || automationSettingsSaving}
            />
            {automationSettingsSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-[18px] border border-ds-border bg-ds-surface">
        {searchTruncated ? (
          <div className="rounded-t-[18px] border-b border-ds-border bg-ds-warn-bg px-4 py-2 text-xs font-semibold text-ds-warn">A busca verificou as 500 mensagens mais recentes deste filtro. Refine os termos para localizar registros mais antigos.</div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}</div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">{view === "work" ? <Inbox className="h-9 w-9 text-muted-foreground" /> : <History className="h-9 w-9 text-muted-foreground" />}<p className="font-semibold">Nenhuma cobrança encontrada</p><p className="max-w-md text-sm text-muted-foreground">Ajuste o filtro ou a busca. Receber mensagens continua sendo uma operação sem efeito financeiro.</p></div>
        ) : (
          <>
            <div>
              {messageGroups.map((group) => {
                const message = group.primary;
                const discardEligible = canDiscard && isFinancialInboxBulkDiscardEligible(message);
                const checked = selectedIds.has(message.id);
                const groupSelected = selectedGroup?.id === group.id && selected !== null;
                return (
                  <LiftRow key={group.id} interactive={false} selected={groupSelected} className="flex items-start gap-3">
                    {view === "work" ? <Checkbox checked={checked} disabled={!discardEligible} aria-label={`Selecionar ${message.subject} para descarte`} onCheckedChange={(value) => toggleSelected(message, value === true)} className="mt-1" /> : null}
                    <button
                      type="button"
                      aria-label={`Abrir cobrança ${message.subject}`}
                      aria-haspopup="dialog"
                      onClick={() => setSelectedId(message.id)}
                      className="group/row grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 text-left focus-visible:outline-none md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto_auto_16px]"
                    >
                      <p className="truncate text-sm font-bold text-ds-ink">{senderLabel(message)}</p>
                      <span className="font-mono text-sm font-extrabold text-ds-ink md:order-3">{formatAmount(message.classification.amountCents)}</span>
                      <p className="col-span-2 line-clamp-2 text-sm leading-5 text-ds-ink-2 md:order-2 md:col-span-1">{message.subject}</p>
                      <div className="col-span-2 flex flex-wrap items-center gap-2 md:order-4 md:col-span-1">
                        <StatusChip status={message.status} />
                        <ResolutionChips message={message} />
                        <StatusPill variant="neutral">{TYPE_LABEL[message.classification.documentType]}</StatusPill>
                        {group.messageCount > 1 ? <StatusPill variant="info">{group.messageCount} e-mails</StatusPill> : null}
                        <span className="text-[11px] text-ds-ink-faint">{formatDateTime(group.messages.at(-1)?.receivedAt)}</span>
                      </div>
                      <ChevronRight aria-hidden="true" className="hidden h-4 w-4 text-ds-ink-faint transition-transform duration-150 group-hover/row:translate-x-0.5 group-hover/row:text-ds-accent-ink motion-reduce:transition-none md:order-5 md:block" />
                    </button>
                  </LiftRow>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-ds-divider p-3">
              <Button variant="ds-secondary" size="xs" disabled={cursorStack.length === 0} onClick={() => { const previous = cursorStack.at(-1) || null; setCursorStack((current) => current.slice(0, -1)); setCursor(previous); }}><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button>
              <Button variant="ds-secondary" size="xs" disabled={!nextCursor} onClick={() => { if (!nextCursor) return; setCursorStack((current) => [...current, cursor ?? ""]); setCursor(nextCursor); }}>Próxima<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </div>
          </>
        )}
      </div>

      {selected ? (
        <SidePanel
          open
          onOpenChange={(open) => { if (!open) setSelectedId(null); }}
          kicker={`Cobrança · ${STATUS_LABEL[selected.status]}`}
          title={senderLabel(selected)}
          subtitle={selected.subject}
          highlights={<span className="font-mono">{formatAmount(selected.classification.amountCents)}</span>}
          className="sm:w-[560px]"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><StatusChip status={selected.status} /><ResolutionChips message={selected} /><StatusPill variant="neutral">{TYPE_LABEL[selected.classification.documentType]}</StatusPill></div>
            <p className="break-all text-sm text-ds-ink-muted"><span className="font-semibold text-ds-ink">Remetente do e-mail:</span> {selected.from}</p>
            <div className="grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Competência</p><p className="font-semibold">{formatCompetence(selected.classification.competence)}</p></div><div><p className="text-xs text-muted-foreground">Vencimento</p><p className="font-semibold">{formatDate(selected.classification.dueDate)}</p></div><div><p className="text-xs text-muted-foreground">Recebimento</p><p className="font-semibold">{formatDateTime(selected.receivedAt)}</p></div></div>
          </div>
                <div className="space-y-5">
                  {selectedThreadCount > 1 ? (
                    <section className="rounded-2xl border border-ds-info bg-ds-info-bg p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div><h3 className="text-sm font-bold">E-mails desta obrigação</h3><p className="mt-1 text-xs text-muted-foreground">Cobrança principal, lembretes e reenvios permanecem separados para auditoria.</p></div>
                        <Badge variant="outline" className="border-ds-info bg-background text-ds-info">{selectedThreadCount} e-mails</Badge>
                      </div>
                      <div className="mt-3 divide-y rounded-xl border bg-background">
                        {selectedThreadMessages.map((entry) => (
                          <button key={entry.id} type="button" disabled={!messages.some((message) => message.id === entry.id)} onClick={() => setSelectedId(entry.id)} className={cn("flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm enabled:hover:bg-muted/40 disabled:cursor-default", selected.id === entry.id && "bg-ds-info-bg")}>
                            <span className="min-w-0"><span className="block truncate font-semibold">{entry.subject}</span><span className="mt-0.5 block text-xs text-muted-foreground">{RESOLUTION_KIND_LABEL[entry.kind ?? "reminder"]} · {formatDateTime(entry.receivedAt)}</span></span>
                            <StatusChip status={entry.status} />
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <SuggestedPostingCard
                    message={selected}
                    canIdentify={canIdentify}
                    onSelectAlternative={(alternative) => setConfirmation({ kind: "link", message: selected, alternative, resolutionOnly: true })}
                  />

                  <section className="rounded-2xl border border-ds-info bg-ds-info-bg p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ds-info">{selectedResolution?.status === "identified" ? "Resultado do tratamento" : "2. Próxima decisão"}</p>
                    <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        {financialInboxStageForStatus(selected.status) === "classify" ? <><p className="font-bold">Analisar documentos e localizar o lançamento</p><p className="text-sm text-muted-foreground">A análise atualiza sugestões; não cria nem altera despesas.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "link" && selected.provisionSuggestion?.status === "suggested" ? <><p className="font-bold">Vincular a cobrança à previsão “{selected.provisionSuggestion.description || "Previsão encontrada"}”</p><p className="text-sm text-muted-foreground">O nome e a classificação oficial serão mantidos; os dados confirmados do documento serão agregados à mesma obrigação.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "link" && selected.provisionSuggestion?.status !== "suggested" ? <><p className="font-bold">Confirmar a despesa correspondente</p><p className="text-sm text-muted-foreground">Confira divergências antes de registrar o vínculo.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "pay" ? <><p className="font-bold">Preparar solicitação para autorização</p><p className="text-sm text-muted-foreground">Preparar não agenda, autoriza ou executa o pagamento.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "bank" ? <><p className="font-bold">Acompanhar a situação no banco</p><p className="text-sm text-muted-foreground">A conciliação só ocorre depois da liquidação encontrada no extrato.</p></> : null}
                        {selected.status === "identified" ? <><p className="font-bold">Cobrança já registrada no financeiro</p><p className="text-sm text-muted-foreground">O e-mail foi preservado como evidência; nenhuma despesa ou solicitação de pagamento foi criada.</p><div className="mt-3 flex gap-2 rounded-xl bg-ds-ok-bg p-3 text-sm text-ds-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Nome, valor e pagamento foram preservados; identificadores confirmados do documento foram agregados à obrigação.</span></div></> : null}
                        {selected.status !== "identified" && financialInboxStageForStatus(selected.status) === "done" ? <><p className="font-bold">Cobrança conciliada</p><p className="text-sm text-muted-foreground">O vínculo e a liquidação foram preservados para auditoria.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "off" ? <><p className="font-bold">Mensagem descartada</p><p className="text-sm text-muted-foreground">Nenhum efeito financeiro foi produzido.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "archive" ? <><p className="font-bold">Mensagem arquivada pela política de retenção</p><p className="text-sm text-muted-foreground">Fora da caixa operacional; a trilha e os vínculos continuam preservados.</p></> : null}
                      </div>
                      <div className="shrink-0">
                        {view === "work" && financialInboxStageForStatus(selected.status) === "classify" && canAnalyze ? <Button onClick={() => void analyze(selected)} disabled={working === `analyze:${selected.id}`}><Sparkles className="mr-2 h-4 w-4" />Analisar cobrança</Button> : null}
                        {view === "work" && financialInboxStageForStatus(selected.status) === "link" && canIdentify && selected.existingExpenseSuggestion?.status === "suggested" ? <Button onClick={() => setConfirmation({ kind: "link", message: selected, resolutionOnly: true })}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar como já registrada</Button> : null}
                        {view === "work" && financialInboxStageForStatus(selected.status) === "link" && canLink && selected.provisionSuggestion?.status === "suggested" ? <Button onClick={() => setConfirmation({ kind: "link", message: selected })}><Link2 className="mr-2 h-4 w-4" />Vincular cobrança à previsão</Button> : null}
                        {view === "work" && financialInboxStageForStatus(selected.status) === "pay" && canPreparePayment && !selected.paymentRequestId ? <Button onClick={() => openPaymentPreparation(selected)}><ShieldCheck className="mr-2 h-4 w-4" />Preparar pagamento</Button> : null}
                        {view === "work" && financialInboxStageForStatus(selected.status) === "bank" && permissions.financial?.paymentRequests?.view ? <Button asChild><Link href={FINANCIAL_ROUTES.paymentRequests}><Landmark className="mr-2 h-4 w-4" />Abrir no banco</Link></Button> : null}
                        {financialInboxStageForStatus(selected.status) === "off" && canDiscard ? <Button variant="outline" onClick={() => void review(selected, "pending_review")} disabled={working === `review:${selected.id}`}><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "archive" && canDiscard ? <Button variant="outline" onClick={() => void restoreArchived(selected)} disabled={working === `restore:${selected.id}`}>{working === `restore:${selected.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Restaurar</Button> : null}
                      </div>
                    </div>
                  </section>

                  {selectedComparison.length > 0 ? (
                    <section className="overflow-hidden rounded-2xl border">
                      <div className="border-b bg-muted/30 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-ds-info" />Comparação com o cadastro</h3><p className="mt-1 text-xs text-muted-foreground">{selectedResolution?.status === "identified" ? "Evidências usadas para identificar a cobrança." : "A correspondência continua dependendo da sua confirmação."}</p></div>
                      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Campo</th><th className="px-4 py-3">No documento</th><th className="px-4 py-3">No sistema</th><th className="px-4 py-3">Conferência</th></tr></thead><tbody className="divide-y">{selectedComparison.map((row) => <tr key={row.label}><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3">{row.received}</td><td className="px-4 py-3">{row.registered}</td><td className="px-4 py-3">{row.state === "same" ? <span className="inline-flex items-center gap-1 font-semibold text-ds-ok"><Check className="h-4 w-4" />Confere</span> : row.state === "different" ? <span className="inline-flex items-center gap-1 font-semibold text-ds-warn"><AlertTriangle className="h-4 w-4" />Divergente</span> : row.state === "enrich" ? <span className="inline-flex items-center gap-1 font-semibold text-ds-info"><Sparkles className="h-4 w-4" />Será incorporado</span> : <span className="text-muted-foreground">Não informado</span>}</td></tr>)}</tbody></table></div>
                    </section>
                  ) : null}

                  {selected.classification.fiscalIdentity ? (
                    <section className="rounded-2xl border p-4">
                      <h3 className="text-sm font-bold">Identidade fiscal do documento</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Extraída da guia; não usa o remetente do e-mail como beneficiário.</p>
                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                        <div><p className="text-xs text-muted-foreground">Natureza</p><p className="font-semibold">{FISCAL_KIND_LABEL[selected.classification.fiscalIdentity.documentKind]}</p></div>
                        <div><p className="text-xs text-muted-foreground">Beneficiário / arrecadador</p><p className="font-semibold">{selected.classification.fiscalIdentity.collectorName || "Não identificado"}</p></div>
                        {selected.classification.fiscalIdentity.taxpayerName ? <div><p className="text-xs text-muted-foreground">Contribuinte</p><p className="font-semibold">{selected.classification.fiscalIdentity.taxpayerName}</p></div> : null}
                        {selected.classification.fiscalIdentity.taxpayerTaxId ? <div><p className="text-xs text-muted-foreground">CPF/CNPJ do contribuinte</p><p className="font-semibold">{maskedTaxId(selected.classification.fiscalIdentity.taxpayerTaxId)}</p></div> : null}
                        {selected.classification.fiscalIdentity.taxpayerRegistration ? <div><p className="text-xs text-muted-foreground">Inscrição do contribuinte</p><p className="font-semibold">{selected.classification.fiscalIdentity.taxpayerRegistration}</p></div> : null}
                        {selected.classification.fiscalIdentity.documentNumber ? <div><p className="text-xs text-muted-foreground">Número da guia</p><p className="font-semibold">{selected.classification.fiscalIdentity.documentNumber}</p></div> : null}
                        {selected.classification.fiscalIdentity.revenueDescriptions.length > 0 ? <div><p className="text-xs text-muted-foreground">Composição / descrição</p><p className="font-semibold">{selected.classification.fiscalIdentity.revenueDescriptions.join(" · ")}</p></div> : null}
                        {selected.classification.fiscalIdentity.revenueCodes.length > 0 ? <div><p className="text-xs text-muted-foreground">Códigos de receita</p><p className="font-semibold">{selected.classification.fiscalIdentity.revenueCodes.join(", ")}</p></div> : null}
                      </div>
                      {(selected.classification.fiscalIdentity.revenueItems ?? []).length > 0 ? <div className="mt-4 overflow-hidden rounded-xl border"><div className="border-b bg-muted/30 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Composição da guia</div><div className="divide-y">{(selected.classification.fiscalIdentity.revenueItems ?? []).map((item, index) => <div key={`${item.code ?? "item"}:${item.description}:${index}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm"><p><span className="font-mono text-xs text-muted-foreground">{item.code || "—"}</span> <span className="font-medium">{item.description}</span></p><p className="shrink-0 font-mono font-semibold">{formatAmount(item.amountCents)}</p></div>)}</div></div> : null}
                    </section>
                  ) : null}

                  {selected.classification.billingIdentity && (selected.classification.billingIdentity.customerAccount || selected.classification.billingIdentity.contractNumber || selected.classification.billingIdentity.serviceNumbers.length > 0 || selected.classification.billingIdentity.supplierTaxId) ? (
                    <section className="rounded-2xl border p-4"><h3 className="text-sm font-bold">Identificadores da cobrança</h3><div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{selected.classification.billingIdentity.customerAccount ? <div><p className="text-xs text-muted-foreground">Conta</p><p className="font-semibold">{selected.classification.billingIdentity.customerAccount}</p></div> : null}{selected.classification.billingIdentity.contractNumber ? <div><p className="text-xs text-muted-foreground">Contrato</p><p className="font-semibold">{selected.classification.billingIdentity.contractNumber}</p></div> : null}{selected.classification.billingIdentity.serviceNumbers.map((number) => <div key={number}><p className="text-xs text-muted-foreground">Linha / telefone</p><p className="font-semibold">{number}</p></div>)}{selected.classification.billingIdentity.supplierTaxId ? <div><p className="text-xs text-muted-foreground">CNPJ do fornecedor</p><p className="font-semibold">{selected.classification.billingIdentity.supplierTaxId}</p></div> : null}</div></section>
                  ) : null}

                  <Accordion type="multiple" defaultValue={["documents"]} className="rounded-2xl border px-4">
                    <AccordionItem value="email"><AccordionTrigger className="text-sm">Conteúdo do e-mail</AccordionTrigger><AccordionContent><p className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/30 p-4 leading-6">{selected.textContent || "O e-mail não possui conteúdo textual."}</p></AccordionContent></AccordionItem>
                    <AccordionItem value="documents"><AccordionTrigger className="text-sm">Documentos arquivados ({selected.attachments.filter((attachment) => attachment.storagePath).length + (selected.rawStoragePath ? 1 : 0)})</AccordionTrigger><AccordionContent><div className="flex flex-wrap gap-2">{selected.attachments.filter((attachment) => attachment.storagePath).map((attachment) => <Button key={attachment.id} variant="outline" size="sm" onClick={() => void openFile(selected, attachment.id)} disabled={working === `file:${attachment.id}`}>{working === `file:${attachment.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}{attachment.filename}{attachment.extractionStatus === "failed" ? <XCircle className="ml-2 h-3.5 w-3.5 text-ds-danger" /> : attachment.extractionStatus === "needs_ocr" ? <AlertTriangle className="ml-2 h-3.5 w-3.5 text-ds-warn" /> : attachment.extractionStatus === "extracted" || attachment.extractionStatus === "ocr_extracted" ? <Check className="ml-2 h-3.5 w-3.5 text-ds-ok" /> : null}</Button>)}{selected.rawStoragePath ? <Button variant="ghost" size="sm" onClick={() => void openFile(selected, "raw")} disabled={working === "file:raw"}><Download className="mr-2 h-4 w-4" />E-mail original (.eml)</Button> : null}{!selected.rawStoragePath && !selected.attachments.some((attachment) => attachment.storagePath) ? <p className="text-sm text-muted-foreground">Nenhum documento foi arquivado.</p> : null}</div>{selected.linkResolution?.message ? <p className={cn("mt-3 text-xs", selected.linkResolution.status === "resolved" ? "text-ds-ok" : selected.linkResolution.status === "requires_login" ? "text-ds-warn" : "text-muted-foreground")}>{selected.linkResolution.message}</p> : null}</AccordionContent></AccordionItem>
                    {selected.classification.links.length > 0 ? <AccordionItem value="links"><AccordionTrigger className="text-sm">Links enviados pelo fornecedor ({selected.classification.links.length})</AccordionTrigger><AccordionContent><p className="mb-3 text-xs text-muted-foreground">Somente provedores e rotas documentais verificados podem ser abertos. A validação independe do endereço do remetente.</p><div className="grid gap-2">{selected.classification.links.map((link) => { const provider = trustedFinancialDocumentProvider(link); return <button key={link} type="button" onClick={() => openExternalConfirmation(link)} disabled={!provider} className={cn("flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm", provider ? "text-ds-info hover:bg-ds-muted" : "cursor-not-allowed bg-muted/30 text-muted-foreground")}><span className="min-w-0"><span className="block truncate">{link}</span><span className={cn("mt-1 block text-[10px] font-semibold", provider ? "text-ds-ok" : "text-ds-warn")}>{provider?.name ?? "Destino não verificado — abertura bloqueada"}</span></span>{provider ? <ShieldCheck className="h-4 w-4 shrink-0 text-ds-ok" /> : <XCircle className="h-4 w-4 shrink-0" />}</button>; })}</div></AccordionContent></AccordionItem> : null}
                  </Accordion>

                  {selected.archiveWarnings.length > 0 ? <div className="flex gap-2 rounded-xl border border-ds-warn bg-ds-warn-bg p-3 text-sm text-ds-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{selected.archiveWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-[11px] text-muted-foreground"><p>Mensagem: {selected.id}</p><p>Atualizada em {formatDateTime(selected.updatedAt)} · origem {selected.provider}</p>{selectedResolution?.resolvedAt ? <p>Identificação {selectedResolution.mode === "automatic" ? "automática" : "manual"} em {formatDateTime(selectedResolution.resolvedAt)}</p> : null}{selected.paymentRequestId ? <p>Solicitação de pagamento: {selected.paymentRequestId}</p> : null}{selected.statementTransactionId ? <p>Movimentação conciliada: {selected.statementTransactionId}</p> : null}</div>
                    <div className="flex flex-wrap gap-2">{view === "work" && canLink && selectedResolution?.status === "pending" && !selected.linkedExpenseId ? <Button variant="outline" onClick={() => setConfirmation({ kind: "create", message: selected })}>Criar nova despesa</Button> : null}{view === "work" && canDiscard && selected.status !== "ignored" && isFinancialInboxBulkDiscardEligible(selected) ? <Button variant="outline" onClick={() => setConfirmation({ kind: "discard", ids: [selected.id] })}><Trash2 className="mr-2 h-4 w-4" />Descartar</Button> : null}</div>
                  </div>
                </div>
        </SidePanel>
      ) : null}

      <BulkBar
        count={selectedForDiscard.length}
        summary={`${selectedForDiscard.length} ${selectedForDiscard.length === 1 ? "selecionada" : "selecionadas"} para descarte`}
        actions={[{ label: "Descartar", isDanger: true, onClick: () => setConfirmation({ kind: "discard", ids: selectedForDiscard.map((message) => message.id) }) }]}
        onClear={() => setSelectedIds(new Set())}
      />

      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !working) setConfirmation(null); }}>
        <DialogContent className="rounded-ds-modal sm:max-w-lg">
          {confirmation?.kind === "discard" ? <><DialogHeader><DialogTitle>Descartar {confirmation.ids.length === 1 ? "esta mensagem" : `${confirmation.ids.length} mensagens`}?</DialogTitle><DialogDescription>O descarte será auditado e não excluirá o e-mail original. Nenhuma despesa ou pagamento será criado. Mensagens já vinculadas ou em processamento são bloqueadas pelo servidor.</DialogDescription></DialogHeader><DialogFooter><Button variant="ds-secondary" size="md" onClick={() => setConfirmation(null)}>Voltar</Button><Button variant="danger" size="md" onClick={confirmAction} disabled={working === "discard:many"}><Trash2 className="mr-2 h-4 w-4" />Confirmar descarte</Button></DialogFooter></> : null}
          {confirmation?.kind === "link" ? <><DialogHeader><DialogTitle>{confirmation.resolutionOnly ? "Confirmar identificação?" : confirmation.message.provisionSuggestion?.status === "suggested" ? "Vincular esta cobrança à previsão?" : "Confirmar vínculo?"}</DialogTitle><DialogDescription>{confirmation.resolutionOnly ? "A mensagem será registrada como lembrete de uma despesa existente. Nome, valor e pagamento serão preservados; identificadores confirmados do documento poderão ser agregados." : confirmation.message.provisionSuggestion?.status === "suggested" ? <>A cobrança será vinculada à previsão “{confirmation.message.provisionSuggestion.description || "Previsão encontrada"}”. O nome e a classificação oficial serão mantidos, a obrigação não será duplicada e nenhum pagamento será autorizado ou executado.</> : <>Esta ação registra a relação entre a cobrança e {confirmation.alternative ? `“${confirmation.alternative.description}”` : "o lançamento sugerido"}. Ela não autoriza nem executa pagamento.</>}</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3 text-sm"><p className="text-xs font-medium text-muted-foreground">Cobrança recebida</p><p className="font-semibold">{confirmation.message.subject}</p><p className="mt-1 text-muted-foreground">{formatAmount(confirmation.message.classification.amountCents)} · vence em {formatDate(confirmation.message.classification.dueDate)}</p>{confirmation.message.provisionSuggestion?.status === "suggested" && !confirmation.resolutionOnly ? <><p className="mt-3 border-t pt-3 text-xs font-medium text-muted-foreground">Previsão vinculada</p><p className="font-semibold">{confirmation.message.provisionSuggestion.description || "Previsão encontrada"}</p><p className="mt-1 text-muted-foreground">{formatAmount(confirmation.message.provisionSuggestion.provisionedAmountCents)}</p></> : null}</div><DialogFooter><Button variant="ds-secondary" size="md" onClick={() => setConfirmation(null)}>Revisar novamente</Button><Button variant="primary-modal" size="md" onClick={confirmAction}>{confirmation.resolutionOnly ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Link2 className="mr-2 h-4 w-4" />}{confirmation.resolutionOnly ? "Registrar como já existente" : confirmation.message.provisionSuggestion?.status === "suggested" ? "Vincular e atualizar informações" : "Registrar vínculo"}</Button></DialogFooter></> : null}
          {confirmation?.kind === "create" ? <><DialogHeader><DialogTitle>Criar uma nova despesa?</DialogTitle><DialogDescription>Use esta opção quando a cobrança realmente representar uma nova obrigação. As correspondências encontradas continuarão disponíveis para evitar duplicidade.</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3 text-sm"><p className="font-semibold">{confirmation.message.subject}</p><p className="mt-1 text-muted-foreground">{formatAmount(confirmation.message.classification.amountCents)} · vence em {formatDate(confirmation.message.classification.dueDate)}</p>{(confirmation.message.existingExpenseSuggestion?.alternatives?.length ?? 0) > 0 ? <p className="mt-2 font-medium text-ds-warn">Há lançamentos semelhantes. Confirme que esta é uma obrigação diferente.</p> : null}</div><DialogFooter><Button variant="ds-secondary" size="md" onClick={() => setConfirmation(null)}>Voltar</Button><Button variant="primary-modal" size="md" asChild><Link href={`${FINANCIAL_ROUTES.newExpense}?inbox=${encodeURIComponent(confirmation.message.id)}`}>Continuar e criar</Link></Button></DialogFooter></> : null}
          {confirmation?.kind === "payment" ? <><DialogHeader><DialogTitle>Preparar solicitação de pagamento</DialogTitle><DialogDescription><strong>Preparar não autoriza, agenda nem executa pagamento.</strong> A solicitação seguirá para a fila de autorizações financeiras.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-xl border bg-muted/30 p-3"><p className="text-sm font-semibold">{confirmation.message.subject}</p><p className="mt-1 font-mono text-lg font-bold">{formatAmount(confirmation.message.classification.amountCents)}</p></div>{!confirmation.message.classification.barcode ? <div><label htmlFor="payment-barcode" className="text-sm font-medium">Código de barras</label><Input id="payment-barcode" className="mt-1 font-mono" value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} placeholder="Informe o código completo" /></div> : <p className="rounded-xl bg-ds-ok-bg p-3 text-sm text-ds-ok"><CheckCircle2 className="mr-2 inline h-4 w-4" />Código de barras extraído do documento.</p>}<div><label htmlFor="payment-beneficiary-document" className="text-sm font-medium">CNPJ do favorecido</label><Input id="payment-beneficiary-document" className="mt-1 font-mono" value={beneficiaryDocument} onChange={(event) => setBeneficiaryDocument(event.target.value)} inputMode="numeric" placeholder="00.000.000/0000-00" /><p className="mt-1 text-xs text-muted-foreground">Confirme o CNPJ que identifica o emissor no documento original.</p></div><fieldset><legend className="text-sm font-medium">Data pretendida</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{([{ value: "due", label: `Vencimento (${formatDate(confirmation.message.classification.dueDate)})` }, { value: "today", label: "Hoje" }, { value: "custom", label: "Outra data" }] as const).map((option) => <button key={option.value} type="button" onClick={() => setPaymentDateMode(option.value)} className={cn("rounded-xl border p-3 text-left text-xs font-semibold", paymentDateMode === option.value ? "border-ds-info bg-ds-info-bg text-ds-info" : "hover:bg-muted")}>{option.label}</button>)}</div></fieldset>{paymentDateMode === "custom" ? <div><label htmlFor="custom-payment-date" className="text-sm font-medium">Data</label><Input id="custom-payment-date" type="date" value={customPaymentDate} max={confirmation.message.classification.dueDate ?? undefined} onChange={(event) => setCustomPaymentDate(event.target.value)} className="mt-1" /></div> : null}<div className="flex gap-2 rounded-xl border border-ds-warn bg-ds-warn-bg p-3 text-xs text-ds-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>A autorização no sistema e a aprovação no Banco Inter continuam sendo etapas separadas.</span></div></div><DialogFooter><Button variant="ds-secondary" size="md" onClick={() => setConfirmation(null)} disabled={working === `payment:${confirmation.message.id}`}>Cancelar</Button><Button variant="primary-modal" size="md" onClick={confirmAction} disabled={working === `payment:${confirmation.message.id}`}>{working === `payment:${confirmation.message.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Enviar para autorização</Button></DialogFooter></> : null}
          {confirmation?.kind === "external" ? <><DialogHeader><DialogTitle>Abrir documento externo verificado?</DialogTitle><DialogDescription>O host e a rota pertencem a um provedor documental autorizado. Essa validação não substitui a conferência do conteúdo e dos dados da cobrança.</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Provedor verificado</p><p className="text-sm font-bold text-ds-ok">{confirmation.provider}</p><p className="mt-3 text-xs text-muted-foreground">Domínio</p><p className="font-mono text-sm font-bold">{confirmation.domain}</p><p className="mt-2 break-all text-xs text-muted-foreground">{confirmation.url}</p></div><DialogFooter><Button variant="ds-secondary" size="md" onClick={() => setConfirmation(null)}>Cancelar</Button><Button variant="primary-modal" size="md" onClick={confirmAction}><ExternalLink className="mr-2 h-4 w-4" />Abrir link verificado</Button></DialogFooter></> : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
