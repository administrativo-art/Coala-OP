"use client";

import type { ReactNode } from "react";
import { format, startOfDay } from "date-fns";
import {
  Ban,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  CreditCard,
  FilePen,
  Layers,
  Link2,
  Receipt,
  ScanSearch,
  ShoppingBag,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { LiftRow } from "@/components/patterns/lift-row";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { formatCurrency } from "@/features/financial/lib/utils";
import { cn } from "@/lib/utils";

/** Colunas da lista: descrição · favorecido e plano · centro · vencimento · valor · status · seta. */
export const EXPENSE_LIST_COLUMNS =
  "md:grid-cols-[minmax(240px,2fr)_minmax(150px,1.2fr)_minmax(110px,.9fr)_112px_112px_156px_16px]";

type StatusPresentation = { variant: StatusPillVariant; Icon: LucideIcon };

const STATUS_PRESENTATION: Record<string, StatusPresentation> = {
  paid: { variant: "ok", Icon: CircleCheck },
  payment_found_pending_document: { variant: "ok", Icon: ScanSearch },
  overdue: { variant: "danger", Icon: TriangleAlert },
  paid_divergent: { variant: "danger", Icon: TriangleAlert },
  due_soon: { variant: "warn", Icon: Clock },
  partially_paid: { variant: "warn", Icon: CircleDot },
  pending_audit: { variant: "warn", Icon: ScanSearch },
  pending: { variant: "info", Icon: CircleDashed },
  reported_paid: { variant: "info", Icon: CircleCheck },
  provisioned: { variant: "info", Icon: CalendarClock },
  draft: { variant: "neutral", Icon: FilePen },
  cancelled: { variant: "neutral", Icon: Ban },
  reconciled: { variant: "neutral", Icon: Link2 },
};

export function expenseStatusPresentation(statusKey: string): StatusPresentation {
  return STATUS_PRESENTATION[statusKey] ?? { variant: "neutral", Icon: CircleDashed };
}

const TILE_TONE: Record<StatusPillVariant, string> = {
  ok: "bg-ds-ok-bg text-ds-ok",
  warn: "bg-ds-warn-bg text-ds-warn",
  danger: "bg-ds-danger-bg text-ds-danger",
  info: "bg-ds-info-bg text-ds-info",
  neutral: "bg-ds-neutral-bg text-ds-neutral",
};

export function ExpenseStatusPill({ statusKey, label, className }: { statusKey: string; label: string; className?: string }) {
  const { variant, Icon } = expenseStatusPresentation(statusKey);
  return (
    <StatusPill variant={variant} className={cn("gap-1", className)}>
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      {label}
    </StatusPill>
  );
}

/** Azulejo de ícone da origem: compras, cartão ou lançamento comum, na cor do status. */
function OriginTile({ icon: Icon, variant }: { icon: LucideIcon; variant: StatusPillVariant }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-[11px] transition-transform duration-150 group-hover/row:scale-105 motion-reduce:transition-none",
        TILE_TONE[variant],
      )}
    >
      <Icon className="h-[17px] w-[17px]" />
    </span>
  );
}

const MS_PER_DAY = 86_400_000;

