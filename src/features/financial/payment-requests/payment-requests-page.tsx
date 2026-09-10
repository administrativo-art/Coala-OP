"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/features/financial/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageContainer } from "@/components/layout/page-container";
import { BackButton } from "@/components/navigation/back-button";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import type { BankPaymentRequest, BankPaymentRequestStatus } from "./types";
import {
  buildPaymentTimeline,
  financialDaysUntil,
  formatFinancialDate,
  formatFinancialDateTime,
  isWithinPastFinancialDays,
} from "./timeline";

/* -------------------------------------------------------------------------- */
/*  Estágios                                                                    */
/* -------------------------------------------------------------------------- */

type StageGroup = "you" | "risk" | "bank" | "done";

const STATUS_LABEL: Record<BankPaymentRequestStatus, string> = {
  draft: "Rascunho",
  awaiting_financial_authorization: "Aguardando você",
  ready_to_submit: "Pronto para enviar",
  submitting: "Enviando ao banco",
  awaiting_bank_approval: "Aprovação no Inter",
  scheduled: "Agendado no Inter",
  processing: "Processando",
  awaiting_statement: "Aguardando extrato",
  paid: "Pago",
  rejected: "Rejeitado",
  approval_expired: "Aprovação expirada",
  failed: "Falha / revisão",
  cancelled: "Cancelado",
};

const STATUS_GROUP: Record<BankPaymentRequestStatus, StageGroup> = {
  draft: "you",
  awaiting_financial_authorization: "you",
  ready_to_submit: "you",
  submitting: "bank",
  awaiting_bank_approval: "bank",
  scheduled: "bank",
  processing: "bank",
  awaiting_statement: "bank",
  paid: "done",
  rejected: "risk",
  approval_expired: "risk",
  failed: "risk",
  cancelled: "risk",
};

const GROUP_ORDER: Record<StageGroup, number> = { you: 0, risk: 1, bank: 2, done: 3 };

function requiresBeneficiaryReview(item: BankPaymentRequest) {
  return item.status === "paid" && item.beneficiaryVerificationStatus === "divergent";
}

function stageGroup(item: BankPaymentRequest): StageGroup {
  return requiresBeneficiaryReview(item) ? "risk" : STATUS_GROUP[item.status];
}

function statusLabel(item: BankPaymentRequest) {
  return requiresBeneficiaryReview(item) ? "Pago · revisar favorecido" : STATUS_LABEL[item.status];
}

const GROUP_META: Record<
  StageGroup,
  { chip: string; dot: string; kpiValue: string; kpiLabel: string }
> = {
  you: {
    chip: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
    kpiValue: "text-primary",
    kpiLabel: "text-primary",
  },
  risk: {
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    dot: "bg-rose-500",
    kpiValue: "text-rose-700",
    kpiLabel: "text-rose-600",
  },
  bank: {
    chip: "border-blue-200 bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
    kpiValue: "text-foreground",
    kpiLabel: "text-blue-600",
  },
  done: {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
    kpiValue: "text-emerald-700",
    kpiLabel: "text-emerald-600",
  },
};

const TABS: { key: "all" | StageGroup; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "you", label: "Aguardando você" },
  { key: "risk", label: "Atenção" },
  { key: "bank", label: "No banco" },
  { key: "done", label: "Concluídos" },
];

