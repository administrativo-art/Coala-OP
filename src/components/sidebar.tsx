"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { navigationActiveHref } from "@/lib/navigation-active-href";
import { financialSidebarPath } from "@/features/financial/lib/reconciliation-navigation";
import { cn } from "@/lib/utils";
import { SystemBrand } from "@/components/patterns/system-brand";
import { UserProfile } from "@/components/user-profile";
import { useNavTrail } from "@/components/navigation/nav-trail";
import { useAuth } from "@/hooks/use-auth";
import { useAllTasks } from "@/hooks/use-all-tasks";
import { canViewPurchasing } from "@/lib/purchasing-permissions";
import { canViewTechnicalSheets } from "@/lib/commercial-permissions";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import {
  ChevronDown, X, LayoutDashboard, Package, ListTodo, Target,
  CalendarDays, Umbrella, LayoutGrid, MonitorPlay, Wallet,
  ReceiptText, Landmark, ListChecks, Settings, HelpCircle,
  DollarSign, ShoppingCart, Network, Users, PackageCheck,
  ClipboardCheck, ListOrdered, Truck, BarChart3, ShieldAlert, Repeat, Shirt,
  Files, Building2, FileStack, Banknote, UserCircle
} from "lucide-react";
import { FileText } from "@phosphor-icons/react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean | undefined;
  badge?: { count: number; variant: "crit" | "warn" | "info" | "ok" };
  children?: NavItem[];
}


interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
}

function flattenNavItem(item: NavItem): NavItem[] {
  return [item, ...(item.children ?? []).flatMap(flattenNavItem)];
}

/** Rótulos do caminho até o item ativo (grupo › subgrupo › item), ou null se nenhum está ativo. */
function findTrail(items: NavItem[], isActive: (item: NavItem) => boolean): string[] | null {
  for (const item of items) {
    if (isActive(item)) return [item.label];
    const below = findTrail(item.children ?? [], isActive);
    if (below) return [item.label, ...below];
  }
  return null;
}

function hasActiveDescendant(item: NavItem, isActive: (item: NavItem) => boolean): boolean {
  return item.children?.some((child) => isActive(child) || hasActiveDescendant(child, isActive)) ?? false;
}

function findActiveParentHrefs(items: NavItem[], isActive: (item: NavItem) => boolean): string[] {
  const parents: string[] = [];

  for (const item of items) {
    if (hasActiveDescendant(item, isActive)) {
      parents.push(item.href, ...findActiveParentHrefs(item.children ?? [], isActive));
    }
  }

  return parents;
}


interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlassSidebar({ open, onOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, permissions, isDefaultAdmin } = useAuth();
  const { pendingTaskCount } = useAllTasks();
  const canAccessPurchasing = canViewPurchasing(permissions);
  /* Recolhida por padrão; expande ao passar o cursor ou ao focar por teclado, flutuando sobre a tela. */
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const { setTrail } = useNavTrail();
  const closeTimer = useRef<number | null>(null);

  const navSections = useMemo((): NavSection[] => {
    const all: NavSection[] = [
      {
        key: "ops",
        label: "Operacional",
        icon: LayoutGrid,
        items: [
          { label: "Painel de Operações", href: "/dashboard/operations", icon: LayoutGrid, show: permissions.dashboard.operational },
          { label: "Tarefas gerais", href: "/dashboard/tasks", icon: ListTodo, show: permissions.tasks.view, badge: pendingTaskCount > 0 ? { count: pendingTaskCount, variant: "warn" } : undefined },
          {
            label: "Formulários",
            href: "/dashboard/forms",
            icon: FileText,
            show: permissions.forms.global.view_all_projects || permissions.forms.global.create_projects || permissions.forms.global.manage_templates || permissions.forms.global.view_analytics,
            children: [
              { label: "Painel", href: "/dashboard/forms", icon: LayoutGrid, show: permissions.forms.global.view_all_projects || permissions.forms.global.create_projects || permissions.forms.global.manage_templates || permissions.forms.global.view_analytics },
              { label: "Meus formulários", href: "/dashboard/forms/mine", icon: ClipboardCheck, show: permissions.forms.global.view_all_projects },
            ],
          },
          {
            label: "Gestão de Estoque", href: "__group:stock", icon: Package, show: permissions.stock.view,
            children: [
              { label: "Controle de estoque", href: "/dashboard/inventory-control", icon: ClipboardCheck, show: permissions.stock.inventoryControl.view },
              { label: "Contagem de estoque", href: "/dashboard/stock/count", icon: ListOrdered, show: permissions.stock.stockCount.view },
              { label: "Reposição", href: "/dashboard/stock/analysis", icon: Truck, show: permissions.reposition.view || permissions.stock.analysis.restock },
              {
                label: "Análise estratégica", href: "/dashboard/reports", icon: BarChart3, show: permissions.stock.analysis.view,
                children: [
                  { label: "Consumo médio", href: "/dashboard/stock/analysis/consumption", icon: BarChart3, show: permissions.stock.analysis.consumption },
                  { label: "Análise de vendas", href: "/dashboard/stock/analysis/sales", icon: BarChart3, show: permissions.stock.analysis.consumption },
                  { label: "Projeção", href: "/dashboard/stock/analysis/projection", icon: BarChart3, show: permissions.stock.analysis.projection },
                  { label: "Movimentações", href: "/dashboard/stock/analysis/movement-analysis", icon: BarChart3, show: permissions.stock.inventoryControl.viewHistory },
                  { label: "Avaliação financeira", href: "/dashboard/stock/analysis/valuation", icon: BarChart3, show: permissions.stock.analysis.valuation },
                ],
              },
              { label: "Gestão de avarias", href: "/dashboard/stock/returns", icon: ShieldAlert, show: permissions.stock.returns.view },
              { label: "Conversão de medidas", href: "/dashboard/conversions", icon: Repeat, show: permissions.stock.conversions.view },
            ],
          },
          {
            label: "Compras", href: "/dashboard/purchasing", icon: ShoppingCart, show: canAccessPurchasing,
            children: [
              { label: "Painel", href: "/dashboard/purchasing", icon: LayoutGrid, show: canAccessPurchasing },
              { label: "Cotações", href: "/dashboard/purchasing/quotations", icon: ReceiptText, show: canAccessPurchasing },
              { label: "Pedidos de compra", href: "/dashboard/purchasing/orders", icon: ShoppingCart, show: canAccessPurchasing },
              { label: "Recebimentos", href: "/dashboard/purchasing/receipts", icon: PackageCheck, show: canAccessPurchasing },
              { label: "Histórico de custo", href: "/dashboard/purchasing/costs", icon: Landmark, show: canAccessPurchasing },
            ],
          },
        ],
      },
      {
        key: "com",
        label: "Comercial",
        icon: Target,
        items: [
          { label: "Ficha técnica", href: "/dashboard/commercial", icon: FileText, show: canViewTechnicalSheets(permissions) },
          {
            label: "Metas de Vendas", href: "/dashboard/goals", icon: Target, show: permissions.goals?.view,
            children: [
              { label: "Acompanhamento", href: "/dashboard/goals/tracking", icon: Target, show: permissions.goals?.view },
              { label: "Análise", href: "/dashboard/goals/analysis", icon: BarChart3, show: permissions.goals?.view },
              { label: "Histórico", href: "/dashboard/goals/history", icon: ListChecks, show: permissions.goals?.view },
            ],
          },
          {
            label: "Gestão de Preços", href: "/dashboard/pricing", icon: DollarSign, show: permissions.pricing.view,
            children: [
              { label: "Ficha de custo e margem", href: "/dashboard/pricing/cost-analysis", icon: DollarSign, show: permissions.pricing.view },
              { label: "Estudo de preço", href: "/dashboard/pricing/price-comparison", icon: BarChart3, show: permissions.pricing.view },
            ],
          },
        ],
      },
      {
        key: "dp",
        label: "Pessoal",
        icon: Users,
        items: [
          { label: "Acompanhamento", href: "/dashboard/processes", icon: ListChecks, show: permissions.dp?.view },
          { label: "Painel DP", href: "/dashboard/dp", icon: LayoutGrid, show: permissions.dp?.view },
          {
            label: "Recrutamento", href: "__group:recruitment", icon: Users, show: permissions.dp?.view || hasFormalizationPermission(permissions, "view"),
            children: [
              { label: "Gestão da vaga", href: "/dashboard/hr/recruitment", icon: LayoutGrid, show: permissions.dp?.view },
              { label: "Banco de talentos", href: "/dashboard/hr/recruitment/talents", icon: Users, show: permissions.dp?.view },
            ],
          },
          {
            label: "Gestão do colaborador",
            href: "__group:collaborator-management",
            icon: Users,
            show:
              permissions.dp?.collaborators?.view ||
              hasFormalizationPermission(permissions, "view") ||
              permissions.dp?.schedules?.view ||
              permissions.dp?.vacation?.viewAll ||
              permissions.stock.uniforms?.view ||
              permissions.dp?.view,
            children: [
              {
                label: "Perfil do colaborador",
                href: permissions.dp?.collaborators?.ownProfileOnly === true && user?.id
                  ? `/dashboard/dp/collaborators/${user.id}`
                  : "/dashboard/dp/collaborators",
                icon: UserCircle,
                show: permissions.dp?.collaborators?.view,
              },
              { label: "Integração", href: "/dashboard/hr/recruitment/integration", icon: ClipboardCheck, show: hasFormalizationPermission(permissions, "view") },
              { label: "Escala", href: "/dashboard/dp/schedules", icon: CalendarDays, show: permissions.dp?.schedules?.view },
              { label: "Férias", href: "/dashboard/dp/ferias", icon: Umbrella, show: permissions.dp?.vacation?.viewAll },
              { label: "Uniforme", href: "/dashboard/stock/uniforms", icon: Shirt, show: permissions.stock.uniforms?.view },
              { label: "Desligamento", href: "/dashboard/dp/terminations", icon: FileStack, show: permissions.dp?.view },
            ],
          },
          { label: "Organograma", href: "/dashboard/hr/org-chart", icon: Network, show: permissions.dp?.view },
        ],
      },
      {
        key: "docs",
        label: "Documentos",
        icon: Files,
        items: [
          {
            label: "Central de documentos",
            href: "/dashboard/documents/generated",
            icon: FileStack,
            show: hasFormalizationPermission(permissions, "documents.view"),
          },
          {
            label: "Modelos",
            href: "/dashboard/documents/templates",
            icon: FileStack,
            show: hasFormalizationPermission(permissions, "templates.view"),
          },
          {
            label: "Documentos da empresa",
            href: "/dashboard/documents/company",
            icon: Building2,
            show: hasFormalizationPermission(permissions, "companyDocuments.view"),
          },
          {
            label: "Documentos dos colaboradores",
            href: "/dashboard/documents/collaborators",
            icon: Users,
            show: hasFormalizationPermission(permissions, "documents.view"),
          },
        ],
      },
      {
        key: "midia",
        label: "Marketing",
        icon: MonitorPlay,
        items: [
          { label: "Coala Signage", href: "/dashboard/signage", icon: MonitorPlay, show: permissions.signage?.view || permissions.signage?.manage },
        ],
      },
      {
        key: "fin",
        label: "Financeiro",
        icon: Wallet,
        items: [
          { label: "Painel Financeiro", href: "/dashboard/financial", icon: LayoutGrid, show: permissions.financial?.view && permissions.financial?.dashboard },
          {
            label: "Despesas",
            href: "/dashboard/financial/expenses",
            icon: ReceiptText,
            show: permissions.financial?.expenses?.view
              || permissions.financial?.inbox?.view
              || permissions.financial?.paymentRequests?.view,
          },
          {
            label: "Conciliação e fechamento",
            href: "__group:reconciliation",
            icon: ClipboardCheck,
            show: permissions.financial?.view || permissions.financial?.cashDeposits?.view || permissions.financial?.audits?.view || permissions.financial?.cardStatements?.view || isDefaultAdmin,
            children: [
              { label: "Fechamento de caixa", href: "/dashboard/financial/cash-closures", icon: Wallet, show: permissions.financial?.view },
              { label: "Depósitos", href: "/dashboard/financial/cash-deposits", icon: Banknote, show: permissions.financial?.cashDeposits?.view },
              { label: "Conciliação de vendas", href: "/dashboard/financial/sales-reconciliation", icon: ClipboardCheck, show: isDefaultAdmin },
              { label: "Conciliação de recebimentos", href: "/dashboard/financial/stone-receipts", icon: DollarSign, show: isDefaultAdmin },
              { label: "Extratos bancários", href: "/dashboard/financial/reconciliation/bank-statements", icon: Landmark, show: permissions.financial?.audits?.view },
              { label: "Faturas de cartão de crédito", href: "/dashboard/financial/reconciliation/card-statements", icon: ReceiptText, show: permissions.financial?.cardStatements?.view },
            ],
          },
          {
            label: "Fluxo de caixa",
            href: "__group:cash-flow",
            icon: Wallet,
            show: permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow || isDefaultAdmin,
            children: [
              { label: "Visão do caixa", href: "/dashboard/financial/cash-flow", icon: Wallet, show: permissions.financial?.cashFlow?.view || permissions.financial?.financialFlow },
              { label: "Recebíveis", href: "/dashboard/financial/cash-flow/receivables", icon: Wallet, show: isDefaultAdmin },
              { label: "Coala Financeiro", href: "/dashboard/financial/cash-flow/agent", icon: Wallet, show: isDefaultAdmin },
            ],
          },
          { label: "DRE", href: "/dashboard/financial/dre", icon: Landmark, show: permissions.financial?.dre },
          { label: "Patrimônio", href: "/dashboard/financial/assets", icon: PackageCheck, show: permissions.assets?.view },
        ],
      },
      {
        key: "cfg",
        label: "Configurações",
        icon: Settings,
        items: [
          { label: "Configurações", href: "/dashboard/settings", icon: Settings, show: permissions.settings.view },
          { label: "Ajuda", href: "/dashboard/help", icon: HelpCircle, show: permissions.help.view },
        ],
      },
    ];
    return all
      .map(s => ({
        ...s,
        items: s.items
          .filter(i => i.show)
          .map(i => (i.children ? { ...i, children: i.children.filter(c => c.show) } : i)),
      }))
      .filter(s => s.items.length > 0);
  }, [
    canAccessPurchasing,
    pendingTaskCount,
    permissions,
    isDefaultAdmin,
    user?.employmentRelationshipType,
    user?.id,
    user?.isActive,
  ]);

  // Flatten items + their children for active-route matching.
  const flatItems = useMemo(
    () => navSections.flatMap(s => s.items.flatMap(flattenNavItem)),
    [navSections]
  );

  // Start with all accordion sections collapsed.
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  function toggleSection(key: string) {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeHref = useMemo(() => {
    const hrefs = flatItems.map(item => item.href);
    return navigationActiveHref(hrefs, financialSidebarPath(pathname, hrefs), searchParams.toString());
  }, [flatItems, pathname, searchParams]);

  function isItemActive(item: NavItem) {
    return item.href === activeHref;
  }

  function isItemOrChildActive(item: NavItem) {
    return isItemActive(item) || hasActiveDescendant(item, isItemActive);
  }

  // Track expanded nested groups (e.g. Gestão de Estoque). Starts collapsed.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());

  function toggleGroup(href: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  const activeSectionKey = useMemo(
    () => navSections.find((section) => section.items.some(isItemOrChildActive))?.key ?? null,
    [activeHref, navSections]
  );

  // Auto-open the parent group whose child route is active.
  const activeGroupHrefs = useMemo(
    () => navSections.flatMap((section) => findActiveParentHrefs(section.items, isItemActive)),
    [activeHref, navSections]
  );

  useEffect(() => {
    if (!activeSectionKey) return;
    setOpenSections((prev) => {
      if (prev.has(activeSectionKey)) return prev;
      const next = new Set(prev);
      next.add(activeSectionKey);
      return next;
    });
  }, [activeSectionKey]);

  useEffect(() => {
    if (activeGroupHrefs.length === 0) return;
    setOpenGroups((prev) => {
      const next = new Set(prev);
      activeGroupHrefs.forEach((href) => next.add(href));
      return next;
    });
  }, [activeGroupHrefs]);

  // Keyboard: close drawer on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  // Lock scroll on mobile when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Publica o caminho da tela atual para a barra superior.
  useEffect(() => {
    for (const section of navSections) {
      const below = findTrail(section.items, isItemActive);
      if (below) {
        setTrail([section.label, ...below]);
        return;
      }
    }
    setTrail([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref, navSections, setTrail]);

  const expanded = open || hoverExpanded || keyboardFocus;

  function openRail() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setHoverExpanded(true);
  }

  function closeRail() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHoverExpanded(false), 140);
  }

  const itemBase =
    "group/item relative flex min-h-9 items-center gap-2.5 rounded-ds-btn px-2.5 py-1.5 text-[13px] font-semibold text-ds-on-dark-sub transition-[color,background,transform] duration-200 hover:translate-x-0.5 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker motion-reduce:transition-none motion-reduce:hover:translate-x-0";
  const itemActive = "bg-white/10 font-extrabold text-white";
  const iconClass =
    "shrink-0 transition-[transform,color] duration-300 ease-out group-hover/item:-rotate-6 group-hover/item:scale-125 group-hover/item:text-ds-accent-kicker motion-reduce:transition-none motion-reduce:group-hover/item:rotate-0 motion-reduce:group-hover/item:scale-100";

  function activeBar() {
    return <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-ds-accent" />;
  }

  /** Item de qualquer nível: link com ícone, ou grupo recolhível (abre/fecha com animação de altura). */
  function renderItem(item: NavItem, depth: number): React.ReactNode {
    const active = isItemActive(item);
    const count = item.badge?.count ?? 0;
    const children = item.children ?? [];
    const Icon = item.icon;
    const iconSize = depth === 0 ? "h-[18px] w-[18px]" : "h-4 w-4";
    if (children.length === 0) {
      return (
        <Link key={item.href} href={item.href} onClick={() => onOpenChange(false)} className={cn(itemBase, active && itemActive)}>
          {active && activeBar()}
          <Icon className={cn(iconSize, iconClass)} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {count > 0 && <span className="rounded-full bg-ds-accent px-2 py-0.5 font-ds-mono text-[10px] font-bold text-ds-dark">{count}</span>}
        </Link>
      );
    }
    const isOpen = openGroups.has(item.href);
    const parentActive = active || hasActiveDescendant(item, isItemActive);
    const isVirtualGroup = item.href.startsWith("__group:");
    const label = depth === 0 && !isVirtualGroup ? (
      <Link href={item.href} onClick={() => onOpenChange(false)} className="min-w-0 flex-1 truncate text-left">{item.label}</Link>
    ) : (
      <button type="button" onClick={() => toggleGroup(item.href)} className="min-w-0 flex-1 truncate text-left">{item.label}</button>
    );
    return (
      <div key={item.href}>
        <div className={cn(itemBase, "pr-1", parentActive && itemActive)}>
          {parentActive && activeBar()}
          <Icon className={cn(iconSize, iconClass)} />
          {label}
          <button
            type="button"
            onClick={() => toggleGroup(item.href)}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Recolher ${item.label}` : `Expandir ${item.label}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-ds-sm text-ds-on-dark-muted transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-180")} aria-hidden="true" />
          </button>
        </div>
        <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
          <div className="overflow-hidden">
            <div className="ml-4 mt-0.5 space-y-0.5 pb-0.5 pl-1">
              {children.map((child) => renderItem(child, depth + 1))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const quickLink = (href: string, label: string, Icon: React.ComponentType<{ className?: string }>, current: boolean) => (
    <Link
      href={href}
      onClick={() => onOpenChange(false)}
      title={expanded ? undefined : label}
      className={cn(
        "group/quick relative flex items-center rounded-ds-btn-lg text-[13px] font-extrabold text-ds-on-dark-sub transition-[color,background,transform] duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker motion-reduce:transition-none",
        expanded ? "h-10 gap-2.5 px-3 hover:translate-x-0.5 motion-reduce:hover:translate-x-0" : "mx-auto h-10 w-10 justify-center",
        current && itemActive
      )}
    >
      {current && <span aria-hidden="true" className={cn("absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ds-accent", expanded ? "-left-0" : "-left-1")} />}
      <Icon className="h-[18px] w-[18px] shrink-0 transition-transform duration-300 group-hover/quick:-rotate-6 group-hover/quick:scale-110 motion-reduce:transition-none" />
      {expanded ? <span className="truncate">{label}</span> : <span className="sr-only">{label}</span>}
    </Link>
  );

  return (
    <>
      {/* Reserva do trilho fica no layout (lg:pl-[88px]); a barra expandida flutua por cima da tela. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[var(--ds-scrim)] transition-opacity duration-300 lg:hidden",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <aside
        aria-label="Navegação do Coala One"
        data-collapsed={!expanded || undefined}
        onMouseEnter={openRail}
        onMouseLeave={closeRail}
        onFocus={(event) => {
          if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) setKeyboardFocus(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setKeyboardFocus(false);
        }}
        className={cn(
          "fixed bottom-3 left-3 top-3 z-50 flex flex-col overflow-hidden rounded-ds-panel bg-ds-dark font-ds text-ds-on-dark ring-1 ring-white/10",
          "transition-[width,transform,box-shadow] duration-300 ease-out motion-reduce:transition-none",
          expanded ? "w-[280px] shadow-ds-modal" : "w-[76px] shadow-ds-panel",
          open ? "pointer-events-auto translate-x-0" : "pointer-events-none -translate-x-[130%] lg:pointer-events-auto lg:translate-x-0"
        )}
      >
        <div className={cn("relative flex shrink-0 items-center justify-center", expanded ? "px-4 pb-2 pt-4" : "px-2 pb-2 pt-4")}>
          <Link href="/dashboard" onClick={() => onOpenChange(false)} className="rounded-ds-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker" aria-label="Coala One, início">
            <SystemBrand collapsed={!expanded} accent="One" animation="shimmer" />
          </Link>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-ds-md text-ds-on-dark-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className={cn("shrink-0 space-y-1", expanded ? "px-3 pb-1" : "px-2 pb-1 pt-1")}>
          {permissions.dashboard?.view ? quickLink("/dashboard", "Painel da gestão", LayoutDashboard, pathname === "/dashboard") : null}
          {(permissions.dashboard?.collaborator ?? permissions.dashboard?.view)
            ? quickLink("/dashboard/collaborator", "Painel do colaborador", ClipboardCheck, pathname === "/dashboard/collaborator")
            : null}
        </div>

        <div aria-hidden="true" className="mx-4 my-1 h-px shrink-0 bg-white/10" />

        <nav className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", expanded ? "px-3 py-1" : "px-2 py-1")}>
          {expanded ? (
            navSections.map((section) => {
              const isOpen = openSections.has(section.key);
              const sectionBadgeCount = section.items.reduce((sum, item) => sum + (item.badge?.count || 0), 0);
              return (
                <section key={section.key} aria-labelledby={`nav-${section.key}`} className="mb-1">
                  <h2 id={`nav-${section.key}`}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between rounded-ds-sm px-2.5 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted transition-colors hover:text-ds-on-dark-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
                    >
                      <span>{section.label}</span>
                      <span className="flex items-center gap-2">
                        {sectionBadgeCount > 0 && <span className="rounded-full bg-ds-accent px-1.5 py-0.5 font-ds-mono text-[10px] font-bold normal-case tracking-normal text-ds-dark">{sectionBadgeCount}</span>}
                        <ChevronDown className={cn("h-3 w-3 transition-transform duration-200 motion-reduce:transition-none", !isOpen && "-rotate-90")} aria-hidden="true" />
                      </span>
                    </button>
                  </h2>
                  <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                    <div className="overflow-hidden">
                      <div className="space-y-0.5 py-0.5">
                        {section.items.map((item) => renderItem(item, 0))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })
          ) : (
            <div className="space-y-1">
              {navSections.map((section, index) => (
                <div key={section.key} className="space-y-1">
                  {index > 0 && <div aria-hidden="true" className="mx-3 my-2 border-t border-white/10" />}
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemOrChildActive(item);
                    const hasChildren = (item.children?.length ?? 0) > 0;
                    const virtual = item.href.startsWith("__group:");
                    const railButton = cn(
                      "group/item relative mx-auto flex h-10 w-10 items-center justify-center rounded-ds-btn-lg text-ds-on-dark-sub transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
                      active && itemActive
                    );
                    const inner = (
                      <>
                        {active && <span aria-hidden="true" className="absolute -left-1 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ds-accent" />}
                        <Icon className={cn("h-[18px] w-[18px]", iconClass)} />
                        <span className="sr-only">{item.label}</span>
                        {(item.badge?.count ?? 0) > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-ds-accent" />}
                      </>
                    );
                    // Item sem submenu ou com destino próprio navega; grupo virtual abre a barra no próprio grupo.
                    return hasChildren && virtual ? (
                      <button
                        key={item.href}
                        type="button"
                        title={item.label}
                        onClick={() => {
                          setOpenSections((prev) => new Set(prev).add(section.key));
                          setOpenGroups((prev) => new Set(prev).add(item.href));
                          openRail();
                        }}
                        className={railButton}
                      >
                        {inner}
                      </button>
                    ) : (
                      <Link key={item.href} href={item.href} title={item.label} onClick={() => onOpenChange(false)} className={railButton}>
                        {inner}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </nav>

        <div className={cn("shrink-0 border-t border-white/10", expanded ? "p-3" : "p-2")}>
          <UserProfile variant="card" collapsed={!expanded} />
        </div>
      </aside>
    </>
  );
}
