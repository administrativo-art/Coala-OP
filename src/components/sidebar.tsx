"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { brand } from "@/config/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { useAllTasks } from "@/hooks/use-all-tasks";
import { canViewPurchasing } from "@/lib/purchasing-permissions";
import { canViewTechnicalSheets } from "@/lib/commercial-permissions";
import {
  ChevronDown, X, LayoutDashboard, Package, ListTodo, Target,
  CalendarDays, Umbrella, LayoutGrid, MonitorPlay, Wallet,
  ReceiptText, Landmark, ListChecks, Settings, HelpCircle,
  LogOut, DollarSign, ShoppingCart, Network, Users, PackageCheck,
  ClipboardCheck, ListOrdered, Truck, BarChart3, ShieldAlert, Repeat, Shirt
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

interface SectionColor {
  text: string;       // active text + trigger highlight
  bg: string;         // active item background
  border: string;     // active left border
}

interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  color: SectionColor;
}

function flattenNavItem(item: NavItem): NavItem[] {
  return [item, ...(item.children ?? []).flatMap(flattenNavItem)];
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

const SECTION_COLORS: Record<string, SectionColor> = {
  ops:   { text: "#ea580c", bg: "#fff7ed", border: "#ea580c" }, // orange
  com:   { text: "#7c3aed", bg: "#f5f3ff", border: "#7c3aed" }, // violet
  fin:   { text: "#059669", bg: "#f0fdf4", border: "#059669" }, // emerald
  dp:    { text: "#0284c7", bg: "#f0f9ff", border: "#0284c7" }, // sky
  midia: { text: "#db2777", bg: "#fdf2f8", border: "#db2777" }, // pink
  cfg:   { text: "#64748b", bg: "#f8fafc", border: "#64748b" }, // slate
};

interface SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlassSidebar({ open, onOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const { user, permissions, logout } = useAuth();
  const { pendingTaskCount } = useAllTasks();
  const canAccessPurchasing = canViewPurchasing(permissions);
  const [hoverExpanded, setHoverExpanded] = useState(false);

  const navSections = useMemo((): NavSection[] => {
    const all: NavSection[] = [
      {
        key: "ops",
        label: "Operacional",
        icon: LayoutGrid,
        color: SECTION_COLORS.ops,
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
            label: "Gestão de Estoque", href: "/dashboard/stock", icon: Package, show: permissions.stock.view,
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
        color: SECTION_COLORS.com,
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
        color: SECTION_COLORS.dp,
        items: [
          { label: "Painel DP", href: "/dashboard/dp", icon: LayoutGrid, show: permissions.dp?.view },
          {
            label: "Recrutamento", href: "__group:recruitment", icon: Users, show: permissions.dp?.view,
            children: [
              { label: "Gestão da vaga", href: "/dashboard/hr/recruitment", icon: LayoutGrid, show: permissions.dp?.view },
              { label: "Integração", href: "/dashboard/hr/recruitment/integration", icon: ClipboardCheck, show: permissions.dp?.view },
              { label: "Banco de talentos", href: "/dashboard/hr/recruitment/talents", icon: Users, show: permissions.dp?.view },
            ],
          },
          {
            label: "Gestão do colaborador",
            href: permissions.dp?.collaborators?.ownProfileOnly === true && user?.id
              ? `/dashboard/dp/collaborators/${user.id}`
              : "/dashboard/dp/collaborators",
            icon: Users,
            show: permissions.dp?.collaborators?.view,
            children: [
              { label: "Documentos", href: "/dashboard/dp/documents", icon: FileText, show: permissions.settings?.manageUsers || (permissions.dp?.collaborators?.view && permissions.dp?.collaborators?.ownProfileOnly !== true) },
              { label: "Controle de uniformes", href: "/dashboard/stock/uniforms", icon: Shirt, show: permissions.stock.uniforms?.view },
              { label: "Escala", href: "/dashboard/dp/schedules", icon: CalendarDays, show: permissions.dp?.schedules?.view },
              { label: "Férias", href: "/dashboard/dp/ferias", icon: Umbrella, show: permissions.dp?.vacation?.viewAll },
            ],
          },
          { label: "Organograma", href: "/dashboard/hr/org-chart", icon: Network, show: permissions.dp?.view },
        ],
      },
      {
        key: "midia",
        label: "Marketing",
        icon: MonitorPlay,
        color: SECTION_COLORS.midia,
        items: [
          { label: "Coala Signage", href: "/dashboard/signage", icon: MonitorPlay, show: permissions.signage?.view || permissions.signage?.manage },
        ],
      },
      {
        key: "fin",
        label: "Financeiro",
        icon: Wallet,
        color: SECTION_COLORS.fin,
        items: [
          { label: "Painel Financeiro", href: "/dashboard/financial", icon: LayoutGrid, show: permissions.financial?.view && permissions.financial?.dashboard },
          { label: "Despesas", href: "/dashboard/financial/expenses", icon: ReceiptText, show: permissions.financial?.expenses?.view },
          { label: "Fluxo de Caixa", href: "/dashboard/financial/cash-flow", icon: Wallet, show: permissions.financial?.cashFlow?.view },
          { label: "Fluxo Financeiro", href: "/dashboard/financial/financial-flow", icon: DollarSign, show: permissions.financial?.financialFlow },
          { label: "DRE", href: "/dashboard/financial/dre", icon: Landmark, show: permissions.financial?.dre },
          { label: "Patrimônio", href: "/dashboard/financial/assets", icon: PackageCheck, show: permissions.assets?.view },
        ],
      },
      {
        key: "cfg",
        label: "Configurações",
        icon: Settings,
        color: SECTION_COLORS.cfg,
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
  }, [canAccessPurchasing, pendingTaskCount, permissions]);

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
    const matches = flatItems
      .filter((item) =>
        item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      )
      .sort((a, b) => b.href.length - a.href.length);

    return matches[0]?.href ?? null;
  }, [flatItems, pathname]);

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

  const userName = user?.username ?? user?.email?.split("@")[0] ?? "Usuário";
  const userEmail = user?.email ?? "";
  const userInitial = (user?.username?.[0] ?? user?.email?.[0] ?? "U").toUpperCase();
  const expanded = open || hoverExpanded;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 transition-all duration-300 lg:hidden",
          open ? "pointer-events-auto bg-black/40 backdrop-blur-sm" : "pointer-events-none bg-transparent"
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      {/* Sidebar */}
      <aside
        onMouseEnter={() => setHoverExpanded(true)}
        onMouseLeave={() => setHoverExpanded(false)}
        className={cn(
          "fixed left-4 top-4 bottom-4 z-50 flex flex-col overflow-hidden border bg-white shadow-[0_18px_45px_rgba(15,23,42,0.12)] transition-all duration-300",
          open
            ? "translate-x-0 pointer-events-auto"
            : "-translate-x-[130%] pointer-events-none lg:translate-x-0 lg:pointer-events-auto"
        )}
        style={{ width: expanded ? 336 : 84, borderRadius: 28 }}
      >
        {/* Logo area */}
        <div className={cn("relative flex-shrink-0", expanded ? "px-6 pb-5 pt-6" : "px-3 pb-5 pt-7")}>
          {expanded ? (
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-2xl bg-white">
                <img src={brand.logo} alt={brand.name} className="max-h-8 max-w-8 object-contain" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xl font-semibold tracking-normal text-slate-900">Coala Shakes</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto grid h-12 w-12 place-items-center overflow-hidden rounded-2xl bg-white" title={brand.name}>
              <img src={brand.logo} alt={brand.name} className="max-h-9 max-w-9 object-contain" />
            </div>
          )}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {expanded ? null : <div className="mx-4 h-px bg-slate-200" />}

        <div className={cn("flex-shrink-0", expanded ? "px-4 pb-2" : "px-3 pb-2 pt-4")}>
          <div className="space-y-2">
            {permissions.dashboard?.view ? (
              <Link
                href="/dashboard"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center transition-colors",
                  expanded
                    ? "h-12 gap-4 rounded-2xl px-4 text-[17px] font-medium text-slate-800 hover:bg-stone-50"
                    : "mx-auto h-12 w-12 justify-center rounded-2xl text-slate-800 hover:bg-stone-50",
                  pathname === "/dashboard"
                    ? "border border-stone-200 bg-stone-50 text-slate-950"
                    : ""
                )}
                title="Painel da gestão"
              >
                <LayoutDashboard className="h-6 w-6 flex-shrink-0 stroke-[2.2]" />
                {expanded ? <span>Painel da gestão</span> : null}
              </Link>
            ) : null}

            {(permissions.dashboard?.collaborator ?? permissions.dashboard?.view) ? (
              <Link
                href="/dashboard/collaborator"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center transition-colors",
                  expanded
                    ? "h-12 gap-4 rounded-2xl px-4 text-[17px] font-medium text-slate-800 hover:bg-stone-50"
                    : "mx-auto h-12 w-12 justify-center rounded-2xl text-slate-800 hover:bg-stone-50",
                  pathname === "/dashboard/collaborator"
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                    : ""
                )}
                title="Painel do colaborador"
              >
                <ClipboardCheck className="h-6 w-6 flex-shrink-0 stroke-[2.2]" />
                {expanded ? <span>Painel do colaborador</span> : null}
              </Link>
            ) : null}
          </div>
        </div>

        {/* Accordion nav */}
        <nav className={cn("flex-1 overflow-y-auto", expanded ? "px-4 py-1" : "px-3 py-1")}>
          {expanded ? (
            navSections.map(section => {
              const isOpen = openSections.has(section.key);
              const hasActive = section.items.some(isItemOrChildActive);
              const SectionIcon = section.icon;
              const sectionBadgeCount = section.items.reduce((sum, item) => sum + (item.badge?.count || 0), 0);

              return (
                <div
                  key={section.key}
                  className={cn(
                    "mb-2 rounded-2xl border border-transparent transition-colors",
                    (isOpen || hasActive) && "border-stone-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    className={cn(
                      "flex h-12 w-full items-center gap-4 rounded-2xl px-4 text-[17px] font-medium text-slate-800 transition-colors hover:bg-stone-50",
                      (isOpen || hasActive) && "text-slate-950 hover:bg-transparent"
                    )}
                  >
                    <SectionIcon className="h-6 w-6 flex-shrink-0 stroke-[2.2]" />
                    <span className="flex-1 text-left">{section.label}</span>
                    {sectionBadgeCount > 0 ? (
                      <span className="grid min-w-[26px] place-items-center rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold text-white">
                        {sectionBadgeCount}
                      </span>
                    ) : (
                      <ChevronDown
                        className={cn("h-5 w-5 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")}
                      />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mb-3 ml-7 mt-0.5 space-y-0.5 border-l border-stone-200 py-1 pl-5">
                      {section.items.map(item => {
                        const active = isItemActive(item);
                        const count = item.badge?.count ?? 0;
                        const hasChildren = !!item.children?.length;
                        const groupOpen = openGroups.has(item.href);
                        const childActive = item.children?.some(isItemActive) ?? false;
                        const parentActive = active || childActive;
                        const isVirtualGroup = item.href.startsWith("__group:");

                        const dot = (on: boolean) => (
                          <span
                            className="h-2 w-2 flex-shrink-0 rounded-full transition-opacity"
                            style={{ background: section.color.text, opacity: on ? 1 : 0.6 }}
                          />
                        );

                        if (hasChildren) {
                          return (
                            <div key={item.href}>
                              <div
                                className={cn(
                                  "relative flex min-h-9 w-full items-center gap-3 rounded-xl px-3 py-1.5 text-[15px] font-medium text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-700",
                                  parentActive && "font-semibold text-slate-950 hover:text-slate-950"
                                )}
                              >
                                {parentActive && (
                                  <span
                                    className="absolute -left-[21px] top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-full"
                                    style={{ background: section.color.text }}
                                  />
                                )}
                                {dot(parentActive)}
                                {isVirtualGroup ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleGroup(item.href)}
                                    className="min-w-0 flex-1 truncate text-left"
                                  >
                                    {item.label}
                                  </button>
                                ) : (
                                  <Link
                                    href={item.href}
                                    onClick={() => onOpenChange(false)}
                                    className="min-w-0 flex-1 truncate text-left"
                                  >
                                    {item.label}
                                  </Link>
                                )}
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(item.href)}
                                  className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-stone-100 hover:text-slate-600"
                                  aria-label={groupOpen ? `Recolher ${item.label}` : `Expandir ${item.label}`}
                                >
                                  <ChevronDown
                                    className={cn("h-4 w-4 transition-transform duration-200", groupOpen && "rotate-180")}
                                  />
                                </button>
                              </div>

                              {groupOpen && (
                                <div className="ml-[7px] mt-0.5 space-y-0.5 border-l border-stone-200 py-0.5 pl-[19px]">
                                  {item.children!.map(child => {
                                    const cActive = isItemActive(child);
                                    const cHasChildren = !!child.children?.length;
                                    const cGroupOpen = openGroups.has(child.href);
                                    const cChildActive = hasActiveDescendant(child, isItemActive);

                                    if (cHasChildren) {
                                      return (
                                        <div key={child.href}>
                                          <button
                                            type="button"
                                            onClick={() => toggleGroup(child.href)}
                                            className={cn(
                                              "relative flex min-h-8 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-[14px] font-medium text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-700",
                                              (cActive || cChildActive) && "font-semibold text-slate-950 hover:text-slate-950"
                                            )}
                                          >
                                            {(cActive || cChildActive) && (
                                              <span
                                                className="absolute -left-[20px] top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full"
                                                style={{ background: section.color.text }}
                                              />
                                            )}
                                            <span
                                              className="h-1.5 w-1.5 flex-shrink-0 rounded-full transition-opacity"
                                              style={{ background: section.color.text, opacity: (cActive || cChildActive) ? 1 : 0.45 }}
                                            />
                                            <span className="flex-1 truncate text-left">{child.label}</span>
                                            <ChevronDown
                                              className={cn("h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform duration-200", cGroupOpen && "rotate-180")}
                                            />
                                          </button>

                                          {cGroupOpen && (
                                            <div className="ml-[7px] mt-0.5 space-y-0.5 border-l border-stone-200 py-0.5 pl-[17px]">
                                              {child.children!.map(grandchild => {
                                                const gActive = isItemActive(grandchild);
                                                return (
                                                  <Link
                                                    key={grandchild.href}
                                                    href={grandchild.href}
                                                    onClick={() => onOpenChange(false)}
                                                    className={cn(
                                                      "relative flex min-h-7 items-center gap-2 rounded-xl px-3 py-1 text-[13px] font-medium text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-700",
                                                      gActive && "font-semibold text-slate-950 hover:text-slate-950"
                                                    )}
                                                  >
                                                    {gActive && (
                                                      <span
                                                        className="absolute -left-[18px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full"
                                                        style={{ background: section.color.text }}
                                                      />
                                                    )}
                                                    <span
                                                      className="h-1.5 w-1.5 flex-shrink-0 rounded-full transition-opacity"
                                                      style={{ background: section.color.text, opacity: gActive ? 1 : 0.4 }}
                                                    />
                                                    <span className="flex-1 truncate">{grandchild.label}</span>
                                                  </Link>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    }

                                    return (
                                      <Link
                                        key={child.href}
                                        href={child.href}
                                        onClick={() => onOpenChange(false)}
                                        className={cn(
                                          "relative flex min-h-8 items-center gap-2.5 rounded-xl px-3 py-1.5 text-[14px] font-medium text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-700",
                                          cActive && "font-semibold text-slate-950 hover:text-slate-950"
                                        )}
                                      >
                                        {cActive && (
                                          <span
                                            className="absolute -left-[20px] top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full"
                                            style={{ background: section.color.text }}
                                          />
                                        )}
                                        <span
                                          className="h-1.5 w-1.5 flex-shrink-0 rounded-full transition-opacity"
                                          style={{ background: section.color.text, opacity: cActive ? 1 : 0.45 }}
                                        />
                                        <span className="flex-1 truncate">{child.label}</span>
                                      </Link>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        }

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => onOpenChange(false)}
                            className={cn(
                              "relative flex min-h-9 items-center gap-3 rounded-xl px-3 py-1.5 text-[15px] font-medium text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-700",
                              active && "font-semibold text-slate-950 hover:text-slate-950"
                            )}
                          >
                            {active && (
                              <span
                                className="absolute -left-[21px] top-1/2 h-7 w-0.5 -translate-y-1/2 rounded-full"
                                style={{ background: section.color.text }}
                              />
                            )}
                            {dot(active)}
                            <span className="flex-1 truncate">{item.label}</span>
                            {count > 0 && (
                              <span className={cn("ml-auto text-[13px] font-medium tabular-nums", active ? "text-slate-500" : "text-slate-400")}>
                                {count}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="space-y-2">
              {navSections.map((section) => {
                const Icon = section.icon;
                const active = section.items.some(isItemOrChildActive);
                const badgeCount = section.items.reduce((sum, item) => sum + (item.badge?.count || 0), 0);

                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => {
                      setOpenSections((prev) => {
                        const next = new Set(prev);
                        next.add(section.key);
                        return next;
                      });
                      setHoverExpanded(true);
                    }}
                    className={cn(
                      "relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-slate-800 transition-colors hover:bg-stone-50",
                      active && "border border-stone-200 bg-stone-50 text-slate-950"
                    )}
                    title={section.label}
                  >
                    <Icon className="h-6 w-6 stroke-[2.2]" />
                    {badgeCount > 0 && (
                      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </nav>

        <div className={cn("mx-4 h-px bg-slate-200", expanded ? "mb-4" : "mb-3")} />

        {/* Footer */}
        <div className={cn("flex-shrink-0 pb-5", expanded ? "px-5" : "px-3")}>
          <div className={cn("flex items-center", expanded ? "gap-2.5" : "justify-center")}>
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #f43f5e, #14b8a6)" }}
            >
              {userInitial}
            </div>
            {expanded ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold leading-tight">{userName}</p>
                  <p className="truncate text-[10px] text-muted-foreground leading-tight">{userEmail}</p>
                </div>
                <div className="flex items-center gap-1">
                  <ThemeToggle />
                  <button
                    onClick={logout}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Sair"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
