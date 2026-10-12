"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/features/financial/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { BulkBar } from "@/components/patterns/bulk-bar";
import { ControlSearch } from "@/components/patterns/control-panel";
import { FilterChips } from "@/components/patterns/filter-chips";
import { HeroChip } from "@/components/patterns/hero-chip";
import { LiftRow } from "@/components/patterns/lift-row";
import { PageHero } from "@/components/patterns/page-hero";
import { SidePanel } from "@/components/patterns/side-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
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

import {
  DEFAULT_PAYMENT_REQUEST_FILTER,
  matchesPaymentRequestFilter,
  paymentSchedulePresentation,
  requiresBeneficiaryReview,
  stageGroup,
  type PaymentRequestFilter,
  type StageGroup,
} from "./presentation";

/* -------------------------------------------------------------------------- */
/*  Estágios                                                                    */
/* -------------------------------------------------------------------------- */

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

const GROUP_ORDER: Record<StageGroup, number> = { you: 0, risk: 1, bank: 2, done: 3 };

function statusLabel(item: BankPaymentRequest) {
  return requiresBeneficiaryReview(item) ? "Pago · revisar favorecido" : STATUS_LABEL[item.status];
}

const GROUP_PILL: Record<StageGroup, StatusPillVariant> = {
  you: "warn",
  risk: "danger",
  bank: "info",
  done: "ok",
};

const GROUP_TONE: Record<StageGroup, "warning" | "danger" | "info" | "neutral"> = {
  you: "warning",
  risk: "danger",
  bank: "info",
  done: "neutral",
};

