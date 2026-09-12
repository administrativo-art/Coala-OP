"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format, startOfDay } from "date-fns";
import Link from "next/link";
import {
  Check,
  Circle,
  FileKey2,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExpenseFinancialSummary } from "@/features/financial/components/expenses/expense-financial-summary";
import { UberRecognitionStatus } from "@/features/financial/components/expenses/uber-recognition-status";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";
import { expenseAccountAllocations } from "@/features/financial/lib/expense-account-allocations";
import {
  expensePersonAllocations,
  personAllocationDistinctPeopleCount,
} from "@/features/financial/lib/expense-person-allocations";
import { expenseReferenceCenterLabel } from "@/features/financial/lib/expense-reference-center";
import { resolveResultCenterName, type ResultCenterNameMap } from "@/features/financial/lib/expense-rateio";
import {
  PLANNED_PAYMENT_METHOD_LABELS,
  type PlannedPaymentMethodType,
} from "@/features/financial/lib/card-invoices";
import { formatCurrency, toDate } from "@/features/financial/lib/utils";
import { useProducts } from "@/hooks/use-products";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import { cn } from "@/lib/utils";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types";

type ExpenseExpandedDetailsProps = {
  expense: any;
  relatedPurchaseExpense?: any | null;
  accountPlanMap: Record<string, string>;
  resultCenterNameById: ResultCenterNameMap;
  canViewPersonnelCosts: boolean;
  canViewExpenses: boolean;
  canEdit: boolean;
  canPay: boolean;
  canDelete: boolean;
  finalizingAudit: boolean;
  onFinalizeAudit: () => void;
  onPay: () => void;
  onDelete: () => void;
};

type PurchaseOrderWithDocument = PurchaseOrder & {
  documentUrl?: string | null;
  fiscal?: PurchaseOrder["fiscal"] & { documentUrl?: string | null };
};

const KICKER_CLASS = "text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#a3a099] dark:text-muted-foreground";

function safeDocumentUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function DetailField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={KICKER_CLASS}>{label}</p>
      <p className={cn("mt-[3px] break-words text-[12.5px] font-semibold text-[#1a1b1f] dark:text-foreground", mono && "font-mono")}>
        {value || "—"}
      </p>
    </div>
  );
}

function SectionHeading({ children, aside }: { children: string; aside?: ReactNode }) {
  return (
    <div className="mb-[9px] flex items-center gap-[9px]">
      <p className={cn(KICKER_CLASS, "shrink-0")}>{children}</p>
      <span className="h-px min-w-3 flex-1 bg-[#f1ede4] dark:bg-border" />
      {aside ? <div className="shrink-0 text-[11px] text-[#5f646c] dark:text-muted-foreground">{aside}</div> : null}
    </div>
  );
}

function installmentPresentation(installment: any, expenseStatus: string) {
  const dueDate = toDate(installment?.dueDate);
  const status = String(installment?.status || "").toLowerCase();
  if (status === "paid" || expenseStatus === "paid") {
    return { label: "Paga", className: "bg-[#dcfce7] text-[#166534]" };
  }
  if (status === "cancelled" || expenseStatus === "cancelled") {
    return { label: "Cancelada", className: "bg-stone-100 text-stone-600" };
  }
  if (dueDate && dueDate < startOfDay(new Date())) {
    return { label: "Vencida", className: "bg-[#fee2e2] text-[#b91c1c]" };
  }
  return { label: "Pendente", className: "bg-[#fef3c7] text-[#92400e]" };
}

function personAllocationAnalysisLabel(value: string) {
  if (value === "employer_cost") return "Custo da empresa";
  if (value === "employee_deduction") return "Desconto do colaborador";
  return "Informativo";
}

