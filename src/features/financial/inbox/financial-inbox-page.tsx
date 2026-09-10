"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  CircleDot,
  Download,
  ExternalLink,
  FileText,
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
import type {
  FinancialInboxBillingIdentity,
  FinancialInboxExpenseAlternative,
  FinancialInboxMessage,
  FinancialInboxStage,
  FinancialInboxStatus,
  FinancialInboxSummary,
} from "./types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const STATUS_TONE: Record<FinancialInboxStatus, string> = {
  pending_review: "border-amber-200 bg-amber-50 text-amber-800",
  document_pending: "border-amber-200 bg-amber-50 text-amber-800",
  suggestion_available: "border-violet-200 bg-violet-50 text-violet-800",
  under_review: "border-sky-200 bg-sky-50 text-sky-800",
  linked: "border-blue-200 bg-blue-50 text-blue-800",
  awaiting_authorization: "border-blue-200 bg-blue-50 text-blue-800",
  scheduled: "border-blue-200 bg-blue-50 text-blue-800",
  awaiting_statement: "border-cyan-200 bg-cyan-50 text-cyan-800",
  reconciled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  divergent: "border-orange-200 bg-orange-50 text-orange-800",
  ignored: "border-stone-200 bg-stone-50 text-stone-600",
  archived: "border-stone-300 bg-stone-100 text-stone-700",
  error: "border-red-200 bg-red-50 text-red-800",
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

const STAGE_OPTIONS: Array<{ value: FinancialInboxStage | "all"; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "classify", label: "Classificar" },
  { value: "link", label: "Vincular" },
  { value: "pay", label: "Preparar" },
  { value: "bank", label: "No banco" },
  { value: "done", label: "Concluídas" },
  { value: "off", label: "Descartadas" },
  { value: "archive", label: "Arquivadas" },
];

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
  | { kind: "link"; message: FinancialInboxMessage; alternative?: FinancialInboxExpenseAlternative }
  | { kind: "payment"; message: FinancialInboxMessage }
  | { kind: "external"; url: string; domain: string };