const TABS: { key: PaymentRequestFilter; label: string }[] = [
  { key: "unpaid", label: "Não pagos" },
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
  if (sourceType === "salary") return "Salário";
  if (sourceType === "financial_inbox") return "Cobrança recebida";
  if (sourceType === "expense_boleto") return "Boleto da despesa";
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

  const [tab, setTab] = useState<PaymentRequestFilter>(DEFAULT_PAYMENT_REQUEST_FILTER);
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
      .filter((item) => matchesPaymentRequestFilter(item, tab))
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

  const kpis: { group: StageGroup; title: string; list: BankPaymentRequest[]; note: string; filter?: PaymentRequestFilter }[] = [
    { group: "you", title: "Aguardando você", list: groupItems("you"), note: "autorização financeira", filter: "you" },
    { group: "bank", title: "No banco", list: groupItems("bank"), note: "aguardando ou agendado", filter: "bank" },
    { group: "done", title: "Liquidado (7 dias)", list: paidLast7d, note: "comprovantes disponíveis" },
    { group: "risk", title: "Precisa de atenção", list: groupItems("risk"), note: "falha, recusa ou expirado", filter: "risk" },
  ];

  function changeTab(next: PaymentRequestFilter) {
    setTab(next);
    setSelected([]);
  }

  return (
    <PageContainer variant="compact" className="space-y-5 pb-24">
      <PageHero
        kicker="Financeiro · Despesas"
        title="Autorizações bancárias"
        subtitle="Autorização, aprovação bancária, conciliação e comprovantes Pix."
        actions={<>
          <Button variant="on-dark-secondary" size="md" asChild>
            <Link href={FINANCIAL_ROUTES.expenses}><ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />Despesas</Link>
          </Button>
          <Button variant="on-dark-secondary" size="md" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden="true" className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
            Atualizar lista
          </Button>
        </>}
        chips={<>
          {kpis.map(({ group, title, list, note, filter }) => (
            <span key={group} title={`${list.length} ${list.length === 1 ? "solicitação" : "solicitações"} · ${note}`}>
              <HeroChip
                value={formatCurrency(sumOf(list))}
                label={`${title} · ${list.length}`}
                tone={GROUP_TONE[group]}
                active={filter ? tab === filter : undefined}
                onClick={filter ? () => changeTab(filter) : undefined}
              />
            </span>
          ))}
        </>}
      >
        <ControlSearch value={query} onChange={setQuery} placeholder="Buscar por descrição, beneficiário ou valor…" />
        <FilterChips
          allLabel={TABS[0].label}
          allCount={items.filter((item) => matchesPaymentRequestFilter(item, TABS[0].key)).length}
          value={tab === TABS[0].key ? null : tab}
          onChange={(value) => changeTab((value ?? TABS[0].key) as PaymentRequestFilter)}
          chips={TABS.slice(1).map((entry) => ({
            value: entry.key,
            label: entry.label,
            count: items.filter((item) => matchesPaymentRequestFilter(item, entry.key)).length,
          }))}
        />
      </PageHero>

      {/* Lista */}
      <div className="rounded-[18px] border border-ds-border bg-ds-surface">
        {/* Cabeçalho da tabela */}
        <div className="hidden grid-cols-[28px_minmax(0,1fr)_72px_140px_104px_160px_150px] gap-3 border-b border-ds-divider px-[18px] py-3 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint lg:grid">
          <span />
          <span>Solicitação</span>
          <span>Trilho</span>
          <span>Pagamento</span>
          <span className="text-right">Valor</span>
          <span>Situação</span>
          <span className="text-right">Próxima ação</span>
        </div>

        {/* Linhas */}
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="m-4 rounded-[18px] border border-dashed border-ds-border px-6 py-14 text-center text-sm text-ds-ink-muted">
            {items.length === 0
              ? "Nenhuma solicitação bancária foi criada."
              : "Nenhuma solicitação neste estágio."}
          </div>
        ) : (
          <ul>
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
      </div>

      {/* Barra de ações em lote */}
      <BulkBar
        count={selected.length}
        summary={`${selected.length} ${selected.length === 1 ? "solicitação selecionada" : "solicitações selecionadas"} · ${formatCurrency(sumOf(selectedItems))}`}
        actions={[{ label: batchWorking ? "Autorizando…" : "Autorizar selecionados", onClick: () => { if (!batchWorking) setBatchOpen(true); } }]}
        onClear={() => { if (!batchWorking) setSelected([]); }}
      />

      {/* Painel lateral */}
      {drawerItem ? (
        <SidePanel
          open
          onOpenChange={(open) => { if (!open) setDrawerId(null); }}
          kicker={sourceLabel(drawerItem.sourceType)}
          title={drawerItem.description}
          subtitle={partyName(drawerItem)}
          highlights={<span className="font-mono">{formatCurrency(drawerItem.amount)}</span>}
        >
          <DetailDrawer
            item={drawerItem}
            action={rowAction(drawerItem, permissions)}
            busy={working?.startsWith(`${drawerItem.id}:`) ?? false}
            canViewProof={!!pr?.viewProof}
            onAction={(kind) => void runAction(drawerItem, kind)}
            onProof={() => void openProof(drawerItem.id)}
          />
        </SidePanel>
      ) : null}

      {/* Confirmação — autorizar uma */}
      <AlertDialog open={Boolean(authorizeTarget)} onOpenChange={(open) => !open && setAuthorizeTarget(null)}>
        <AlertDialogContent className="rounded-ds-modal border-ds-border bg-ds-surface font-ds shadow-ds-modal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-ds-ink">
              {authorizeTarget?.sourceType === "financial_inbox" && pr?.submit
                ? "Autorizar e enviar ao Banco Inter?"
                : "Autorizar este pagamento?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-ds-ink-muted">
              {authorizeTarget
                ? `${authorizeTarget.description} · ${formatCurrency(authorizeTarget.amount)}.`
                : ""}
              {authorizeTarget?.sourceType === "financial_inbox" && pr?.submit
                ? " Ao confirmar, o Coala enviará a solicitação ao Banco Inter. Dependendo da conta, ainda poderá haver aprovação final no aplicativo ou Internet Banking."
                : " A confirmação registra a autorização financeira no Coala."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "ds-secondary", size: "md" })}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "primary-modal", size: "md" })}
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
        <AlertDialogContent className="rounded-ds-modal border-ds-border bg-ds-surface font-ds shadow-ds-modal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-ds-ink">Enviar a solicitação ao Banco Inter?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-ds-ink-muted">
              {submitTarget ? `${submitTarget.description} · ${formatCurrency(submitTarget.amount)}.` : ""} Esta ação
              pode efetuar ou agendar o pagamento. Em contas com dupla aprovação, a confirmação final continuará no
              Inter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={buttonVariants({ variant: "ds-secondary", size: "md" })}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "primary-modal", size: "md" })}
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
        <AlertDialogContent className="rounded-ds-modal border-ds-border bg-ds-surface font-ds shadow-ds-modal">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-extrabold text-ds-ink">Autorizar os pagamentos selecionados?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] leading-relaxed text-ds-ink-muted">
              {`${selectedItems.length} ${selectedItems.length === 1 ? "solicitação" : "solicitações"} · ${formatCurrency(
                sumOf(selectedItems),
              )}.`}{" "}
              Cada pagamento é autorizado individualmente. Os que vierem de cobranças recebidas também são enviados ao
              Banco Inter, quando você tem permissão para isso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchWorking} className={buttonVariants({ variant: "ds-secondary", size: "md" })}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "primary-modal", size: "md" })}
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
  const label = statusLabel(item);
  return (
    <StatusPill variant={GROUP_PILL[stageGroup(item)]} className={cn("max-w-full truncate", className)} title={label}>
      {label}
    </StatusPill>
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
  const schedule = paymentSchedulePresentation(item);
  const paid = item.status === "paid";

  return (
    <li>
      <LiftRow
        interactive={false}
        selected={selected}
        className="group/row grid grid-cols-[28px_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[28px_minmax(0,1fr)_72px_140px_104px_160px_150px]"
      >
        {/* seleção em lote */}
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`Selecionar ${item.description}`}
          disabled={!selectable}
          onClick={onToggle}
          className={cn(
            "relative z-[1] flex h-[18px] w-[18px] items-center justify-center rounded border text-[11px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-ink focus-visible:ring-offset-2",
            selectable
              ? selected
                ? "border-ds-accent bg-ds-accent"
                : "border-ds-border-input bg-ds-surface"
              : "cursor-not-allowed border-dashed border-ds-border bg-ds-muted",
          )}
        >
          {selected ? "✓" : ""}
        </button>

        {/* descrição: o botão cobre a linha inteira e os demais controles ficam acima dele */}
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            aria-haspopup="dialog"
            className="block max-w-full text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            <span className="block truncate text-sm font-bold tracking-tight text-ds-ink">{item.description}</span>
          </button>
          <p className="truncate text-xs text-ds-ink-faint">
            {sourceLabel(item.sourceType)} · {partyName(item)}
          </p>
          {/* meta empilhada no mobile */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] lg:hidden">
            <span className="font-mono font-bold text-ds-ink">{formatCurrency(item.amount)}</span>
            <StatusChip item={item} />
          </div>
        </div>

        {/* trilho */}
        <div className="hidden lg:block">
          <span className="inline-flex h-[21px] items-center rounded-full bg-ds-neutral-bg px-2.5 text-[11.5px] font-bold text-ds-neutral">
            {railLabel(item)}
          </span>
        </div>

        {/* pagamento realizado ou previsto, visível também no mobile */}
        <div className="col-start-2 lg:col-start-auto">
          <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.12em]", paid ? "text-ds-ok" : "text-ds-ink-faint")}>{schedule.label}</p>
          {schedule.date ? (
            <p className={cn("mt-0.5 font-mono text-[12.5px] font-bold text-ds-ink", paid && "text-ds-ok")}>{schedule.date}</p>
          ) : null}
          {schedule.timing ? <p className="mt-0.5 text-[11px] font-semibold text-ds-ink-muted">{schedule.timing}</p> : null}
          {schedule.dueDate ? (
            <p className="mt-1 text-[11px] text-ds-ink-faint">Vencimento: {schedule.dueDate}</p>
          ) : null}
        </div>

        {/* valor */}
        <p className="hidden text-right font-mono text-sm font-extrabold tracking-tight text-ds-ink lg:block">
          {formatCurrency(item.amount)}
        </p>

        {/* situação */}
        <div className="hidden min-w-0 lg:block">
          <StatusChip item={item} />
        </div>

        {/* próxima ação */}
        <div className="relative z-[1] hidden min-w-0 justify-end lg:flex">
          {action ? (
            <Button
              size="xs"
              variant={action.primary ? "primary-page" : "ds-secondary"}
              disabled={busy}
              onClick={() => onAction(action.kind)}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {action.label === "Ver comprovante" ? <ExternalLink aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" /> : null}
              {action.label}
            </Button>
          ) : (
            <span className="text-[11px] text-ds-ink-faint">—</span>
          )}
        </div>

        {/* ação no mobile */}
        {action ? (
          <div className="relative z-[1] col-span-2 lg:hidden">
            <Button
              size="xs"
              variant={action.primary ? "primary-page" : "ds-secondary"}
              disabled={busy}
              className="w-full"
              onClick={() => onAction(action.kind)}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {action.label}
            </Button>
          </div>
        ) : null}
      </LiftRow>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Painel lateral                                                              */
/* -------------------------------------------------------------------------- */

function InfoRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-ds-ink-muted">{label}</span>
      <span className={cn("max-w-[240px] truncate text-right text-xs font-semibold text-ds-ink", valueClassName)}>{value}</span>
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
    <>
      <div>
        <StatusChip item={item} />
      </div>
      <div>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Destino</p>
        <div className="mt-2.5 flex flex-col gap-2.5 rounded-ds-btn-lg border border-ds-border bg-ds-surface p-3.5">
          <InfoRow label="Trilho" value={railLabel(item, true)} />
          <InfoRow label="Chave / código" value={destination(item)} valueClassName="font-mono" />
          <InfoRow label="Pagamento" value={schedule} />
          <InfoRow label="Empresa" value={item.legalEntitySnapshot?.legalName ?? "—"} />
          {paidFull ? (
            <InfoRow
              label="Pago em"
              value={paidFull}
              valueClassName="font-mono text-ds-ok"
            />
          ) : null}
        </div>

        <p className="mt-6 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Linha do tempo</p>
        <ol className="mt-3">
          {timeline.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[20px_minmax(0,1fr)] gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    step.state === "fail"
                      ? "bg-ds-danger text-white"
                      : step.state === "done"
                        ? "bg-ds-ok text-white"
                        : "border-[1.5px] border-ds-border-input bg-ds-surface text-ds-ink-faint",
                  )}
                >
                  {step.state === "fail" ? "!" : step.state === "done" ? "✓" : ""}
                </span>
                {index < timeline.length - 1 ? (
                  <span
                    className={cn(
                      "w-px flex-1",
                      step.state === "done" ? "bg-ds-ok" : "bg-ds-border",
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
                      ? "text-ds-danger"
                      : step.state === "done"
                        ? "text-ds-ink"
                        : "text-ds-ink-faint",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-[11.5px] text-ds-ink-muted">{step.meta}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-2 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Rastreabilidade</p>
        <div className="mt-2.5 flex flex-col gap-2">
          <InfoRow label="ID no Inter" value={item.interRequestId ?? "—"} valueClassName="font-mono font-normal text-muted-foreground" />
          <InfoRow
            label="Conciliação no extrato"
            value={item.statementReconciliationStatus ? RECON_LABEL[item.statementReconciliationStatus] : "—"}
            valueClassName={
              item.statementReconciliationStatus === "divergent"
                ? "text-ds-danger"
                : item.statementReconciliationStatus === "matched"
                  ? "text-ds-ok"
                  : undefined
            }
          />
        </div>

        {item.lastError ? (
          <div className="mt-4 rounded-ds-btn-lg bg-ds-danger-bg p-3.5">
            <p className="text-[11.5px] font-extrabold text-ds-danger">Último erro do banco</p>
            <p className="mt-1 text-xs leading-relaxed text-ds-danger">{item.lastError.safeMessage}</p>
          </div>
        ) : null}
        {item.beneficiaryVerificationStatus === "divergent" ? (
          <div className="mt-4 rounded-ds-btn-lg bg-ds-warn-bg p-3.5">
            <p className="text-[11.5px] font-extrabold text-ds-warn">Pagamento confirmado · favorecido em revisão</p>
            <p className="mt-1 text-xs leading-relaxed text-ds-warn">
              {item.beneficiaryVerificationWarning
                ?? "O extrato confirmou a liquidação, mas o documento retornado pelo banco divergiu do cadastro."}
            </p>
          </div>
        ) : null}
      </div>

      {/* ações */}
      <div className="flex gap-2.5 border-t border-ds-divider pt-4">
        {item.proofStoragePath && canViewProof ? (
          <Button variant="ds-secondary" size="md" className="flex-1" onClick={onProof}>
            Comprovante
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>
        ) : null}
        {action && action.kind !== "proof" ? (
          <Button
            className="flex-1"
            size="md"
            variant={action.primary ? "primary-modal" : "ds-secondary"}
            disabled={busy}
            onClick={() => onAction(action.kind)}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {action.label}
          </Button>
        ) : null}
        {!action && !(item.proofStoragePath && canViewProof) ? (
          <p className="flex-1 text-center text-xs text-ds-ink-muted">Nenhuma ação disponível neste estágio.</p>
        ) : null}
      </div>
    </>
  );
}