export function PurchaseOrderItemsLink({ orderId, href, label }: { orderId: string; href: string; label?: string }) {
  const { fetchOrderItems } = usePurchaseOrders();
  const { products, getProductFullName } = useProducts();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PurchaseOrderItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open || items !== null || loadError) return;
    let cancelled = false;

    void fetchOrderItems(orderId)
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchOrderItems, items, loadError, open, orderId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-block text-[12.5px] font-semibold text-[#db2777] underline underline-offset-2">
          {label || `Abrir pedido ${orderId}`}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border-[#e2ded4] p-0 shadow-[0_10px_30px_rgba(0,0,0,0.14)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#eeeae1] bg-[#faf9f6] px-3 py-[9px]">
          <div>
            <p className="text-[12.5px] font-extrabold">Itens do pedido</p>
            <p className="mt-0.5 text-[11px] text-[#9a9ba1]">Prévia dos itens vinculados à despesa.</p>
          </div>
          <Link href={href} className="shrink-0 text-[11px] font-bold text-[#db2777] hover:text-[#be2465]">
            Abrir pedido →
          </Link>
        </div>
        <div className="max-h-72 overflow-y-auto px-2 py-1.5">
          {items === null && !loadError ? (
            <div className="flex items-center justify-center gap-2 px-3 py-5 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando itens...
            </div>
          ) : loadError ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">Não foi possível carregar a prévia.</p>
          ) : items?.length ? (
            <div className="divide-y divide-[#f3f0e9]">
              {items.map((item) => {
                const product = item.productId ? products.find((entry) => entry.id === item.productId) : null;
                const itemName =
                  (product ? getProductFullName(product) : "") ||
                  item.itemName ||
                  item.baseItemId ||
                  "Item da compra";
                const quantity = Number(item.quantityOrdered || 0);
                const total = Number(item.totalOrdered ?? quantity * Number(item.unitPriceOrdered || 0));

                return (
                  <div key={item.id} className="flex items-start justify-between gap-3 px-2 py-2">
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs font-semibold leading-4">{itemName}</p>
                      <p className="mt-0.5 text-[11px] text-[#9a9ba1]">
                        {quantity.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} {item.purchaseUnitLabel || item.unit || "un."}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xs font-bold">{formatCurrency(total)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">Nenhum item cadastrado neste pedido.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ExpenseExpandedDetails({
  expense,
  relatedPurchaseExpense,
  accountPlanMap,
  resultCenterNameById,
  canViewPersonnelCosts,
  canViewExpenses,
  canEdit,
  canPay,
  canDelete,
  finalizingAudit,
  onFinalizeAudit,
  onPay,
  onDelete,
}: ExpenseExpandedDetailsProps) {
  const { orders } = usePurchaseOrders();
  const purchaseOrder = useMemo(
    () => expense.purchaseOrderId
      ? orders.find((order) => String(order.id) === String(expense.purchaseOrderId))
      : undefined,
    [expense.purchaseOrderId, orders],
  ) as PurchaseOrderWithDocument | undefined;
  const fiscal = purchaseOrder?.fiscal;
  const invoiceNumber = fiscal?.number || purchaseOrder?.invoiceNumber || "";
  const invoiceSeries = fiscal?.series || "—";
  const invoiceIssueDate = toDate(fiscal?.issuedAt || purchaseOrder?.purchaseDate || purchaseOrder?.createdAt);
  const invoiceAccessKey = purchaseOrder?.invoiceAccessKey || "";
  const documentUrl = safeDocumentUrl(purchaseOrder?.documentUrl || fiscal?.documentUrl);
  const planName = accountPlanMap[expense.accountId ?? expense.accountPlan]
    || expense.accountPlanName
    || expense.accountId
    || expense.accountPlan
    || "—";
  const referenceCenter = expenseReferenceCenterLabel(expense, resultCenterNameById);
  const competenceDate = toDate(expense.competenceDate);
  const dueDate = toDate(expense.dueDate);
  const rawInstallments = Array.isArray(expense.installmentSchedule) && expense.installmentSchedule.length > 0
    ? expense.installmentSchedule
    : Array.isArray(expense.installments) && expense.installments.length > 0
      ? expense.installments
      : [{
          number: Number(expense.installmentNumber) || 1,
          dueDate: expense.dueDate,
          value: expense.totalValue,
          status: expense.status,
        }];
  const totalInstallments = Number(expense.installmentTotal)
    || Math.max(rawInstallments.length, ...rawInstallments.map((installment: any) => Number(installment?.number) || 0));
  const currentInstallment = Number(expense.installmentNumber) || Number(rawInstallments[0]?.number) || 1;
  const accountingAllocations = expenseAccountAllocations(expense, accountPlanMap);
  const personAllocations = canViewPersonnelCosts ? expensePersonAllocations(expense, accountPlanMap) : [];
  const peopleCount = personAllocationDistinctPeopleCount(personAllocations);
  const plannedPayment = expense.plannedPaymentMethodType
    ? `${expense.plannedBankAccountName ? `${expense.plannedBankAccountName} · ` : ""}${
        expense.plannedPaymentMethodLabel
        || PLANNED_PAYMENT_METHOD_LABELS[expense.plannedPaymentMethodType as PlannedPaymentMethodType]
      }`
    : "Não informado";
  const rateio = expense.isApportioned && Array.isArray(expense.apportionments) ? expense.apportionments : [];
  const rateioPercentage = rateio.reduce(
    (total: number, allocation: any) => total + (Number(allocation?.percentage) || 0),
    0,
  );
  const auditChecks = [
    expense.originModule === "purchasing"
      ? { text: "Documento fiscal vinculado", ok: Boolean(invoiceNumber || invoiceAccessKey || documentUrl) }
      : { text: "Origem do lançamento registrada", ok: true },
    { text: "Classificação no plano de contas", ok: planName !== "—" },
    { text: "Centro de referência definido", ok: referenceCenter !== "—" },
    expense.linkedBankTransactionId
      ? { text: "Conciliação no extrato", ok: true }
      : dueDate && dueDate < startOfDay(new Date()) && !["paid", "reconciled", "cancelled"].includes(expense.status)
        ? { text: "Liquidação em atraso", ok: false }
        : { text: "Conciliação no extrato", ok: ["reconciled"].includes(expense.status) },
  ];
  const canFinalizeAudit = canEdit && expense.originModule === "purchasing" && expense.originStatus === "pending_audit";
  const canRegisterPayment = canPay && ["pending", "partially_paid"].includes(expense.status);
  const canShowMore = canEdit || (canDelete && expense.originModule !== "purchasing");
  const originLabel = invoiceNumber
    ? `Origem · NF-e ${invoiceNumber}`
    : expense.originModule === "purchasing"
      ? "Origem · Pedido de compra"
      : "Origem · Lançamento financeiro";

  return (
    <div
      data-testid="expense-expanded-details"
      className="grid overflow-hidden rounded-[14px] border border-[#eeeae1] bg-white dark:border-border dark:bg-background lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="flex min-w-0 flex-col gap-[17px] border-b border-[#f1ede4] px-[18px] py-[17px] dark:border-border lg:border-b-0 lg:border-r">
        <section aria-label="Origem da despesa">
          <div className="mb-[11px] flex items-center gap-[9px]">
            <p className={cn(KICKER_CLASS, "shrink-0")}>{originLabel}</p>
            <span className="h-px min-w-3 flex-1 bg-[#f1ede4] dark:bg-border" />
            {documentUrl ? (
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[11.5px] font-bold text-[#db2777] hover:text-[#be2465]"
              >
                Ver DANFE
              </a>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-[18px] gap-y-[14px] xl:grid-cols-4">
            <DetailField label="Emissão" value={invoiceIssueDate ? format(invoiceIssueDate, "dd/MM/yyyy") : "—"} mono />
            <DetailField label="Série" value={invoiceSeries} mono />
            <DetailField label="Emitente" value={fiscal?.issuerName || expense.supplier || "—"} />
            <DetailField label="CNPJ" value={fiscal?.issuerCnpj || "—"} mono />
            <DetailField label="Plano de contas" value={planName} />
            <DetailField label="Competência" value={competenceDate ? format(competenceDate, "MM/yyyy") : "—"} mono />
            <DetailField label="Centro de referência" value={referenceCenter} />
            <DetailField
              label="Apropriação na DRE"
              value={rateio.length > 0 ? `${rateio.length} centro${rateio.length === 1 ? "" : "s"} no rateio` : "100% no centro de referência"}
            />
            <DetailField label="Pagamento previsto" value={plannedPayment} />
          </div>
          <div className="mt-3">
            <UberRecognitionStatus record={expense} />
          </div>
        </section>

        {expense.purchaseOrderId ? (
          <section className="relative">
            <p className={cn(KICKER_CLASS, "mb-[3px]")}>Pedido vinculado</p>
            <PurchaseOrderItemsLink
              orderId={expense.purchaseOrderId}
              href={`/dashboard/purchasing/orders/${expense.purchaseOrderId}?returnTo=${encodeURIComponent(FINANCIAL_ROUTES.expenses)}`}
            />
          </section>
        ) : null}

        <section aria-label="Parcelas da despesa">
          <SectionHeading aside={`${rawInstallments.length} ${rawInstallments.length === 1 ? "parcela" : "parcelas"}`}>Parcelas</SectionHeading>
          <div className="overflow-hidden rounded-[11px] border border-[#eceadf] dark:border-border">
            <div className="grid grid-cols-[52px_minmax(110px,1fr)_minmax(100px,1fr)_130px] gap-[10px] border-b border-[#f1ede4] bg-[#faf9f6] px-3 py-2 dark:border-border dark:bg-muted/20">
              <span className={KICKER_CLASS}>#</span>
              <span className={KICKER_CLASS}>Vencimento</span>
              <span className={KICKER_CLASS}>Situação</span>
              <span className={cn(KICKER_CLASS, "text-right")}>Valor</span>
            </div>
            {rawInstallments.map((installment: any, index: number) => {
              const presentation = installmentPresentation(installment, expense.status);
              const installmentDueDate = toDate(installment?.dueDate);
              return (
                <div
                  key={`${installment?.number || index + 1}-${installmentDueDate?.getTime() || index}`}
                  className={cn(
                    "grid grid-cols-[52px_minmax(110px,1fr)_minmax(100px,1fr)_130px] items-center gap-[10px] bg-[#fffdf7] px-3 py-[9px] dark:bg-background",
                    index > 0 && "border-t border-[#f4f1ea] dark:border-border",
                  )}
                >
                  <span className="font-mono text-[12.5px] font-bold text-[#5f646c] dark:text-muted-foreground">
                    {installment?.number || index + 1}/{totalInstallments}
                  </span>
                  <span className="font-mono text-[12.5px]">
                    {installmentDueDate ? format(installmentDueDate, "dd/MM/yyyy") : "—"}
                  </span>
                  <span>
                    <span className={cn("inline-flex h-[22px] items-center rounded-full px-[9px] text-[11px] font-extrabold", presentation.className)}>
                      {presentation.label}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[12.5px] font-bold">
                    {formatCurrency(Number(installment?.value) || (rawInstallments.length === 1 ? Number(expense.totalValue) || 0 : 0))}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {accountingAllocations.length > 1 ? (
          <section>
            <SectionHeading aside={`${accountingAllocations.length} contas`}>Apropriações do título</SectionHeading>
            <div className="grid gap-2 sm:grid-cols-2">
              {accountingAllocations.map((allocation) => (
                <div key={allocation.accountPlanId} className="flex items-center justify-between gap-3 rounded-[10px] border border-[#eceadf] bg-[#faf9f6] px-3 py-2.5 text-xs dark:border-border dark:bg-muted/20">
                  <span>{allocation.accountPlanName || allocation.accountPlanId}</span>
                  <span className="font-mono font-bold">{formatCurrency(allocation.amount)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {rateio.length > 0 ? (
          <section>
            <SectionHeading aside={`${rateioPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% distribuído`}>
              Rateio da DRE
            </SectionHeading>
            <div className="overflow-hidden rounded-[11px] border border-[#eceadf] dark:border-border">
              {rateio.map((allocation: any, index: number) => {
                const percentage = Number(allocation?.percentage) || 0;
                const value = (Number(expense.totalValue) || 0) * percentage / 100;
                return (
                  <div key={`${allocation?.resultCenter || "centro"}-${index}`} className={cn("flex items-center justify-between gap-4 px-3 py-2.5 text-xs", index > 0 && "border-t border-[#f4f1ea] dark:border-border")}>
                    <span className="min-w-0 truncate">{resolveResultCenterName(allocation?.resultCenter, resultCenterNameById) || "Centro pendente"}</span>
                    <span className="flex shrink-0 items-center gap-4 font-mono">
                      <span className="text-muted-foreground">{percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>
                      <strong>{formatCurrency(value)}</strong>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {peopleCount > 1 ? (
          <section>
            <SectionHeading aside={`${peopleCount} pessoas · ${personAllocations.length} vínculos`}>Individualização auditável</SectionHeading>
            <div className="overflow-x-auto rounded-[11px] border border-[#eceadf] dark:border-border">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[minmax(145px,1.15fr)_minmax(125px,1fr)_minmax(120px,.9fr)_minmax(110px,.8fr)_100px] gap-3 border-b border-[#f1ede4] bg-[#faf9f6] px-3 py-2 dark:border-border dark:bg-muted/20">
                  <span className={KICKER_CLASS}>Pessoa e conta</span>
                  <span className={KICKER_CLASS}>Classificação</span>
                  <span className={KICKER_CLASS}>Centro</span>
                  <span className={KICKER_CLASS}>Referência</span>
                  <span className={cn(KICKER_CLASS, "text-right")}>Valor</span>
                </div>
                {personAllocations.map((allocation, index) => (
                  <div
                    key={allocation.id || `${allocation.employeeId}-${index}`}
                    className={cn(
                      "grid grid-cols-[minmax(145px,1.15fr)_minmax(125px,1fr)_minmax(120px,.9fr)_minmax(110px,.8fr)_100px] gap-3 px-3 py-2.5 text-xs",
                      index > 0 && "border-t border-[#f4f1ea] dark:border-border",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{allocation.employeeName}</p>
                      <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{allocation.accountPlanName}</p>
                    </div>
                    <span className="text-muted-foreground">{personAllocationAnalysisLabel(allocation.analysisType)}</span>
                    <span className="truncate text-muted-foreground">
                      {resolveResultCenterName(allocation.resultCenter, resultCenterNameById) || "Centro pendente"}
                    </span>
                    <div className="min-w-0 text-muted-foreground">
                      <p className="truncate">{allocation.contractReference || allocation.creditorName || "—"}</p>
                      {allocation.contractReference && allocation.creditorName ? (
                        <p className="mt-0.5 truncate text-[10.5px]">{allocation.creditorName}</p>
                      ) : null}
                      {allocation.payrollDocumentId ? (
                        <p className="mt-0.5 truncate font-mono text-[10px]">RH {allocation.payrollDocumentId}</p>
                      ) : null}
                    </div>
                    <strong className="text-right font-mono">{formatCurrency(allocation.amount)}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {relatedPurchaseExpense ? (
          <section className="rounded-[11px] border border-[#eceadf] bg-[#faf9f6] p-3 dark:border-border dark:bg-muted/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={KICKER_CLASS}>
                  {expense.purchaseExpenseRole === "freight" ? "Mercadoria relacionada" : "Frete pago separadamente"}
                </p>
                <p className="mt-1 truncate text-[12.5px] font-semibold">{relatedPurchaseExpense.description || "Despesa vinculada à compra"}</p>
                <p className="mt-0.5 text-[11px] text-[#9a9ba1]">{relatedPurchaseExpense.supplier || "Favorecido não informado"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <strong className="font-mono text-[12.5px]">{formatCurrency(Number(relatedPurchaseExpense.totalValue) || 0)}</strong>
                {canViewExpenses ? (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${relatedPurchaseExpense.id}`}>Abrir despesa</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section>
          <SectionHeading>Documentos</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {documentUrl ? (
              <a href={documentUrl} target="_blank" rel="noreferrer" className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-[#e6e2d9] bg-[#faf9f6] px-3 text-xs font-semibold text-[#2c2f36] dark:border-border dark:bg-muted/20 dark:text-foreground">
                <FileText className="h-3.5 w-3.5" /> DANFE {invoiceNumber || "da compra"}
              </a>
            ) : null}
            {invoiceAccessKey ? (
              <span className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-[#e6e2d9] bg-[#faf9f6] px-3 text-xs font-semibold text-[#2c2f36] dark:border-border dark:bg-muted/20 dark:text-foreground" title={invoiceAccessKey}>
                <FileKey2 className="h-3.5 w-3.5" /> Chave da NF-e
              </span>
            ) : null}
            {expense.financialInboxMessageId ? (
              <span className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-[#e6e2d9] bg-[#faf9f6] px-3 text-xs font-semibold text-[#2c2f36] dark:border-border dark:bg-muted/20 dark:text-foreground">
                <FileText className="h-3.5 w-3.5" /> Cobrança recebida
              </span>
            ) : null}
            {!documentUrl && !invoiceAccessKey && !expense.financialInboxMessageId ? (
              <p className="text-xs text-[#8a8f99]">Nenhum documento vinculado.</p>
            ) : null}
          </div>
        </section>

        {expense.notes ? (
          <section>
            <p className={cn(KICKER_CLASS, "mb-[5px]")}>Observações</p>
            <p className="whitespace-pre-line text-xs leading-[1.6] text-[#5f646c] dark:text-muted-foreground">{expense.notes}</p>
          </section>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-[15px] bg-[#fbfaf7] px-[18px] py-[17px] dark:bg-muted/10">
        <div>
          <p className={KICKER_CLASS}>Valor total</p>
          <p className="mt-1 font-mono text-[25px] font-extrabold tracking-[-0.02em]">{formatCurrency(Number(expense.totalValue) || 0)}</p>
          <p className="mt-1 text-[11.5px] text-[#5f646c] dark:text-muted-foreground">
            Parcela {currentInstallment}/{totalInstallments} · vence {dueDate ? format(dueDate, "dd/MM/yyyy") : "sem data"}
          </p>
        </div>

        <ExpenseFinancialSummary expense={expense} compact />

        <div className="h-px bg-[#eceadf] dark:bg-border" />
        <section>
          <p className={cn(KICKER_CLASS, "mb-2")}>Pendências de auditoria</p>
          <div className="flex flex-col gap-[7px]">
            {auditChecks.map((check) => (
              <div key={check.text} className="flex items-center gap-2 text-[12.5px] text-[#2c2f36] dark:text-foreground">
                <span className={cn(
                  "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold",
                  check.ok ? "bg-[#dcfce7] text-[#166534]" : "bg-[#fef3c7] text-[#92400e]",
                )}>
                  {check.ok ? <Check className="h-3 w-3" /> : <Circle className="h-1.5 w-1.5 fill-current" />}
                </span>
                {check.text}
              </div>
            ))}
          </div>
        </section>

        <div className="mt-auto flex flex-col gap-2 pt-2">
          {canFinalizeAudit ? (
            <Button
              type="button"
              className="h-[42px] rounded-xl bg-[#db2777] text-[13px] font-extrabold text-white hover:bg-[#be2465]"
              disabled={finalizingAudit}
              onClick={onFinalizeAudit}
            >
              {finalizingAudit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Finalizar auditoria
            </Button>
          ) : null}
          <div className="flex gap-2">
            {canRegisterPayment ? (
              <Button type="button" variant="outline" className="h-[38px] flex-1 rounded-[11px] text-[12.5px] font-bold" onClick={onPay}>
                Registrar pagamento
              </Button>
            ) : null}
            {canShowMore ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="h-[38px] w-[42px] rounded-[11px] px-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Mais ações</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem asChild>
                      <Link href={`${FINANCIAL_ROUTES.newExpense}?edit=${expense.id}`}>
                        <Pencil className="mr-2 h-4 w-4" /> {expense.status === "draft" ? "Continuar" : "Editar"}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete && expense.originModule !== "purchasing" ? (
                    <DropdownMenuItem onClick={onDelete}>
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