/** "atrasada 5d" / "em 3d" sob a data de vencimento; some quando já não há saldo a pagar. */
function DueHint({ due, show }: { due: Date; show: boolean }) {
  if (!show) return null;
  const today = startOfDay(new Date());
  const days = Math.round((due.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) {
    return (
      <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-ds-danger">
        <TriangleAlert aria-hidden="true" className="h-3 w-3" />
        {Math.abs(days)}d de atraso
      </p>
    );
  }
  return (
    <p className={cn("mt-0.5 inline-flex items-center gap-1 text-xs", days <= 3 ? "font-bold text-ds-warn" : "text-ds-ink-faint")}>
      <Clock aria-hidden="true" className="h-3 w-3" />
      {days === 0 ? "vence hoje" : `em ${days}d`}
    </p>
  );
}

export function ExpenseListRow({
  expense,
  statusKey,
  statusLabel,
  selected,
  onOpen,
  due,
  showDueHint,
  planName,
  unitLabel,
  installmentNode,
  paymentMethodLabel,
  uberNode,
}: {
  expense: any;
  statusKey: string;
  statusLabel: string;
  selected: boolean;
  onOpen: () => void;
  due: Date | null;
  showDueHint: boolean;
  planName: string;
  unitLabel: string;
  installmentNode: ReactNode;
  paymentMethodLabel: string | null;
  uberNode: ReactNode;
}) {
  const { variant } = expenseStatusPresentation(statusKey);
  const isCard = expense.plannedPaymentMethodType === "credit_card";
  const isPurchasing = expense.originModule === "purchasing";
  const tileIcon = isPurchasing ? ShoppingBag : isCard ? CreditCard : Receipt;
  return (
    <LiftRow
      table
      selected={selected}
      onClick={onOpen}
      aria-label={`Abrir despesa ${expense.description ?? ""}`}
      data-testid="expense-row"
      className={cn("group/row grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5", EXPENSE_LIST_COLUMNS)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <OriginTile icon={tileIcon} variant={variant} />
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-2 text-[13.5px] font-bold leading-5 text-ds-ink">{expense.description}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {installmentNode}
            {isPurchasing ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-ds-neutral-bg px-2 text-[11px] font-bold text-ds-neutral">
                <ShoppingBag aria-hidden="true" className="h-3 w-3" /> Compras
              </span>
            ) : null}
            {paymentMethodLabel ? (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-ds-info-bg px-2 text-[11px] font-bold text-ds-info">
                {isCard ? <CreditCard aria-hidden="true" className="h-3 w-3" /> : null}
                {paymentMethodLabel}
              </span>
            ) : null}
          </div>
          {uberNode}
        </div>
      </div>

      <div className="col-start-2 row-start-1 text-right font-mono text-[14px] font-extrabold text-ds-ink md:hidden">
        {formatCurrency(expense.totalValue || 0)}
      </div>

      <div className="col-span-2 min-w-0 md:col-span-1">
        <p className="truncate text-[13px] font-semibold text-ds-ink">{expense.supplier || "—"}</p>
        <p className="truncate text-xs text-ds-ink-faint">{planName}</p>
      </div>
      <p className="col-span-2 line-clamp-2 break-words text-[13px] leading-5 text-ds-ink md:col-span-1">{unitLabel}</p>
      <div className="col-span-2 md:col-span-1">
        <p className="font-mono text-[13px] text-ds-ink">{due ? format(due, "dd/MM/yyyy") : "—"}</p>
        {due ? <DueHint due={due} show={showDueHint} /> : null}
      </div>
      <p className="hidden text-right font-mono text-[14px] font-extrabold text-ds-ink md:block">
        {formatCurrency(expense.totalValue || 0)}
      </p>
      <div className="col-span-2 md:col-span-1 md:text-center">
        <ExpenseStatusPill statusKey={statusKey} label={statusLabel} />
      </div>
      <ChevronRight
        aria-hidden="true"
        className="hidden h-4 w-4 text-ds-ink-faint transition-transform duration-150 group-hover/row:translate-x-0.5 group-hover/row:text-ds-accent-ink motion-reduce:transition-none md:block"
      />
    </LiftRow>
  );
}

export function CardStatementListRow({
  title,
  selected,
  onOpen,
  lineCount,
  auditSummary,
  auditPending,
  unmatchedSummary,
  unmatchedActive,
  unitLabel,
  due,
  showDueHint,
  totalValue,
  statusKey,
  statusLabel,
}: {
  title: string;
  selected: boolean;
  onOpen: () => void;
  lineCount: number;
  auditSummary: string;
  auditPending: boolean;
  unmatchedSummary: string | null;
  unmatchedActive: boolean;
  unitLabel: string;
  due: Date | null;
  showDueHint: boolean;
  totalValue: number;
  statusKey: string;
  statusLabel: string;
}) {
  return (
    <LiftRow
      table
      selected={selected}
      onClick={onOpen}
      aria-label={`Abrir fatura ${title}`}
      data-testid="expense-statement-row"
      className={cn("group/row grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5", EXPENSE_LIST_COLUMNS)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <OriginTile icon={CreditCard} variant="info" />
        <div className="min-w-0 space-y-1">
          <p className="line-clamp-2 text-[13.5px] font-bold leading-5 text-ds-ink">{title}</p>
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-ds-info-bg px-2 text-[11px] font-bold text-ds-info">
            <Layers aria-hidden="true" className="h-3 w-3" /> Fatura de cartão
          </span>
        </div>
      </div>

      <div className="col-start-2 row-start-1 text-right font-mono text-[14px] font-extrabold text-ds-ink md:hidden">
        {formatCurrency(totalValue)}
      </div>

      <div className="col-span-2 min-w-0 md:col-span-1">
        <p className="text-[13px] font-semibold text-ds-ink">
          {lineCount} {lineCount === 1 ? "lançamento" : "lançamentos"}
        </p>
        <p className={cn("text-xs", auditPending ? "font-bold text-ds-warn" : "text-ds-ink-faint")}>{auditSummary}</p>
        {unmatchedSummary ? (
          <p className={cn("text-xs", unmatchedActive ? "font-bold text-ds-warn" : "text-ds-ink-faint")}>{unmatchedSummary}</p>
        ) : null}
      </div>
      <p className="col-span-2 line-clamp-2 text-[13px] leading-5 text-ds-ink md:col-span-1">{unitLabel}</p>
      <div className="col-span-2 md:col-span-1">
        <p className="font-mono text-[13px] text-ds-ink">{due ? format(due, "dd/MM/yyyy") : "—"}</p>
        {due ? <DueHint due={due} show={showDueHint} /> : null}
      </div>
      <p className="hidden text-right font-mono text-[14px] font-extrabold text-ds-ink md:block">{formatCurrency(totalValue)}</p>
      <div className="col-span-2 md:col-span-1 md:text-center">
        <ExpenseStatusPill statusKey={statusKey} label={statusLabel} />
      </div>
      <ChevronRight
        aria-hidden="true"
        className="hidden h-4 w-4 text-ds-ink-faint transition-transform duration-150 group-hover/row:translate-x-0.5 group-hover/row:text-ds-accent-ink motion-reduce:transition-none md:block"
      />
    </LiftRow>
  );
}

/** Cabeçalho de grupo por semana de vencimento: recolhe e expande o grupo. */
export function DueWeekHeader({
  collapsed,
  weekNumber,
  label,
  count,
  total,
  onToggle,
}: {
  collapsed: boolean;
  weekNumber: number | null | undefined;
  label: string;
  count: number;
  total: number;
  onToggle: () => void;
}) {
  const name = weekNumber ? `semana ${weekNumber}` : "grupo sem vencimento";
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${collapsed ? "Expandir" : "Recolher"} ${name} · ${label}`}
      onClick={onToggle}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-ds-divider bg-ds-accent-row px-[18px] py-2.5 text-left transition-colors hover:bg-ds-accent-row focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-accent-ink"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn("h-4 w-4 shrink-0 text-ds-accent-ink transition-transform duration-150 motion-reduce:transition-none", !collapsed && "rotate-90")}
      />
      <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-ds-accent-ink" />
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-accent-ink">
        {weekNumber ? `Semana ${weekNumber} · vencimento` : "Sem vencimento"}
      </span>
      <span className="text-[13px] font-bold text-ds-ink">{label}</span>
      <span className="text-xs text-ds-ink-faint">
        {count} {count === 1 ? "obrigação" : "obrigações"}
      </span>
      <span className="ml-auto font-mono text-[13px] font-extrabold text-ds-accent-ink">{formatCurrency(total)}</span>
    </button>
  );
}
