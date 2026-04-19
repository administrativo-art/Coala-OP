"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserProfile } from "./user-profile";
import { type LegacyTask, NotificationCenter } from "./notification-center";
import { GlobalBarcodeScanner } from "./global-barcode-scanner";
import { useExpiryProducts } from "@/hooks/use-expiry-products";

// ── Route label map (mirrors sidebar) ────────────────────────────────────────

const SECTION_MAP: Record<string, string> = {
  "/dashboard/operations": "Operações",
  "/dashboard/tasks": "Operações",
  "/dashboard/stock": "Estoque",
  "/dashboard/commercial": "Comercial",
  "/dashboard/goals": "Comercial",
  "/dashboard/pricing": "Comercial",
  "/dashboard/financial": "Financeiro",
  "/dashboard/financial/expenses": "Financeiro",
  "/dashboard/financial/cash-flow": "Financeiro",
  "/dashboard/financial/financial-flow": "Financeiro",
  "/dashboard/financial/dre": "Financeiro",
  "/dashboard/financial/settings": "Financeiro",
  "/dashboard/dp": "Departamento Pessoal",
  "/dashboard/dp/schedules": "Departamento Pessoal",
  "/dashboard/dp/ferias": "Departamento Pessoal",
  "/dashboard/registration": "Cadastros",
  "/dashboard/settings": "Configurações",
  "/dashboard/help": "Ajuda",
};

const LABEL_MAP: Record<string, string> = {
  "/dashboard": "Painel Central",
  "/dashboard/operations": "Painel de Operações",
  "/dashboard/tasks": "Tarefas Gerais",
  "/dashboard/stock": "Gestão de Estoque",
  "/dashboard/stock/expiry": "Validades",
  "/dashboard/stock/restock": "Reposição",
  "/dashboard/stock/movement": "Histórico de Movimentos",
  "/dashboard/stock/audit": "Auditoria",
  "/dashboard/stock/analysis": "Análise de Consumo",
  "/dashboard/stock/purchasing": "Compras",
  "/dashboard/commercial": "Painel Comercial",
  "/dashboard/goals": "Metas de Vendas",
  "/dashboard/pricing": "Gestão de Preços",
  "/dashboard/financial": "Painel Financeiro",
  "/dashboard/financial/expenses": "Despesas",
  "/dashboard/financial/expenses/new": "Nova Despesa",
  "/dashboard/financial/expenses/import": "Importar Extrato",
  "/dashboard/financial/cash-flow": "Fluxo de Caixa",
  "/dashboard/financial/financial-flow": "Fluxo Financeiro",
  "/dashboard/financial/dre": "DRE",
  "/dashboard/financial/settings": "Configurações Financeiras",
  "/dashboard/dp": "Painel DP",
  "/dashboard/dp/schedules": "Escalas de Trabalho",
  "/dashboard/dp/ferias": "Férias da Equipe",
  "/dashboard/registration": "Cadastros",
  "/dashboard/settings": "Configurações",
  "/dashboard/help": "Ajuda",
  "/signage": "Coala Signage",
};

function getBreadcrumb(pathname: string): { section: string | null; current: string } {
  // Exact match first
  if (LABEL_MAP[pathname]) {
    return { section: SECTION_MAP[pathname] ?? null, current: LABEL_MAP[pathname] };
  }
  // Longest prefix match
  const sorted = Object.keys(LABEL_MAP).sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (pathname.startsWith(key + "/") || pathname === key) {
      return { section: SECTION_MAP[key] ?? null, current: LABEL_MAP[key] };
    }
  }
  return { section: null, current: "Dashboard" };
}

// ── Status bar ────────────────────────────────────────────────────────────────

function StatusBar({ taskCount }: { taskCount: number }) {
  const { lots } = useExpiryProducts();
  const [clock, setClock] = useState("");

  const now = Date.now();
  const in48h = now + 48 * 60 * 60 * 1000;
  const expiringCount = lots.filter((l) => {
    if (!l.expiryDate) return false;
    const d = new Date(l.expiryDate).getTime();
    return d >= now && d <= in48h;
  }).length;

  useEffect(() => {
    function tick() {
      const d = new Date();
      const date = d.toLocaleDateString("pt-BR");
      const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      setClock(`${date} · ${time}`);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  const pills = [
    expiringCount > 0 && {
      color: "#ef4444",
      label: (
        <>
          <strong className="font-semibold text-foreground">{expiringCount} {expiringCount === 1 ? "validade" : "validades"}</strong>
          {" "}{expiringCount === 1 ? "vence" : "vencem"} em 48h
        </>
      ),
      href: "/dashboard/stock/expiry",
    },
    taskCount > 0 && {
      color: "#f59e0b",
      label: (
        <>
          <strong className="font-semibold text-foreground">{taskCount} {taskCount === 1 ? "tarefa" : "tarefas"}</strong>
          {" "}pendente{taskCount !== 1 && "s"}
        </>
      ),
      href: "/dashboard/tasks",
    },
  ].filter(Boolean) as { color: string; label: React.ReactNode; href: string }[];

  if (pills.length === 0 && !clock) return null;

  return (
    <div className="flex h-[30px] items-center overflow-hidden border-t border-border/50 bg-muted/30 px-4 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-0">
        {pills.map((pill, i) => (
          <div
            key={i}
            className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"
            style={{
              paddingRight: 14,
              marginRight: 14,
              borderRight: i < pills.length - 1 ? "1px solid var(--border)" : undefined,
            }}
          >
            <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: pill.color }} />
            {pill.label}
            <a href={pill.href} className="ml-1 font-semibold text-primary hover:underline">
              Ver →
            </a>
          </div>
        ))}
      </div>
      {clock && (
        <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/70">{clock}</span>
      )}
    </div>
  );
}

// ── Search bar ────────────────────────────────────────────────────────────────

function HeaderSearch() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="ml-4 hidden max-w-[260px] flex-1 lg:flex">
      <label className="flex h-8 w-full cursor-text items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 text-xs text-muted-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Search className="h-3 w-3 flex-shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder="Buscar…"
        />
        <kbd className="hidden rounded bg-border px-1 py-px font-mono text-[9px] text-muted-foreground sm:block">
          ⌘K
        </kbd>
      </label>
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

interface HeaderProps {
  onMenuClick: () => void;
  tasks: LegacyTask[];
}

export function Header({ onMenuClick, tasks }: HeaderProps) {
  const pathname = usePathname();
  const { section, current } = getBreadcrumb(pathname ?? "");

  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-sm">
      {/* Main bar */}
      <div className="flex h-14 items-center gap-3 px-4 lg:h-[56px] lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0 lg:hidden"
          onClick={onMenuClick}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Divider (only between menu btn and breadcrumb on mobile) */}
        <div className="hidden h-5 w-px bg-border" />

        {/* Breadcrumb */}
        <nav className="hidden items-center gap-1.5 text-sm lg:flex">
          {section && (
            <>
              <span className="text-muted-foreground">{section}</span>
              <span className="text-muted-foreground/40">/</span>
            </>
          )}
          <span className="font-semibold text-foreground">{current}</span>
        </nav>

        {/* Search */}
        <HeaderSearch />

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          <GlobalBarcodeScanner />
          <NotificationCenter tasks={tasks} />
          <UserProfile />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar taskCount={tasks.length} />
    </header>
  );
}