const RECON_LABEL: Record<NonNullable<BankPaymentRequest["statementReconciliationStatus"]>, string> = {
  not_expected: "Não esperada",
  expected: "Esperada",
  matched: "Correspondente",
  divergent: "Divergente",
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function sourceLabel(sourceType: BankPaymentRequest["sourceType"]) {
  if (sourceType === "aso") return "ASO";
  if (sourceType === "termination") return "Rescisão CLT";
  if (sourceType === "vacation") return "Férias";
  if (sourceType === "purchase_order") return "Pedido de compra";
  if (sourceType === "financial_inbox") return "Cobrança recebida";
  return "Recibo gerado";
}

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function railLabel(item: BankPaymentRequest, long = false) {
  if (item.paymentRail === "barcode") return long ? "Código de barras" : "Boleto";
  return "Pix";
}

function destination(item: BankPaymentRequest) {
  return (
    item.beneficiarySnapshot?.maskedPaymentDestination ??
    item.barcodeSnapshot?.maskedCode ??
    "—"
  );
}

function partyName(item: BankPaymentRequest) {
  return item.beneficiarySnapshot?.name ?? "Código de barras";
}

type DueInfo = { immediate: boolean; date: string | null; days: number | null };

function dueInfo(item: BankPaymentRequest): DueInfo {
  if (item.barcodeSnapshot?.dueDate) {
    const date = item.barcodeSnapshot.dueDate;
    return { immediate: false, date, days: financialDaysUntil(date) };
  }
  if (item.scheduledFor) {
    const date = item.scheduledFor;
    return { immediate: false, date, days: financialDaysUntil(date) };
  }
  return { immediate: true, date: null, days: 0 };
}

function dueHint(group: StageGroup, due: DueInfo) {
  if (group === "done" || due.immediate || due.days === null) return "";
  if (due.days < 0) return `há ${Math.abs(due.days)}d`;
  if (due.days === 0) return "hoje";
  return `em ${due.days}d`;
}

/* -------------------------------------------------------------------------- */
/*  Ação por linha                                                              */
/* -------------------------------------------------------------------------- */

type RowActionKind = "authorize" | "submit" | "refresh" | "proof";
type RowAction = { kind: RowActionKind; label: string; primary: boolean } | null;

function rowAction(
  item: BankPaymentRequest,
  perms: ReturnType<typeof useAuth>["permissions"],
): RowAction {
  const pr = perms.financial?.paymentRequests;
  if (!pr) return null;

  if (item.status === "awaiting_financial_authorization" && pr.authorize) {
    const combined = item.sourceType === "financial_inbox" && pr.submit;
    return { kind: "authorize", label: combined ? "Autorizar e enviar" : "Autorizar", primary: true };
  }
  if (
    item.status === "failed"
    && item.lastError?.code !== "BANK_RECONCILIATION_DIVERGENCE"
    && pr.submit
  ) {
    return { kind: "submit", label: "Reenviar ao Inter", primary: true };
  }
  if (item.status === "ready_to_submit" && pr.submit) {
    return { kind: "submit", label: "Enviar ao Inter", primary: true };
  }
  if (
    ["submitting", "awaiting_bank_approval", "scheduled", "processing", "awaiting_statement"].includes(item.status) &&
    pr.refresh
  ) {
    return { kind: "refresh", label: "Atualizar situação", primary: false };
  }
  if (item.status === "paid" && item.proofStoragePath && pr.viewProof) {
    return { kind: "proof", label: "Ver comprovante", primary: false };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Página                                                                      */
/* -------------------------------------------------------------------------- */

export function PaymentRequestsPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<BankPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);

  const [tab, setTab] = useState<"all" | StageGroup>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [authorizeTarget, setAuthorizeTarget] = useState<BankPaymentRequest | null>(null);
  const [submitTarget, setSubmitTarget] = useState<BankPaymentRequest | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const pr = permissions.financial?.paymentRequests;

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!firebaseUser) throw new Error("Sessão não disponível.");
      const token = await firebaseUser.getIdToken();
      const response = await fetch(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Falha na operação."));
      return payload;
    },
    [firebaseUser],
  );

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      setItems((await api("/api/financial/payment-requests")).requests ?? []);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." });
    } finally {
      setLoading(false);
    }
  }, [api, firebaseUser, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /* --- ações --- */

  async function authorizeOne(item: BankPaymentRequest) {
    await api(`/api/financial/payment-requests/${item.id}/authorize`, { method: "POST" });
    if (item.sourceType === "financial_inbox" && pr?.submit) {
      await api(`/api/financial/payment-requests/${item.id}/submit`, { method: "POST" });
    }
  }

  async function runAction(item: BankPaymentRequest, kind: RowActionKind) {
    if (kind === "authorize") return setAuthorizeTarget(item);
    if (kind === "submit") return setSubmitTarget(item);
    if (kind === "proof") return void openProof(item.id);

    setWorking(`${item.id}:${kind}`);
    try {
      await api(`/api/financial/payment-requests/${item.id}/refresh`, { method: "POST" });
      toast({ title: "Situação bancária atualizada." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na operação." });
    } finally {
      setWorking(null);
    }
  }

  async function confirmAuthorize(item: BankPaymentRequest) {
    const combined = item.sourceType === "financial_inbox" && pr?.submit;
    setWorking(`${item.id}:authorize`);
    try {
      await authorizeOne(item);
      toast({ title: combined ? "Pagamento autorizado e enviado ao Banco Inter." : "Pagamento autorizado no Coala." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na operação." });
      await load();
    } finally {
      setWorking(null);
    }
  }

  async function confirmSubmit(item: BankPaymentRequest) {
    setWorking(`${item.id}:submit`);
    try {
      await api(`/api/financial/payment-requests/${item.id}/submit`, { method: "POST" });
      toast({ title: "Solicitação enviada ao Banco Inter." });
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na operação." });
    } finally {
      setWorking(null);
    }
  }

  async function confirmBatch(targets: BankPaymentRequest[]) {
    setBatchWorking(true);
    let ok = 0;
    let failed = 0;
    for (const target of targets) {
      try {
        await authorizeOne(target);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    if (failed === 0) {
      toast({ title: `${ok} ${ok === 1 ? "pagamento autorizado" : "pagamentos autorizados"}.` });
    } else if (ok === 0) {
      toast({ variant: "destructive", title: "Nenhum pagamento pôde ser autorizado." });
    } else {
      toast({ variant: "destructive", title: `${ok} autorizados, ${failed} com falha. Reveja a lista.` });
    }
    setSelected([]);
    setBatchWorking(false);
    await load();
  }

  async function openProof(id: string) {
    if (!firebaseUser) return;
    const preview = window.open("", "_blank");
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/payment-requests/${id}/proof`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(apiErrorMessage(payload, "Falha ao abrir comprovante."));
      }
      const url = URL.createObjectURL(await response.blob());
      if (preview) preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      preview?.close();
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir comprovante." });
    }
  }

  /* --- derivados --- */

  const groupItems = useCallback(
    (group: StageGroup) => items.filter((item) => stageGroup(item) === group),
    [items],
  );

  const sumOf = (list: BankPaymentRequest[]) => list.reduce((total, item) => total + item.amount, 0);

  const paidLast7d = useMemo(
    () =>
      items.filter((item) => item.status === "paid" && isWithinPastFinancialDays(
        item.paidAt ?? item.bankLiquidationObservedAt ?? item.updatedAt,
        7,
      )),
    [items],
  );

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items
      .filter((item) => tab === "all" || stageGroup(item) === tab)
      .filter((item) => {
        if (!term) return true;
        return (
          item.description.toLowerCase().includes(term) ||
          partyName(item).toLowerCase().includes(term) ||
          sourceLabel(item.sourceType).toLowerCase().includes(term) ||
          formatCurrency(item.amount).toLowerCase().includes(term) ||
          String(item.amount).includes(term)
        );
      })
      .sort((a, b) => {
        const byGroup = GROUP_ORDER[stageGroup(a)] - GROUP_ORDER[stageGroup(b)];
        if (byGroup !== 0) return byGroup;
        return (dueInfo(a).days ?? 9999) - (dueInfo(b).days ?? 9999);
      });
  }, [items, tab, query]);

  const selectable = (item: BankPaymentRequest) =>
    item.status === "awaiting_financial_authorization" && !!pr?.authorize;

  const selectedItems = items.filter((item) => selected.includes(item.id));
  const drawerItem = items.find((item) => item.id === drawerId) ?? null;

  function toggleSelect(item: BankPaymentRequest) {
    if (!selectable(item)) return;
    setSelected((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    );
  }

  /* --- guards --- */

  if (!pr?.view) {
    return (
      <FinancialAccessGuard
        title="Autorizações bancárias"
        description="Seu perfil não possui permissão para visualizar autorizações bancárias."
      />
    );
  }

  const kpis: { group: StageGroup; icon: typeof Target; title: string; list: BankPaymentRequest[]; note: string }[] = [
    { group: "you", icon: Target, title: "Aguardando você", list: groupItems("you"), note: "autorização financeira" },
    { group: "bank", icon: ArrowLeftRight, title: "No banco", list: groupItems("bank"), note: "aguardando ou agendado" },
    { group: "done", icon: CheckCircle2, title: "Liquidado (7 dias)", list: paidLast7d, note: "comprovantes disponíveis" },
    { group: "risk", icon: AlertTriangle, title: "Precisa de atenção", list: groupItems("risk"), note: "falha, recusa ou expirado" },
  ];

  return (
    <PageContainer variant="compact" className="space-y-5 pb-24">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Autorizações bancárias</h1>
          <p className="text-sm text-muted-foreground">
            Autorização, aprovação bancária, conciliação e comprovantes Pix.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BackButton fallbackHref={FINANCIAL_ROUTES.expenses} label="Voltar às despesas" />
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Atualizar lista
          </Button>
        </div>
      </div>

      {/* KPIs por estágio */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ group, icon: Icon, title, list, note }) => {
          const meta = GROUP_META[group];
          const hero = group === "you";
          return (
            <div
              key={group}
              className={cn(
                "rounded-2xl border p-4 shadow-sm",
                hero ? "border-primary/40 bg-primary/[0.04]" : "border-border/70 bg-card",
              )}
            >
              <span className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em]", meta.kpiLabel)}>
                <Icon className="h-3.5 w-3.5" />
                {title}
              </span>
              <p className={cn("mt-2.5 font-mono text-[26px] font-bold leading-none tracking-tight", meta.kpiValue)}>
                {formatCurrency(sumOf(list))}
              </p>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {list.length} {list.length === 1 ? "solicitação" : "solicitações"} · {note}
              </p>
            </div>
          );
        })}
      </div>

      {/* Lista */}
      <Card className="overflow-hidden">
        {/* Busca + abas */}
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por descrição, beneficiário ou valor…"
              className="h-9 pl-9"
            />
          </div>
          {TABS.map((entry) => {
            const active = tab === entry.key;
            const count = entry.key === "all" ? items.length : groupItems(entry.key).length;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setTab(entry.key);
                  setSelected([]);
                }}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {entry.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] font-bold",
                    active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Cabeçalho da tabela */}
        <div className="hidden grid-cols-[28px_minmax(0,1fr)_72px_140px_104px_160px_150px] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground lg:grid">
          <span />
          <span>Solicitação</span>
          <span>Trilho</span>
          <span>Prazo</span>
          <span className="text-right">Valor</span>
          <span>Situação</span>
          <span className="text-right">Próxima ação</span>
        </div>

        {/* Linhas */}
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <CardContent className="p-14 text-center text-sm text-muted-foreground">
            {items.length === 0
              ? "Nenhuma solicitação bancária foi criada."
              : "Nenhuma solicitação neste estágio."}
          </CardContent>
        ) : (
          <ul className="divide-y">
            {visible.map((item) => (
              <RequestRow
                key={item.id}
                item={item}
                selected={selected.includes(item.id)}
                selectable={selectable(item)}
                busy={working?.startsWith(`${item.id}:`) ?? false}
                action={rowAction(item, permissions)}
                onOpen={() => setDrawerId(item.id)}
                onToggle={() => toggleSelect(item)}
                onAction={(kind) => void runAction(item, kind)}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Barra de ações em lote */}
      {selected.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl bg-foreground px-5 py-3 text-background shadow-xl">
          <span className="text-sm font-semibold">
            {selected.length} {selected.length === 1 ? "solicitação selecionada" : "solicitações selecionadas"}
          </span>
          <span className="font-mono text-sm font-bold text-primary-foreground/90">
            {formatCurrency(sumOf(selectedItems))}
          </span>
          <Separator orientation="vertical" className="h-5 bg-background/25" />
          <Button
            variant="ghost"
            size="sm"
            className="text-background hover:bg-background/10 hover:text-background"
            onClick={() => setSelected([])}
            disabled={batchWorking}
          >
            Limpar
          </Button>
          <Button size="sm" onClick={() => setBatchOpen(true)} disabled={batchWorking}>
            {batchWorking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Autorizar selecionados
          </Button>
        </div>
      )}

      {/* Painel lateral */}
      <Sheet open={Boolean(drawerItem)} onOpenChange={(open) => !open && setDrawerId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[460px]">
          {drawerItem ? (
            <DetailDrawer
              item={drawerItem}
              action={rowAction(drawerItem, permissions)}
              busy={working?.startsWith(`${drawerItem.id}:`) ?? false}
              canViewProof={!!pr?.viewProof}
              onAction={(kind) => void runAction(drawerItem, kind)}
              onProof={() => void openProof(drawerItem.id)}
            />
          ) : null}
        </SheetContent>
      </Sheet>

      {/* Confirmação — autorizar uma */}
      <AlertDialog open={Boolean(authorizeTarget)} onOpenChange={(open) => !open && setAuthorizeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {authorizeTarget?.sourceType === "financial_inbox" && pr?.submit
                ? "Autorizar e enviar ao Banco Inter?"
                : "Autorizar este pagamento?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {authorizeTarget
                ? `${authorizeTarget.description} · ${formatCurrency(authorizeTarget.amount)}.`
                : ""}
              {authorizeTarget?.sourceType === "financial_inbox" && pr?.submit
                ? " Ao confirmar, o Coala enviará a solicitação ao Banco Inter. Dependendo da conta, ainda poderá haver aprovação final no aplicativo ou Internet Banking."
                : " A confirmação registra a autorização financeira no Coala."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = authorizeTarget;
                setAuthorizeTarget(null);
                if (target) void confirmAuthorize(target);
              }}
            >
              Confirmar autorização
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação — enviar uma */}
      <AlertDialog open={Boolean(submitTarget)} onOpenChange={(open) => !open && setSubmitTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar a solicitação ao Banco Inter?</AlertDialogTitle>
            <AlertDialogDescription>
              {submitTarget ? `${submitTarget.description} · ${formatCurrency(submitTarget.amount)}.` : ""} Esta ação
              pode efetuar ou agendar o pagamento. Em contas com dupla aprovação, a confirmação final continuará no
              Inter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = submitTarget;
                setSubmitTarget(null);
                if (target) void confirmSubmit(target);
              }}
            >
              Enviar ao Inter
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação — autorizar lote */}
      <AlertDialog open={batchOpen} onOpenChange={(open) => !batchWorking && setBatchOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Autorizar os pagamentos selecionados?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${selectedItems.length} ${selectedItems.length === 1 ? "solicitação" : "solicitações"} · ${formatCurrency(
                sumOf(selectedItems),
              )}.`}{" "}
              Cada pagamento é autorizado individualmente. Os que vierem de cobranças recebidas também são enviados ao
              Banco Inter, quando você tem permissão para isso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchWorking}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={batchWorking}
              onClick={(event) => {
                event.preventDefault();
                setBatchOpen(false);
                void confirmBatch(selectedItems);
              }}
            >
              Confirmar autorização
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Linha                                                                       */
/* -------------------------------------------------------------------------- */

function StatusChip({ item, className }: { item: BankPaymentRequest; className?: string }) {
  const group = stageGroup(item);
  const meta = GROUP_META[group];
  const label = statusLabel(item);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
        meta.chip,
        className,
      )}
      title={label}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

function RequestRow({
  item,
  selected,
  selectable,
  busy,
  action,
  onOpen,
  onToggle,
  onAction,
}: {
  item: BankPaymentRequest;
  selected: boolean;
  selectable: boolean;
  busy: boolean;
  action: RowAction;
  onOpen: () => void;
  onToggle: () => void;
  onAction: (kind: RowActionKind) => void;
}) {
  const group = stageGroup(item);
  const due = dueInfo(item);
  const overdue = due.days !== null && due.days < 0 && group !== "done";
  const soon = due.days !== null && due.days >= 0 && due.days <= 3 && group !== "done";
  const hint = dueHint(group, due);
  const paid = item.paidAt ? formatFinancialDateTime(item.paidAt).split(" ")[0] : null;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 lg:grid-cols-[28px_minmax(0,1fr)_72px_140px_104px_160px_150px]",
          selected && "bg-primary/[0.06]",
        )}
      >
        {/* checkbox */}
        <div
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className={cn(
            "flex h-[18px] w-[18px] items-center justify-center rounded border text-[11px] font-bold text-primary-foreground",
            selectable
              ? selected
                ? "cursor-pointer border-primary bg-primary"
                : "cursor-pointer border-input bg-background"
              : "border-dashed border-muted bg-muted/40",
          )}
        >
          {selected ? "✓" : ""}
        </div>

        {/* descrição */}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{item.description}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {sourceLabel(item.sourceType)} · {partyName(item)}
          </p>
          {/* meta empilhada no mobile */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] lg:hidden">
            <span className="font-mono font-bold">{formatCurrency(item.amount)}</span>
            <StatusChip item={item} />
          </div>
        </div>

        {/* trilho */}
        <div className="hidden lg:block">
          <span className="inline-flex items-center rounded-md border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {railLabel(item)}
          </span>
        </div>

        {/* prazo */}
        <div className="hidden lg:block">
          <p className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">Vencimento</p>
          <p
            className={cn(
              "mt-0.5 font-mono text-[12.5px] font-bold",
              group === "done"
                ? "text-muted-foreground"
                : overdue
                  ? "text-rose-600"
                  : soon
                    ? "text-amber-600"
                    : "text-foreground",
            )}
          >
            {due.immediate ? "Imediato" : formatFinancialDate(due.date) ?? "—"}
            {hint ? (
              <span
                className={cn(
                  "ml-1 text-[10.5px] font-bold",
                  overdue ? "text-rose-600" : soon ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {hint}
              </span>
            ) : null}
          </p>
          {paid ? (
            <p className="mt-0.5 whitespace-nowrap text-[11px] font-semibold text-emerald-700">
              ✓ Pago {paid}
            </p>
          ) : null}
        </div>

        {/* valor */}
        <p className="hidden text-right font-mono text-sm font-bold tracking-tight lg:block">
          {formatCurrency(item.amount)}
        </p>

        {/* situação */}
        <div className="hidden min-w-0 lg:block">
          <StatusChip item={item} />
        </div>

        {/* próxima ação */}
        <div className="hidden min-w-0 justify-end lg:flex">
          {action ? (
            <Button
              size="sm"
              variant={action.primary ? "default" : "outline"}
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onAction(action.kind);
              }}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {action.label === "Ver comprovante" ? <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> : null}
              {action.label}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
        </div>

        {/* ação no mobile */}
        {action ? (
          <div className="col-span-2 lg:hidden">
            <Button
              size="sm"
              variant={action.primary ? "default" : "outline"}
              disabled={busy}
              className="w-full"
              onClick={(event) => {
                event.stopPropagation();
                onAction(action.kind);
              }}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {action.label}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Painel lateral                                                              */
/* -------------------------------------------------------------------------- */

function InfoRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("max-w-[240px] truncate text-right text-xs font-semibold", valueClassName)}>{value}</span>
    </div>
  );
}

function DetailDrawer({
  item,
  action,
  busy,
  canViewProof,
  onAction,
  onProof,
}: {
  item: BankPaymentRequest;
  action: RowAction;
  busy: boolean;
  canViewProof: boolean;
  onAction: (kind: RowActionKind) => void;
  onProof: () => void;
}) {
  const due = dueInfo(item);
  const timeline = buildPaymentTimeline(item, sourceLabel(item.sourceType));
  const paidFull = item.paidAt ? formatFinancialDateTime(item.paidAt) : null;
  const schedule = item.barcodeSnapshot
    ? item.barcodeSnapshot.scheduledFor === item.barcodeSnapshot.dueDate
      ? `No vencimento · ${formatFinancialDate(item.barcodeSnapshot.dueDate) ?? "—"}`
      : `${formatFinancialDate(item.barcodeSnapshot.scheduledFor) ?? "—"} · vence ${
          formatFinancialDate(item.barcodeSnapshot.dueDate) ?? "—"
        }`
    : due.immediate
      ? "Imediato"
      : due.date
        ? `Programado · ${formatFinancialDate(due.date) ?? "—"}`
        : "—";

  return (
    <div className="flex h-full flex-col">
      {/* topo */}
      <div className="border-b p-6 pr-12">
        <StatusChip item={item} />
        <h2 className="mt-3 text-lg font-bold leading-tight tracking-tight">{item.description}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {sourceLabel(item.sourceType)} · {partyName(item)}
        </p>
        <p className="mt-4 font-mono text-3xl font-bold tracking-tight">{formatCurrency(item.amount)}</p>
      </div>

      {/* corpo */}
      <div className="flex-1 overflow-y-auto p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Destino</p>
        <div className="mt-2.5 flex flex-col gap-2.5 rounded-xl border bg-muted/30 p-3.5">
          <InfoRow label="Trilho" value={railLabel(item, true)} />
          <InfoRow label="Chave / código" value={destination(item)} valueClassName="font-mono" />
          <InfoRow label="Pagamento" value={schedule} />
          <InfoRow label="Empresa" value={item.legalEntitySnapshot?.legalName ?? "—"} />
          {paidFull ? (
            <InfoRow
              label="Pago em"
              value={paidFull}
              valueClassName="font-mono text-emerald-700"
            />
          ) : null}
        </div>

        <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Linha do tempo</p>
        <ol className="mt-3">
          {timeline.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[20px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    step.state === "fail"
                      ? "bg-rose-500 text-white"
                      : step.state === "done"
                        ? "bg-emerald-600 text-white"
                        : "border-[1.5px] border-muted bg-background text-muted-foreground",
                  )}
                >
                  {step.state === "fail" ? "!" : step.state === "done" ? "✓" : ""}
                </span>
                {index < timeline.length - 1 ? (
                  <span
                    className={cn(
                      "w-px flex-1",
                      step.state === "done" ? "bg-emerald-200" : "bg-border",
                    )}
                    style={{ minHeight: 16 }}
                  />
                ) : null}
              </div>
              <div className="pb-3.5">
                <p
                  className={cn(
                    "text-[12.5px] font-semibold",
                    step.state === "fail"
                      ? "text-rose-600"
                      : step.state === "done"
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{step.meta}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Rastreabilidade</p>
        <div className="mt-2.5 flex flex-col gap-2">
          <InfoRow label="ID no Inter" value={item.interRequestId ?? "—"} valueClassName="font-mono font-normal text-muted-foreground" />
          <InfoRow
            label="Conciliação no extrato"
            value={item.statementReconciliationStatus ? RECON_LABEL[item.statementReconciliationStatus] : "—"}
            valueClassName={
              item.statementReconciliationStatus === "divergent"
                ? "text-rose-600"
                : item.statementReconciliationStatus === "matched"
                  ? "text-emerald-700"
                  : undefined
            }
          />
        </div>

        {item.lastError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
            <p className="text-[11.5px] font-bold text-rose-700">Último erro do banco</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-900/80">{item.lastError.safeMessage}</p>
          </div>
        ) : null}
        {item.beneficiaryVerificationStatus === "divergent" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <p className="text-[11.5px] font-bold text-amber-800">Pagamento confirmado · favorecido em revisão</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-950/80">
              {item.beneficiaryVerificationWarning
                ?? "O extrato confirmou a liquidação, mas o documento retornado pelo banco divergiu do cadastro."}
            </p>
          </div>
        ) : null}
      </div>

      {/* rodapé */}
      <div className="flex gap-2.5 border-t p-4">
        {item.proofStoragePath && canViewProof ? (
          <Button variant="outline" className="flex-1" onClick={onProof}>
            Comprovante
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        ) : null}
        {action && action.kind !== "proof" ? (
          <Button
            className="flex-1"
            variant={action.primary ? "default" : "outline"}
            disabled={busy}
            onClick={() => onAction(action.kind)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {action.label}
          </Button>
        ) : null}
        {!action && !(item.proofStoragePath && canViewProof) ? (
          <p className="flex-1 text-center text-xs text-muted-foreground">Nenhuma ação disponível neste estágio.</p>
        ) : null}
      </div>
    </div>
  );
}
