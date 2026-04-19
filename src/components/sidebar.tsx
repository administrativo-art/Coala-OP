"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { brand } from "@/config/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/hooks/use-auth";
import { useAllTasks } from "@/hooks/use-all-tasks";
import {
  X, LayoutDashboard, Package, ClipboardList, BarChart2,
  ShoppingCart, Settings, HelpCircle, LogOut, ShieldAlert,
  ListChecks, DollarSign, ListTodo, Target,
  CalendarDays, Umbrella, LayoutGrid, MonitorPlay, Wallet, ReceiptText, Landmark
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  show: boolean | undefined;
  count?: number;
}

interface GlassSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlassSidebar({ open, onOpenChange }: GlassSidebarProps) {
  const pathname = usePathname();
  const { theme } = useTheme();
  const { user, permissions, logout } = useAuth();
  const { legacyTasks } = useAllTasks();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onOpenChange]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = open ? "hidden" : "";
    }
    return () => { 
      if (typeof document !== 'undefined') {
        document.body.style.overflow = "";
      }
    };
  }, [open]);

  const navSections = useMemo((): { label: string | null; items: NavItem[] }[] => [
    {
      label: null,
      items: [
        { label: "Painel Central", href: "/dashboard", icon: LayoutDashboard, show: permissions.dashboard.view },
      ],
    },
    {
      label: "Operações",
      items: [
        { label: "Painel de Operações", href: "/dashboard/operations", icon: LayoutGrid, show: permissions.dashboard.operational },
        { label: "Tarefas gerais",           href: "/dashboard/tasks", icon: ListTodo, show: permissions.tasks.view, count: legacyTasks.length },
        { label: "Gestão de Estoque", href: "/dashboard/stock", icon: Package,  show: permissions.stock.view },
      ],
    },
    {
      label: "Comercial",
      items: [
        { label: "Painel Comercial",  href: "/dashboard/commercial", icon: LayoutGrid, show: permissions.dashboard.pricing || permissions.dashboard.technicalSheets },
        { label: "Metas de Vendas",   href: "/dashboard/goals",   icon: Target,     show: permissions.goals?.view },
        { label: "Gestão de Preços",  href: "/dashboard/pricing", icon: DollarSign, show: permissions.pricing.view },
      ],
    },
    {
      label: "Financeiro",
      items: [
        { label: "Painel Financeiro", href: "/dashboard/financial", icon: LayoutGrid, show: permissions.financial?.view && permissions.financial?.dashboard },
        { label: "Despesas", href: "/dashboard/financial/expenses", icon: ReceiptText, show: permissions.financial?.expenses?.view },
        { label: "Fluxo de Caixa", href: "/dashboard/financial/cash-flow", icon: Wallet, show: permissions.financial?.cashFlow?.view },
        { label: "Fluxo Financeiro", href: "/dashboard/financial/financial-flow", icon: DollarSign, show: permissions.financial?.financialFlow },
        { label: "DRE", href: "/dashboard/financial/dre", icon: Landmark, show: permissions.financial?.dre },
      ],
    },
    {
      label: "Departamento Pessoal",
      items: [
        { label: "Painel DP",       href: "/dashboard/dp",               icon: LayoutGrid,   show: permissions.dp?.view },
        { label: "Escalas de Trabalho",         href: "/dashboard/dp/schedules",      icon: CalendarDays, show: permissions.dp?.schedules?.view },
        { label: "Férias da equipe",          href: "/dashboard/dp/ferias",         icon: Umbrella,     show: permissions.dp?.vacation?.viewAll },
      ],
    },
    {
      label: "Mídia",
      items: [
        { label: "Coala Signage", href: "/signage", icon: MonitorPlay, show: permissions.signage?.view || permissions.signage?.manage },
      ],
    },
    {
      label: "Configurações",
      items: [
        { label: "Cadastros",         href: "/dashboard/registration", icon: ListChecks, show: permissions.registration.view },
        { label: "Configurações",     href: "/dashboard/settings",     icon: Settings,   show: permissions.settings.view },
      ],
    },
    {
      label: null,
      items: [
        { label: "Ajuda", href: "/dashboard/help", icon: HelpCircle, show: permissions.help.view },
      ],
    },
  ], [permissions, legacyTasks.length]);

  const visibleNavSections = useMemo(
    () =>
      navSections
        .map((section) => ({ ...section, items: section.items.filter((item) => item.show) }))
        .filter((section) => section.items.length > 0),
    [navSections]
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 transition-all duration-300",
          open
            ? "pointer-events-auto bg-black/40 backdrop-blur-sm"
            : "pointer-events-none bg-transparent"
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      {/* Sidebar */}
      <aside
        style={{ background: isDark ? "#0d1526" : "#ffffff" }}
        className={cn(
          "fixed left-3 top-3 bottom-3 z-50 flex w-64 flex-col",
          "rounded-2xl shadow-2xl ring-1",
          isDark ? "ring-white/[0.07]" : "ring-slate-200",
          "transition-all duration-300 ease-in-out",
          open ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0 pointer-events-none"
        )}
      >
        {/* Logo */}
        <div className="relative flex-shrink-0 px-4 pt-4 pb-2">
          <div className="overflow-hidden rounded-xl">
            <img
              src={brand.logo}
              alt={brand.name}
              className="block h-28 w-full object-cover object-center"
            />
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className={cn(
              "absolute right-2 top-2 rounded-full p-1.5 transition-colors",
              isDark
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            )}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={cn("mx-4 h-px", isDark ? "bg-white/10" : "bg-slate-200")} />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {visibleNavSections.map((section, sectionIndex) => (
            <div key={sectionIndex} className="space-y-0.5">
              {section.label && (
                <p className={cn(
                  "px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider",
                  isDark ? "text-slate-500" : "text-slate-400"
                )}>
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 relative",
                      isActive
                        ? isDark
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "bg-indigo-50 text-indigo-700"
                        : isDark
                        ? "text-slate-300 hover:bg-white/5 hover:text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? isDark ? "text-indigo-400" : "text-indigo-600" : "")} />
                    <span className="flex-1">{item.label}</span>
                    {item.count !== undefined && item.count > 0 && (
                      <span className={cn(
                        "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] px-1.5",
                        isActive ? "bg-indigo-600 text-white" : "bg-primary text-white"
                      )}>
                        {item.count}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={cn("mx-4 h-px mb-2", isDark ? "bg-white/10" : "bg-slate-200")} />

        {/* Footer */}
        <div className="flex items-center justify-between px-4 pb-4">
          <span className={cn("text-[10px] font-mono", isDark ? "text-slate-500" : "text-slate-400")}>
            {brand.version}
          </span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={logout}
              className={cn(
                "rounded-full p-1.5 transition-colors",
                isDark
                  ? "text-slate-400 hover:bg-white/10 hover:text-white"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              )}
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
