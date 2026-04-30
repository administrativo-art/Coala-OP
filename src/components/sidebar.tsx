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
import {
  ChevronDown, X, LayoutDashboard, Package, ListTodo, Target,
  CalendarDays, Umbrella, LayoutGrid, MonitorPlay, Wallet,
  ReceiptText, Landmark, ListChecks, Settings, HelpCircle,
  LogOut, DollarSign, ShoppingCart, Network, Users
} from "lucide-react";
import { FileText } from "@phosphor-icons/react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean | undefined;
  badge?: { count: number; variant: "crit" | "warn" | "info" | "ok" };
}

interface SectionColor {
  text: string;       // active text + trigger highlight
  bg: string;         // active item background
  border: string;     // active left border
}

interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
  color: SectionColor;
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

const BADGE_COLORS: Record<"crit" | "warn" | "info" | "ok", { bg: string; color: string }> = {
  crit: { bg: "#fef2f2", color: "#dc2626" },
  warn: { bg: "#fffbeb", color: "#d97706" },
  info: { bg: "#eef2ff", color: "#4338ca" },
  ok:   { bg: "#f0fdf4", color: "#16a34a" },
};

export function GlassSidebar({ open, onOpenChange }: SidebarProps) {
  const pathname = usePathname();
  const { user, permissions, logout } = useAuth();
  const { pendingTaskCount } = useAllTasks();
  const canAccessPurchasing = canViewPurchasing(permissions);

  const navSections = useMemo((): NavSection[] => {
    const all: NavSection[] = [
      {
        key: "ops",
        label: "Operacional",
        color: SECTION_COLORS.ops,
        items: [
          { label: "Painel de Operações", href: "/dashboard/operations", icon: LayoutGrid, show: permissions.dashboard.operational },
          { label: "Tarefas gerais", href: "/dashboard/tasks", icon: ListTodo, show: permissions.tasks.view, badge: pendingTaskCount > 0 ? { count: pendingTaskCount, variant: "warn" } : undefined },
          { label: "Formulários", href: "/dashboard/forms", icon: FileText, show: permissions.forms.global.view_all_projects || permissions.forms.global.create_projects || permissions.dp?.checklists?.view || permissions.dp?.checklists?.operate || permissions.dp?.checklists?.manageTemplates },
          { label: "Checklists", href: "/dashboard/dp/checklists", icon: ListChecks, show: permissions.dp?.checklists?.view || permissions.dp?.checklists?.operate || permissions.dp?.checklists?.manageTemplates || permissions.dp?.view },
          { label: "Gestão de Estoque", href: "/dashboard/stock", icon: Package, show: permissions.stock.view },
          { label: "Compras", href: "/dashboard/purchasing", icon: ShoppingCart, show: canAccessPurchasing },
        ],
      },
      {
        key: "com",
        label: "Comercial",
        color: SECTION_COLORS.com,
        items: [
          { label: "Painel Comercial", href: "/dashboard/commercial", icon: LayoutGrid, show: permissions.dashboard.pricing || permissions.dashboard.technicalSheets },
          { label: "Metas de Vendas", href: "/dashboard/goals", icon: Target, show: permissions.goals?.view },
          { label: "Gestão de Preços", href: "/dashboard/pricing", icon: DollarSign, show: permissions.pricing.view },
        ],
      },
      {
        key: "dp",
        label: "Pessoal",
        color: SECTION_COLORS.dp,
        items: [
          { label: "Painel DP", href: "/dashboard/dp", icon: LayoutGrid, show: permissions.dp?.view },
          { label: "Organograma", href: "/dashboard/hr/org-chart", icon: Network, show: permissions.dp?.view },
          { label: "Recrutamento", href: "/dashboard/hr/recruitment", icon: Users, show: permissions.dp?.view },
          { label: "Escalas de Trabalho", href: "/dashboard/dp/schedules", icon: CalendarDays, show: permissions.dp?.schedules?.view },
          { label: "Férias da equipe", href: "/dashboard/dp/ferias", icon: Umbrella, show: permissions.dp?.vacation?.viewAll },
        ],
      },
      {
        key: "midia",
        label: "Marketing",
        color: SECTION_COLORS.midia,
        items: [
          { label: "Coala Signage", href: "/signage", icon: MonitorPlay, show: permissions.signage?.view || permissions.signage?.manage },
        ],
      },
      {
        key: "fin",
        label: "Financeiro",
        color: SECTION_COLORS.fin,
        items: [
          { label: "Painel Financeiro", href: "/dashboard/financial", icon: LayoutGrid, show: permissions.financial?.view && permissions.financial?.dashboard },
          { label: "Despesas", href: "/dashboard/financial/expenses", icon: ReceiptText, show: permissions.financial?.expenses?.view },
          { label: "Fluxo de Caixa", href: "/dashboard/financial/cash-flow", icon: Wallet, show: permissions.financial?.cashFlow?.view },
          { label: "Fluxo Financeiro", href: "/dashboard/financial/financial-flow", icon: DollarSign, show: permissions.financial?.financialFlow },
          { label: "DRE", href: "/dashboard/financial/dre", icon: Landmark, show: permissions.financial?.dre },
        ],
      },
      {
        key: "cfg",
        label: "Configurações",
        color: SECTION_COLORS.cfg,
        items: [
          { label: "Configurações", href: "/dashboard/settings", icon: Settings, show: permissions.settings.view },
          { label: "Ajuda", href: "/dashboard/help", icon: HelpCircle, show: permissions.help.view },
        ],
      },
    ];
    return all.map(s => ({ ...s, items: s.items.filter(i => i.show) })).filter(s => s.items.length > 0);
  }, [canAccessPurchasing, pendingTaskCount, permissions]);

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
    const matches = navSections
      .flatMap(section => section.items)
      .filter((item) =>
        item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      )
      .sort((a, b) => b.href.length - a.href.length);

    return matches[0]?.href ?? null;
  }, [navSections, pathname]);

  function isItemActive(item: NavItem) {
    return item.href === activeHref;
  }

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
        className={cn(
          "fixed left-0 top-0 bottom-0 z-50 flex flex-col overflow-hidden border-r transition-all duration-300",
          open
            ? "translate-x-0 pointer-events-auto"
            : "-translate-x-full pointer-events-none lg:translate-x-0 lg:pointer-events-auto"
        )}
        style={{ width: 256, background: "#ffffff" }}
      >
        {/* Logo area */}
        <div className="relative flex-shrink-0 px-4 pt-4 pb-3">
          <img
            src={brand.logo}
            alt={brand.name}
            style={{ height: 130, width: "100%", objectFit: "cover", objectPosition: "center" }}
          />
          <button
            onClick={() => onOpenChange(false)}
            className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mx-4 h-px bg-border" />

        {/* Painel Central — static single item */}
        <div className="flex-shrink-0 px-3 pt-2 pb-1">
          <Link
            href="/dashboard"
            onClick={() => onOpenChange(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg py-2 text-xs font-medium transition-colors",
              pathname === "/dashboard"
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            style={{
              paddingLeft: 12,
              paddingRight: 12,
              borderLeft: pathname === "/dashboard" ? "3px solid #6366f1" : "3px solid transparent",
            }}
          >
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
            <span>Painel Central</span>
          </Link>
        </div>

        {/* Accordion nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-1">
          {navSections.map(section => {
            const isOpen = openSections.has(section.key);
            const hasActive = section.items.some(isItemActive);

            return (
              <div key={section.key} className="mb-1">
                {/* Accordion trigger */}
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors hover:text-foreground"
                  style={{ color: hasActive ? section.color.text : undefined }}
                >
                  <span className="flex-1 text-left">{section.label}</span>
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform duration-200", isOpen && "rotate-180")}
                  />
                </button>

                {/* Sub-items */}
                {isOpen && (
                  <div className="mt-0.5 space-y-px">
                    {section.items.map(item => {
                      const Icon = item.icon;
                      const active = isItemActive(item);
                      const badgeColors = item.badge ? BADGE_COLORS[item.badge.variant] : null;

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => onOpenChange(false)}
                          className="flex items-center gap-2.5 rounded-lg py-2 text-xs font-medium transition-colors hover:bg-muted"
                          style={{
                            paddingLeft: 40,
                            paddingRight: 10,
                            borderLeft: active ? `3px solid ${section.color.border}` : "3px solid transparent",
                            background: active ? section.color.bg : undefined,
                            color: active ? section.color.text : undefined,
                          }}
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {item.badge && item.badge.count > 0 && badgeColors && (
                            <span
                              className="ml-auto rounded-full px-1.5 py-px text-[9px] font-bold"
                              style={{ background: badgeColors.bg, color: badgeColors.color }}
                            >
                              {item.badge.count}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="mx-4 h-px bg-border mb-2" />

        {/* Footer */}
        <div className="flex-shrink-0 px-4 pb-4">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #f43f5e, #14b8a6)" }}
            >
              {userInitial}
            </div>
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
          </div>
        </div>
      </aside>
    </>
  );
}
