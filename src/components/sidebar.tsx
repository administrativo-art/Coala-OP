"use client";

import { useEffect, useState, useMemo } from "react";
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
  ListChecks, DollarSign, ListTodo
} from "lucide-react";

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

  const navItems = useMemo(() => [
    { label: "Dashboard",    href: "/dashboard",                  icon: LayoutDashboard, show: permissions.dashboard.view },
    { label: "Tarefas",      href: "/dashboard/tasks",            icon: ListTodo,        show: permissions.tasks.view, count: legacyTasks.length },
    { label: "Gestão de Estoque", href: "/dashboard/stock",       icon: Package,         show: permissions.stock.view },
    { label: "Custo e Preço",href: "/dashboard/pricing",          icon: DollarSign,      show: permissions.pricing.view },
    { label: "Cadastros",    href: "/dashboard/registration",     icon: ListChecks,      show: permissions.registration.view },
    { label: "Configurações",href: "/dashboard/settings",         icon: Settings,        show: permissions.settings.view },
    { label: "Ajuda",        href: "/dashboard/help",             icon: HelpCircle,      show: permissions.help.view },
  ], [permissions, legacyTasks.length]);

  const visibleNavItems = useMemo(() => navItems.filter(item => item.show), [navItems]);

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
        <div className="relative flex-shrink-0">
          <img
            src={brand.logo}
            alt={brand.name}
            className="w-full rounded-t-2xl p-4"
            style={{ objectFit: "contain", display: "block" }}
          />
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
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleNavItems.map((item) => {
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