type ComparisonRow = {
  label: string;
  received: string;
  registered: string;
  state: "same" | "different" | "missing";
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
  const rows: ComparisonRow[] = [
    {
      label: "Fornecedor",
      received: message.classification.supplierName || "—",
      registered: target.supplier || "—",
      state: "missing",
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
  if (sourceIdentity?.customerAccount || targetIdentity?.customerAccount) {
    rows.push({ label: "Conta do cliente", received: identityValue(sourceIdentity, "account"), registered: identityValue(targetIdentity, "account"), state: "missing" });
  }
  if (sourceIdentity?.contractNumber || targetIdentity?.contractNumber) {
    rows.push({ label: "Contrato", received: identityValue(sourceIdentity, "contract"), registered: identityValue(targetIdentity, "contract"), state: "missing" });
  }
  if ((sourceIdentity?.serviceNumbers?.length ?? 0) > 0 || (targetIdentity?.serviceNumbers?.length ?? 0) > 0) {
    rows.push({ label: "Linha / telefone", received: identityValue(sourceIdentity, "phone"), registered: identityValue(targetIdentity, "phone"), state: "missing" });
  }
  return rows.map((row) => ({ ...row, state: comparisonState(row.received, row.registered) }));
}

function StatusChip({ status }: { status: FinancialInboxStatus }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap text-[10px] font-semibold", STATUS_TONE[status])}>{STATUS_LABEL[status]}</Badge>;
}

function SummaryCard(props: {
  title: string;
  count: number;
  amountCents: number;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        props.active && "border-violet-300 ring-2 ring-violet-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{props.title}</p>
          <p className="mt-2 text-xl font-bold tracking-tight">{formatAmount(props.amountCents)}</p>
        </div>
        <span className="rounded-xl bg-muted p-2 text-foreground">{props.icon}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{props.count} {props.count === 1 ? "cobrança" : "cobranças"} · {props.detail}</p>
    </button>
  );
}

export function FinancialInboxPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<FinancialInboxMessage[]>([]);
  const [summary, setSummary] = useState<FinancialInboxSummary>(EMPTY_SUMMARY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<FinancialInboxStage | "all">("all");
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

  const canAnalyze = permissions.financial?.inbox?.analyze === true;
  const canLink = permissions.financial?.inbox?.link === true
    && permissions.financial?.expenses?.create === true
    && permissions.financial?.expenses?.edit === true;
  const canDiscard = permissions.financial?.inbox?.discard === true;
  const canPreparePayment = permissions.financial?.expenses?.edit === true
    && permissions.financial?.paymentRequests?.view === true
    && permissions.financial?.paymentRequests?.create === true;
  const selected = useMemo(() => messages.find((message) => message.id === selectedId) ?? null, [messages, selectedId]);
  const selectedForDiscard = useMemo(
    () => messages.filter((message) => selectedIds.has(message.id) && isFinancialInboxBulkDiscardEligible(message)),
    [messages, selectedIds],
  );
  const selectedComparison = useMemo(() => selected ? comparisonRows(selected) : [], [selected]);

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
      const query = new URLSearchParams({ limit: "25" });
      if (stage !== "all") query.set("stage", stage);
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
      setSelectedId((current) => nextMessages.some((message) => message.id === current) ? current : nextMessages[0]?.id ?? null);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar cobranças." });
    } finally {
      setLoading(false);
    }
  }, [api, cursor, firebaseUser, search, stage, toast]);

  useEffect(() => { void load(); }, [load]);

  function changeStage(nextStage: FinancialInboxStage | "all") {
    setStage(nextStage);
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

  async function linkSuggestion(message: FinancialInboxMessage, alternative?: FinancialInboxExpenseAlternative) {
    const key = alternative ? `${alternative.expenseId}:${alternative.installmentNumber ?? "expense"}` : "suggestion";
    setWorking(`link:${message.id}:${key}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/link`, {
        method: "POST",
        ...(alternative ? { body: JSON.stringify({ expenseId: alternative.expenseId, installmentNumber: alternative.installmentNumber }) } : {}),
      });
      toast({
        title: "Cobrança vinculada.",
        description: alternative
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
    setWorking(`payment:${message.id}`);
    try {
      await api(`/api/financial/inbox/${encodeURIComponent(message.id)}/payment`, {
        method: "POST",
        body: JSON.stringify({ scheduledFor, ...(message.classification.barcode ? {} : { barcode: manualBarcode.trim() }) }),
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
      if (parsed.protocol !== "https:") throw new Error();
      setConfirmation({ kind: "external", url, domain: parsed.hostname });
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
    if (action.kind === "link") void linkSuggestion(action.message, action.alternative);
    if (action.kind === "external") window.open(action.url, "_blank", "noopener,noreferrer");
  }

  if (!permissions.financial?.inbox?.view) {
    return <FinancialAccessGuard title="Caixa de cobranças" description="Seu perfil não possui permissão para consultar cobranças recebidas." />;
  }

  return (
    <PageContainer variant="default" className="space-y-5 pb-28">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href={FINANCIAL_ROUTES.expenses} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Despesas
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><Inbox className="h-6 w-6" />Caixa de cobranças</h1>
          <p className="mt-1 text-sm text-muted-foreground">Analise, vincule e prepare cobranças recebidas sem misturar e-mail, obrigação e pagamento.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {lastLoadedAt ? <span className="text-xs text-muted-foreground">Lista atualizada às {formatDateTime(lastLoadedAt).split(" ").at(-1)}</span> : null}
          <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />Atualizar lista</Button>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
        <div><strong>Entrada protegida.</strong> Receber ou analisar não cria despesa, não autoriza pagamento e não envia nada ao banco. O e-mail original permanece arquivado.</div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Para classificar" count={summary.stages.classify.count} amountCents={summary.stages.classify.amountCents} icon={<CircleDot className="h-5 w-5 text-amber-600" />} detail="revisão ou documento" active={stage === "classify"} onClick={() => changeStage("classify")} />
        <SummaryCard title="Para vincular" count={summary.stages.link.count} amountCents={summary.stages.link.amountCents} icon={<Link2 className="h-5 w-5 text-violet-600" />} detail="sugestão disponível" active={stage === "link"} onClick={() => changeStage("link")} />
        <SummaryCard title="Para preparar" count={summary.stages.pay.count} amountCents={summary.stages.pay.amountCents} icon={<Banknote className="h-5 w-5 text-blue-600" />} detail="despesa já vinculada" active={stage === "pay"} onClick={() => changeStage("pay")} />
        <SummaryCard title="No banco" count={summary.stages.bank.count} amountCents={summary.stages.bank.amountCents} icon={<Landmark className="h-5 w-5 text-cyan-600" />} detail={`${summary.stages.done.count} conciliadas à parte`} active={stage === "bank"} onClick={() => changeStage("bank")} />
      </div>

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-lg">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="pl-9" placeholder="Buscar fornecedor, assunto, valor, conta ou telefone..." aria-label="Buscar cobranças" />
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto pb-1 lg:pb-0" role="tablist" aria-label="Etapa da cobrança">
            {STAGE_OPTIONS.map((option) => {
              const count = option.value === "all" ? summary.total.count : summary.stages[option.value].count;
              return (
                <button key={option.value} type="button" role="tab" aria-selected={stage === option.value} onClick={() => changeStage(option.value)} className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition", stage === option.value ? "bg-foreground text-background" : "hover:bg-muted hover:text-foreground")}>{option.label} <span className="ml-1 opacity-70">{count}</span></button>
              );
            })}
          </div>
        </div>

        {searchTruncated ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">A busca verificou as 500 mensagens mais recentes deste filtro. Refine os termos para localizar registros mais antigos.</div>
        ) : null}

        {loading ? (
          <div className="flex h-72 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
        ) : messages.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center"><Inbox className="h-9 w-9 text-muted-foreground" /><p className="font-semibold">Nenhuma cobrança encontrada</p><p className="max-w-md text-sm text-muted-foreground">Ajuste a etapa ou a busca. Receber mensagens continua sendo uma operação sem efeito financeiro.</p></div>
        ) : (
          <div className="grid min-h-[640px] lg:grid-cols-[minmax(330px,0.76fr)_minmax(0,1.24fr)]">
            <div className="border-b lg:border-b-0 lg:border-r">
              <div className="max-h-[780px] divide-y overflow-y-auto">
                {messages.map((message) => {
                  const discardEligible = canDiscard && isFinancialInboxBulkDiscardEligible(message);
                  const checked = selectedIds.has(message.id);
                  return (
                    <div
                      key={message.id}
                      role="button"
                      tabIndex={0}
                      aria-current={selectedId === message.id ? "true" : undefined}
                      onClick={() => setSelectedId(message.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(message.id);
                        }
                      }}
                      className={cn("group flex cursor-pointer gap-3 p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selectedId === message.id ? "bg-violet-50/70" : "hover:bg-muted/40")}
                    >
                      <Checkbox checked={checked} disabled={!discardEligible} aria-label={`Selecionar ${message.subject} para descarte`} onClick={(event) => event.stopPropagation()} onCheckedChange={(value) => toggleSelected(message, value === true)} className="mt-1" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-bold">{senderLabel(message)}</p><span className="font-mono text-xs font-semibold">{formatAmount(message.classification.amountCents)}</span></div>
                        <p className="mt-1 line-clamp-2 text-sm leading-5">{message.subject}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2"><StatusChip status={message.status} /><Badge variant="outline" className="bg-background text-[10px]">{TYPE_LABEL[message.classification.documentType]}</Badge><span className="ml-auto text-[11px] text-muted-foreground">{formatDateTime(message.receivedAt)}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between border-t p-3">
                <Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={() => { const previous = cursorStack.at(-1) || null; setCursorStack((current) => current.slice(0, -1)); setCursor(previous); }}><ArrowLeft className="mr-2 h-4 w-4" />Anterior</Button>
                <Button variant="outline" size="sm" disabled={!nextCursor} onClick={() => { if (!nextCursor) return; setCursorStack((current) => [...current, cursor ?? ""]); setCursor(nextCursor); }}>Próxima<ArrowRight className="ml-2 h-4 w-4" /></Button>
              </div>
            </div>

            {selected ? (
              <div className="min-w-0">
                <div className="border-b p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><div className="mb-2 flex flex-wrap gap-2"><StatusChip status={selected.status} /><Badge variant="outline">{TYPE_LABEL[selected.classification.documentType]}</Badge></div><h2 className="text-xl font-bold tracking-tight">{selected.subject}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{selected.from}</p></div>
                    <p className="font-mono text-xl font-bold">{formatAmount(selected.classification.amountCents)}</p>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Competência</p><p className="font-semibold">{formatCompetence(selected.classification.competence)}</p></div><div><p className="text-xs text-muted-foreground">Vencimento</p><p className="font-semibold">{formatDate(selected.classification.dueDate)}</p></div><div><p className="text-xs text-muted-foreground">Recebimento</p><p className="font-semibold">{formatDateTime(selected.receivedAt)}</p></div></div>
                </div>

                <div className="space-y-5 p-5">
                  <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-700">Próxima decisão</p>
                    <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        {financialInboxStageForStatus(selected.status) === "classify" ? <><p className="font-bold">Analisar documentos e localizar o lançamento</p><p className="text-sm text-muted-foreground">A análise atualiza sugestões; não cria nem altera despesas.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "link" ? <><p className="font-bold">Confirmar a despesa ou previsão correspondente</p><p className="text-sm text-muted-foreground">Confira divergências antes de registrar o vínculo.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "pay" ? <><p className="font-bold">Preparar solicitação para autorização</p><p className="text-sm text-muted-foreground">Preparar não agenda, autoriza ou executa o pagamento.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "bank" ? <><p className="font-bold">Acompanhar a situação no banco</p><p className="text-sm text-muted-foreground">A conciliação só ocorre depois da liquidação encontrada no extrato.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "done" ? <><p className="font-bold">Cobrança conciliada</p><p className="text-sm text-muted-foreground">O vínculo e a liquidação foram preservados para auditoria.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "off" ? <><p className="font-bold">Mensagem descartada</p><p className="text-sm text-muted-foreground">Nenhum efeito financeiro foi produzido.</p></> : null}
                        {financialInboxStageForStatus(selected.status) === "archive" ? <><p className="font-bold">Mensagem arquivada pela política de retenção</p><p className="text-sm text-muted-foreground">Fora da caixa operacional; a trilha e os vínculos continuam preservados.</p></> : null}
                      </div>
                      <div className="shrink-0">
                        {financialInboxStageForStatus(selected.status) === "classify" && canAnalyze ? <Button onClick={() => void analyze(selected)} disabled={working === `analyze:${selected.id}`}><Sparkles className="mr-2 h-4 w-4" />Analisar cobrança</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "link" && canLink && selected.existingExpenseSuggestion?.status === "suggested" ? <Button onClick={() => setConfirmation({ kind: "link", message: selected })}><Link2 className="mr-2 h-4 w-4" />Vincular sugestão</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "link" && canLink && selected.provisionSuggestion?.status === "suggested" ? <Button onClick={() => setConfirmation({ kind: "link", message: selected })}><Link2 className="mr-2 h-4 w-4" />Substituir previsão</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "pay" && canPreparePayment && !selected.paymentRequestId ? <Button onClick={() => setConfirmation({ kind: "payment", message: selected })}><ShieldCheck className="mr-2 h-4 w-4" />Preparar pagamento</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "bank" && permissions.financial?.paymentRequests?.view ? <Button asChild><Link href={FINANCIAL_ROUTES.paymentRequests}><Landmark className="mr-2 h-4 w-4" />Abrir no banco</Link></Button> : null}
                        {financialInboxStageForStatus(selected.status) === "off" && canDiscard ? <Button variant="outline" onClick={() => void review(selected, "pending_review")} disabled={working === `review:${selected.id}`}><RotateCcw className="mr-2 h-4 w-4" />Reabrir</Button> : null}
                        {financialInboxStageForStatus(selected.status) === "archive" && canDiscard ? <Button variant="outline" onClick={() => void restoreArchived(selected)} disabled={working === `restore:${selected.id}`}>{working === `restore:${selected.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Restaurar</Button> : null}
                      </div>
                    </div>
                  </section>

                  {selectedComparison.length > 0 ? (
                    <section className="overflow-hidden rounded-2xl border">
                      <div className="border-b bg-muted/30 px-4 py-3"><h3 className="flex items-center gap-2 text-sm font-bold"><Sparkles className="h-4 w-4 text-violet-600" />Comparação com o cadastro</h3><p className="mt-1 text-xs text-muted-foreground">O vínculo continua dependendo da sua confirmação.</p></div>
                      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-3">Campo</th><th className="px-4 py-3">No e-mail</th><th className="px-4 py-3">No sistema</th><th className="px-4 py-3">Conferência</th></tr></thead><tbody className="divide-y">{selectedComparison.map((row) => <tr key={row.label}><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 py-3">{row.received}</td><td className="px-4 py-3">{row.registered}</td><td className="px-4 py-3">{row.state === "same" ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><Check className="h-4 w-4" />Confere</span> : row.state === "different" ? <span className="inline-flex items-center gap-1 font-semibold text-orange-700"><AlertTriangle className="h-4 w-4" />Divergente</span> : <span className="text-muted-foreground">Não informado</span>}</td></tr>)}</tbody></table></div>
                    </section>
                  ) : null}

                  <section className="rounded-2xl border p-4">
                    <h3 className="flex items-center gap-2 text-sm font-bold"><Link2 className="h-4 w-4 text-violet-600" />Lançamento sugerido</h3>
                    {["suggested", "linked"].includes(selected.existingExpenseSuggestion?.status ?? "") ? (
                      <div className="mt-3"><p className="font-semibold">{selected.existingExpenseSuggestion?.description || "Despesa encontrada"}</p><p className="mt-1 text-sm text-muted-foreground">{[selected.existingExpenseSuggestion?.supplier, installmentLabel(selected), formatAmount(selected.existingExpenseSuggestion?.amountCents), formatDate(selected.existingExpenseSuggestion?.dueDate)].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-muted-foreground">{selected.existingExpenseSuggestion?.reasons.join(" · ")}</p></div>
                    ) : selected.provisionSuggestion?.status === "suggested" ? (
                      <div className="mt-3"><p className="font-semibold">{selected.provisionSuggestion.description || "Previsão encontrada"}</p><p className="mt-1 text-sm text-muted-foreground">{formatAmount(selected.provisionSuggestion.provisionedAmountCents)} · {selected.provisionSuggestion.reasons.join(" · ")}</p></div>
                    ) : selected.creationSuggestion?.status === "suggested" ? (
                      <div className="mt-3"><p className="font-semibold">Nova despesa sugerida</p><p className="mt-1 text-sm text-muted-foreground">Nenhum lançamento compatível foi encontrado. O cadastro ficará preenchido para sua revisão.</p></div>
                    ) : selected.creationSuggestion?.status === "incomplete" ? (
                      <p className="mt-3 text-sm text-amber-700">Ainda falta confirmar: {selected.creationSuggestion.missingFields.join(", ")}.</p>
                    ) : <p className="mt-3 text-sm text-muted-foreground">Nenhuma correspondência única foi encontrada.</p>}

                    {!selected.linkedExpenseId && selected.existingExpenseSuggestion?.status !== "suggested" && (selected.existingExpenseSuggestion?.alternatives?.length ?? 0) > 0 ? (
                      <div className="mt-4 space-y-2 border-t pt-4"><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Alternativas — confirmação manual</p>{selected.existingExpenseSuggestion!.alternatives!.map((alternative) => <div key={`${alternative.expenseId}:${alternative.installmentNumber ?? "expense"}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3"><div><p className="text-sm font-semibold">{alternative.description}</p><p className="text-xs text-muted-foreground">{[alternative.supplier, alternative.installmentNumber ? `Parcela ${alternative.installmentNumber}${alternative.installmentTotal ? `/${alternative.installmentTotal}` : ""}` : null, formatAmount(alternative.amountCents), formatDate(alternative.dueDate)].filter(Boolean).join(" · ")}</p><p className="mt-1 text-[11px] text-muted-foreground">{alternative.reasons.join(" · ")}</p></div>{canLink ? <Button variant="outline" size="sm" onClick={() => setConfirmation({ kind: "link", message: selected, alternative })}>Escolher vínculo</Button> : null}</div>)}</div>
                    ) : null}

                    {selected.linkedExpenseId ? <div className="mt-4 flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Vinculada à despesa {selected.linkedExpenseId}{selected.linkedExpenseInstallmentNumber ? `, parcela ${selected.linkedExpenseInstallmentNumber}` : ""}.</span></div> : null}
                    {selected.existingExpenseSuggestion?.paymentState === "paid" ? <div className="mt-3 flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>Liquidação confirmada pelo extrato{selected.existingExpenseSuggestion.existingSettlement?.paidAt ? ` em ${formatDate(selected.existingExpenseSuggestion.existingSettlement.paidAt)}` : ""}.</span></div> : null}
                    {selected.existingExpenseSuggestion?.paymentState === "scheduled" ? <div className="mt-3 flex gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-800"><Landmark className="mt-0.5 h-4 w-4 shrink-0" /><span>Há uma solicitação bancária existente. O agendamento não é tratado como liquidação.</span></div> : null}
                  </section>

                  {selected.classification.billingIdentity && (selected.classification.billingIdentity.customerAccount || selected.classification.billingIdentity.contractNumber || selected.classification.billingIdentity.serviceNumbers.length > 0 || selected.classification.billingIdentity.supplierTaxId) ? (
                    <section className="rounded-2xl border p-4"><h3 className="text-sm font-bold">Identificadores da cobrança</h3><div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{selected.classification.billingIdentity.customerAccount ? <div><p className="text-xs text-muted-foreground">Conta</p><p className="font-semibold">{selected.classification.billingIdentity.customerAccount}</p></div> : null}{selected.classification.billingIdentity.contractNumber ? <div><p className="text-xs text-muted-foreground">Contrato</p><p className="font-semibold">{selected.classification.billingIdentity.contractNumber}</p></div> : null}{selected.classification.billingIdentity.serviceNumbers.map((number) => <div key={number}><p className="text-xs text-muted-foreground">Linha / telefone</p><p className="font-semibold">{number}</p></div>)}{selected.classification.billingIdentity.supplierTaxId ? <div><p className="text-xs text-muted-foreground">CNPJ do fornecedor</p><p className="font-semibold">{selected.classification.billingIdentity.supplierTaxId}</p></div> : null}</div></section>
                  ) : null}

                  <Accordion type="multiple" defaultValue={["documents"]} className="rounded-2xl border px-4">
                    <AccordionItem value="email"><AccordionTrigger className="text-sm">Conteúdo do e-mail</AccordionTrigger><AccordionContent><p className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/30 p-4 leading-6">{selected.textContent || "O e-mail não possui conteúdo textual."}</p></AccordionContent></AccordionItem>
                    <AccordionItem value="documents"><AccordionTrigger className="text-sm">Documentos arquivados ({selected.attachments.filter((attachment) => attachment.storagePath).length + (selected.rawStoragePath ? 1 : 0)})</AccordionTrigger><AccordionContent><div className="flex flex-wrap gap-2">{selected.attachments.filter((attachment) => attachment.storagePath).map((attachment) => <Button key={attachment.id} variant="outline" size="sm" onClick={() => void openFile(selected, attachment.id)} disabled={working === `file:${attachment.id}`}>{working === `file:${attachment.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}{attachment.filename}{attachment.extractionStatus === "failed" ? <XCircle className="ml-2 h-3.5 w-3.5 text-red-600" /> : attachment.extractionStatus === "needs_ocr" ? <AlertTriangle className="ml-2 h-3.5 w-3.5 text-amber-600" /> : attachment.extractionStatus === "extracted" || attachment.extractionStatus === "ocr_extracted" ? <Check className="ml-2 h-3.5 w-3.5 text-emerald-600" /> : null}</Button>)}{selected.rawStoragePath ? <Button variant="ghost" size="sm" onClick={() => void openFile(selected, "raw")} disabled={working === "file:raw"}><Download className="mr-2 h-4 w-4" />E-mail original (.eml)</Button> : null}{!selected.rawStoragePath && !selected.attachments.some((attachment) => attachment.storagePath) ? <p className="text-sm text-muted-foreground">Nenhum documento foi arquivado.</p> : null}</div>{selected.linkResolution?.message ? <p className={cn("mt-3 text-xs", selected.linkResolution.status === "resolved" ? "text-emerald-700" : selected.linkResolution.status === "requires_login" ? "text-amber-700" : "text-muted-foreground")}>{selected.linkResolution.message}</p> : null}</AccordionContent></AccordionItem>
                    {selected.classification.links.length > 0 ? <AccordionItem value="links"><AccordionTrigger className="text-sm">Links enviados pelo fornecedor ({selected.classification.links.length})</AccordionTrigger><AccordionContent><p className="mb-3 text-xs text-muted-foreground">O domínio será mostrado para confirmação antes de abrir. A análise automática aceita apenas destinos permitidos.</p><div className="grid gap-2">{selected.classification.links.map((link) => <button key={link} type="button" onClick={() => openExternalConfirmation(link)} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm text-blue-700 hover:bg-blue-50"><span className="truncate">{link}</span><ExternalLink className="h-4 w-4 shrink-0" /></button>)}</div></AccordionContent></AccordionItem> : null}
                  </Accordion>

                  {selected.archiveWarnings.length > 0 ? <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div>{selected.archiveWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <div className="text-[11px] text-muted-foreground"><p>Mensagem: {selected.id}</p><p>Atualizada em {formatDateTime(selected.updatedAt)} · origem {selected.provider}</p>{selected.paymentRequestId ? <p>Solicitação de pagamento: {selected.paymentRequestId}</p> : null}{selected.statementTransactionId ? <p>Movimentação conciliada: {selected.statementTransactionId}</p> : null}</div>
                    <div className="flex flex-wrap gap-2">{canLink && !selected.linkedExpenseId && selected.creationSuggestion?.status !== "blocked_by_ambiguity" ? <Button asChild variant="outline"><Link href={`${FINANCIAL_ROUTES.newExpense}?inbox=${encodeURIComponent(selected.id)}`}>{selected.creationSuggestion?.status === "suggested" ? "Criar despesa preenchida" : "Registrar manualmente"}</Link></Button> : null}{canDiscard && selected.status !== "ignored" && isFinancialInboxBulkDiscardEligible(selected) ? <Button variant="outline" onClick={() => setConfirmation({ kind: "discard", ids: [selected.id] })}><Trash2 className="mr-2 h-4 w-4" />Descartar</Button> : null}</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {selectedForDiscard.length > 0 ? (
        <div className="fixed bottom-5 left-1/2 z-40 flex w-[min(calc(100%-2rem),620px)] -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl border bg-foreground p-3 text-background shadow-2xl"><div className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-full bg-background/15 text-sm font-bold">{selectedForDiscard.length}</span><div><p className="text-sm font-bold">Selecionadas para descarte</p><p className="text-xs text-background/70">Sem despesa vinculada ou pagamento</p></div></div><div className="flex gap-2"><Button variant="ghost" className="text-background hover:bg-background/10 hover:text-background" onClick={() => setSelectedIds(new Set())}>Limpar</Button><Button variant="secondary" onClick={() => setConfirmation({ kind: "discard", ids: selectedForDiscard.map((message) => message.id) })}><Trash2 className="mr-2 h-4 w-4" />Descartar</Button></div></div>
      ) : null}

      <Dialog open={confirmation !== null} onOpenChange={(open) => { if (!open && !working) setConfirmation(null); }}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          {confirmation?.kind === "discard" ? <><DialogHeader><DialogTitle>Descartar {confirmation.ids.length === 1 ? "esta mensagem" : `${confirmation.ids.length} mensagens`}?</DialogTitle><DialogDescription>O descarte será auditado e não excluirá o e-mail original. Nenhuma despesa ou pagamento será criado. Mensagens já vinculadas ou em processamento são bloqueadas pelo servidor.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>Voltar</Button><Button variant="destructive" onClick={confirmAction} disabled={working === "discard:many"}><Trash2 className="mr-2 h-4 w-4" />Confirmar descarte</Button></DialogFooter></> : null}
          {confirmation?.kind === "link" ? <><DialogHeader><DialogTitle>Confirmar vínculo?</DialogTitle><DialogDescription>Esta ação registra a relação entre a cobrança e {confirmation.alternative ? `“${confirmation.alternative.description}”` : "o lançamento sugerido"}. Ela não autoriza nem executa pagamento.</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3 text-sm"><p className="font-semibold">{confirmation.message.subject}</p><p className="mt-1 text-muted-foreground">{formatAmount(confirmation.message.classification.amountCents)} · vence em {formatDate(confirmation.message.classification.dueDate)}</p></div><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>Revisar novamente</Button><Button onClick={confirmAction}><Link2 className="mr-2 h-4 w-4" />Registrar vínculo</Button></DialogFooter></> : null}
          {confirmation?.kind === "payment" ? <><DialogHeader><DialogTitle>Preparar solicitação de pagamento</DialogTitle><DialogDescription><strong>Preparar não autoriza, agenda nem executa pagamento.</strong> A solicitação seguirá para a fila de autorizações financeiras.</DialogDescription></DialogHeader><div className="space-y-4"><div className="rounded-xl border bg-muted/30 p-3"><p className="text-sm font-semibold">{confirmation.message.subject}</p><p className="mt-1 font-mono text-lg font-bold">{formatAmount(confirmation.message.classification.amountCents)}</p></div>{!confirmation.message.classification.barcode ? <div><label htmlFor="payment-barcode" className="text-sm font-medium">Código de barras</label><Input id="payment-barcode" className="mt-1 font-mono" value={manualBarcode} onChange={(event) => setManualBarcode(event.target.value)} placeholder="Informe o código completo" /></div> : <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" />Código de barras extraído do documento.</p>}<fieldset><legend className="text-sm font-medium">Data pretendida</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{([{ value: "due", label: `Vencimento (${formatDate(confirmation.message.classification.dueDate)})` }, { value: "today", label: "Hoje" }, { value: "custom", label: "Outra data" }] as const).map((option) => <button key={option.value} type="button" onClick={() => setPaymentDateMode(option.value)} className={cn("rounded-xl border p-3 text-left text-xs font-semibold", paymentDateMode === option.value ? "border-violet-400 bg-violet-50 text-violet-800" : "hover:bg-muted")}>{option.label}</button>)}</div></fieldset>{paymentDateMode === "custom" ? <div><label htmlFor="custom-payment-date" className="text-sm font-medium">Data</label><Input id="custom-payment-date" type="date" value={customPaymentDate} max={confirmation.message.classification.dueDate ?? undefined} onChange={(event) => setCustomPaymentDate(event.target.value)} className="mt-1" /></div> : null}<div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>A autorização no sistema e a aprovação no Banco Inter continuam sendo etapas separadas.</span></div></div><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)} disabled={working === `payment:${confirmation.message.id}`}>Cancelar</Button><Button onClick={confirmAction} disabled={working === `payment:${confirmation.message.id}`}>{working === `payment:${confirmation.message.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Enviar para autorização</Button></DialogFooter></> : null}
          {confirmation?.kind === "external" ? <><DialogHeader><DialogTitle>Abrir site externo?</DialogTitle><DialogDescription>O link será aberto em uma nova aba. Confirme o domínio antes de continuar.</DialogDescription></DialogHeader><div className="rounded-xl border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Domínio</p><p className="font-mono text-sm font-bold">{confirmation.domain}</p><p className="mt-2 break-all text-xs text-muted-foreground">{confirmation.url}</p></div><DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>Cancelar</Button><Button onClick={confirmAction}><ExternalLink className="mr-2 h-4 w-4" />Abrir link</Button></DialogFooter></> : null}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
