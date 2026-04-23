"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserProfile } from "./user-profile";
import { type LegacyTask, NotificationCenter } from "./notification-center";
import { GlobalBarcodeScanner } from "./global-barcode-scanner";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { cn } from "@/lib/utils";

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
  "/dashboard/dp/checklists": "Departamento Pessoal",
  "/dashboard/dp/ferias": "Departamento Pessoal",
  "/dashboard/dp/settings": "Departamento Pessoal",
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
  "/dashboard/dp/checklists": "Checklists Operacionais",
  "/dashboard/dp/ferias": "Férias da Equipe",
  "/dashboard/dp/settings": "Configurações do DP",
  "/dashboard/dp/settings/collaborators": "Colaboradores",
  "/dashboard/dp/settings/roles": "Cargos & Funções",
  "/dashboard/dp/settings/organogram": "Organograma",
  "/dashboard/dp/settings/login-access": "Acesso por Escala",
  "/dashboard/dp/settings/units": "Unidades do DP",
  "/dashboard/dp/settings/shifts": "Turnos do DP",
  "/dashboard/dp/settings/calendars": "Calendários do DP",
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
    if (!l.expiryDate || (l.quantity ?? 0) <= 0) return false;
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

// ── Search items (all navigable pages) ───────────────────────────────────────

const SEARCH_ITEMS: { label: string; href: string; section: string }[] = [
  { label: "Painel Central", href: "/dashboard", section: "Início" },
  { label: "Painel de Operações", href: "/dashboard/operations", section: "Departamento Operacional" },
  { label: "Tarefas gerais", href: "/dashboard/tasks", section: "Departamento Operacional" },
  { label: "Gestão de Estoque", href: "/dashboard/stock", section: "Departamento Operacional" },
  { label: "Validades", href: "/dashboard/stock/expiry", section: "Departamento Operacional" },
  { label: "Reposição", href: "/dashboard/stock/restock", section: "Departamento Operacional" },
  { label: "Histórico de Movimentos", href: "/dashboard/stock/movement", section: "Departamento Operacional" },
  { label: "Auditoria de Estoque", href: "/dashboard/stock/audit", section: "Departamento Operacional" },
  { label: "Análise de Consumo", href: "/dashboard/stock/analysis", section: "Departamento Operacional" },
  { label: "Compras", href: "/dashboard/stock/purchasing", section: "Departamento Operacional" },
  { label: "Painel Comercial", href: "/dashboard/commercial", section: "Departamento Comercial" },
  { label: "Metas de Vendas", href: "/dashboard/goals", section: "Departamento Comercial" },
  { label: "Gestão de Preços", href: "/dashboard/pricing", section: "Departamento Comercial" },
  { label: "Painel DP", href: "/dashboard/dp", section: "Departamento Pessoal" },
  { label: "Escalas de Trabalho", href: "/dashboard/dp/schedules", section: "Departamento Pessoal" },
  { label: "Checklists Operacionais", href: "/dashboard/dp/checklists", section: "Departamento Pessoal" },
  { label: "Férias da equipe", href: "/dashboard/dp/ferias", section: "Departamento Pessoal" },
  { label: "Configurações do DP", href: "/dashboard/dp/settings", section: "Departamento Pessoal" },
  { label: "Colaboradores", href: "/dashboard/dp/settings/collaborators", section: "Departamento Pessoal" },
  { label: "Cargos & Funções", href: "/dashboard/dp/settings/roles", section: "Departamento Pessoal" },
  { label: "Organograma", href: "/dashboard/dp/settings/organogram", section: "Departamento Pessoal" },
  { label: "Acesso por Escala", href: "/dashboard/dp/settings/login-access", section: "Departamento Pessoal" },
  { label: "Unidades do DP", href: "/dashboard/dp/settings/units", section: "Departamento Pessoal" },
  { label: "Turnos do DP", href: "/dashboard/dp/settings/shifts", section: "Departamento Pessoal" },
  { label: "Calendários do DP", href: "/dashboard/dp/settings/calendars", section: "Departamento Pessoal" },
  { label: "Coala Signage", href: "/signage", section: "Departamento de Marketing" },
  { label: "Painel Financeiro", href: "/dashboard/financial", section: "Departamento Financeiro" },
  { label: "Despesas", href: "/dashboard/financial/expenses", section: "Departamento Financeiro" },
  { label: "Nova Despesa", href: "/dashboard/financial/expenses/new", section: "Departamento Financeiro" },
  { label: "Fluxo de Caixa", href: "/dashboard/financial/cash-flow", section: "Departamento Financeiro" },
  { label: "Fluxo Financeiro", href: "/dashboard/financial/financial-flow", section: "Departamento Financeiro" },
  { label: "DRE", href: "/dashboard/financial/dre", section: "Departamento Financeiro" },
  { label: "Cadastros", href: "/dashboard/registration", section: "Configurações" },
  { label: "Configurações", href: "/dashboard/settings", section: "Configurações" },
  { label: "Ajuda", href: "/dashboard/help", section: "Configurações" },
];

// ── Search bar ────────────────────────────────────────────────────────────────

function HeaderSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const results = query.trim()
    ? SEARCH_ITEMS.filter(item =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.section.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  const navigate = useCallback((href: string) => {
    router.push(href);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }, [router]);

  // ⌘K global shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      if (results[cursor]) navigate(results[cursor].href);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="relative ml-4 hidden max-w-[260px] flex-1 lg:flex">
      <label className={cn(
        "flex h-8 w-full cursor-text items-center gap-2 rounded-lg border bg-muted/50 px-3 text-xs text-muted-foreground transition-colors",
        open ? "border-primary ring-2 ring-primary/20" : "border-border"
      )}>
        <Search className="h-3 w-3 flex-shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder="Buscar…"
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {!open && (
          <kbd className="rounded bg-border px-1 py-px font-mono text-[9px] text-muted-foreground">
            ⌘K
          </kbd>
        )}
      </label>

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border bg-background shadow-xl">
          {results.map((item, i) => (
            <button
              key={item.href}
              type="button"
              onPointerDown={e => { e.preventDefault(); navigate(item.href); }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                i === cursor ? "bg-muted" : "hover:bg-muted/60"
              )}
            >
              <ArrowRight className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{item.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{item.section}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.trim() && results.length === 0 && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border bg-background shadow-xl">
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nenhuma página encontrada.</p>
        </div>
      )}
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
