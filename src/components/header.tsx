"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserProfile } from "./user-profile";
import { type LegacyTask, NotificationCenter } from "./notification-center";
import { GlobalBarcodeScanner } from "./global-barcode-scanner";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { cn } from "@/lib/utils";

// ── Route label map (mirrors sidebar) ────────────────────────────────────────

const SECTION_MAP: Record<string, string> = {
  "/dashboard/operations": "Operações",
  "/dashboard/tasks": "Operações",
  "/dashboard/forms": "Operações",
  "/dashboard/stock": "Estoque",
  "/dashboard/expiry": "Estoque",
  "/dashboard/commercial": "Comercial",
  "/dashboard/goals": "Comercial",
  "/dashboard/pricing": "Comercial",
  "/dashboard/financial": "Financeiro",
  "/dashboard/financial/expenses": "Financeiro",
  "/dashboard/financial/inbox": "Financeiro",
  "/dashboard/financial/cash-flow": "Financeiro",
  "/dashboard/financial/financial-flow": "Financeiro",
  "/dashboard/financial/payment-requests": "Financeiro",
  "/dashboard/financial/dre": "Financeiro",
  "/dashboard/financial/settings": "Financeiro",
  "/dashboard/dp": "Departamento pessoal",
  "/dashboard/processes": "Gestão",
  "/dashboard/resignation": "Departamento pessoal",
  "/dashboard/dp/terminations": "Gestão do colaborador",
  "/dashboard/hr/recruitment": "Departamento pessoal",
  "/dashboard/hr/recruitment/talents": "Departamento pessoal",
  "/dashboard/hr/recruitment/integration": "Gestão do colaborador",
  "/dashboard/dp/collaborators": "Gestão do colaborador",
  "/dashboard/dp/schedules": "Gestão do colaborador",
  "/dashboard/dp/ferias": "Gestão do colaborador",
  "/dashboard/stock/uniforms": "Gestão do colaborador",
  "/dashboard/dp/settings": "Departamento pessoal",
  "/dashboard/documents": "Documentos",
  "/dashboard/documents/management": "Documentos",
  "/dashboard/dp/documents": "Documentos",
  "/dashboard/purchasing": "Compras",
  "/dashboard/registration": "Configurações",
  "/dashboard/settings": "Configurações",
  "/dashboard/help": "Ajuda",
};

const LABEL_MAP: Record<string, string> = {
  "/dashboard": "Painel da gestão",
  "/dashboard/operations": "Painel de operações",
  "/dashboard/tasks": "Tarefas gerais",
  "/dashboard/forms": "Formulários",
  "/dashboard/stock": "Gestão de estoque",
  "/dashboard/expiry": "Validades",
  "/dashboard/stock/restock": "Reposição",
  "/dashboard/stock/movement": "Histórico de movimentos",
  "/dashboard/stock/audit": "Auditoria",
  "/dashboard/stock/analysis": "Análise de consumo",
  "/dashboard/stock/purchasing": "Compras (legado)",
  "/dashboard/purchasing": "Compras",
  "/dashboard/purchasing/quotations": "Cotações",
  "/dashboard/purchasing/orders": "Pedidos de compra",
  "/dashboard/purchasing/receipts": "Recebimentos",
  "/dashboard/purchasing/financial": "Despesas de compras",
  "/dashboard/purchasing/costs": "Histórico de custo efetivo",
  "/dashboard/commercial": "Ficha técnica",
  "/dashboard/goals": "Metas de vendas",
  "/dashboard/pricing": "Gestão de preços",
  "/dashboard/financial": "Painel financeiro",
  "/dashboard/financial/expenses": "Despesas",
  "/dashboard/financial/inbox": "Caixa de cobranças",
  "/dashboard/financial/expenses/new": "Nova despesa",
  "/dashboard/financial/expenses/import": "Importar extrato",
  "/dashboard/financial/cash-flow": "Fluxo de caixa",
  "/dashboard/financial/financial-flow": "Fluxo de caixa",
  "/dashboard/financial/payment-requests": "Autorizações bancárias",
  "/dashboard/financial/dre": "DRE",
  "/dashboard/financial/settings": "Configurações financeiras",
  "/dashboard/dp": "Painel DP",
  "/dashboard/processes": "Acompanhamento de processos",
  "/dashboard/resignation": "Pedir demissão",
  "/dashboard/dp/terminations": "Desligamentos CLT",
  "/dashboard/dp/schedules": "Escalas de trabalho",
  "/dashboard/dp/ferias": "Férias da equipe",
  "/dashboard/stock/uniforms": "Uniformes",
  "/dashboard/dp/settings": "Configurações do DP",
  "/dashboard/dp/settings/collaborators": "Colaboradores",
  "/dashboard/dp/settings/roles": "Cargos e funções",
  "/dashboard/dp/settings/organogram": "Organograma",
  "/dashboard/dp/settings/login-access": "Acesso por escala",
  "/dashboard/dp/settings/profile-compliance": "Atualização cadastral",
  "/dashboard/dp/settings/units": "Unidades do DP",
  "/dashboard/dp/settings/shifts": "Turnos do DP",
  "/dashboard/dp/settings/calendars": "Calendários do DP",
  "/dashboard/documents": "Visão geral",
  "/dashboard/documents/management": "Gestão de documentos",
  "/dashboard/documents/generator": "Gerador de documentos",
  "/dashboard/documents/company": "Documentos da empresa",
  "/dashboard/documents/generated": "Central de documentos",
  "/dashboard/documents/templates": "Modelos",
  "/dashboard/documents/collaborators": "Documentos dos colaboradores",
  "/dashboard/dp/documents": "Documentos dos colaboradores",
  "/dashboard/hr/recruitment": "Gestão da vaga",
  "/dashboard/hr/recruitment/talents": "Banco de talentos",
  "/dashboard/hr/recruitment/integration": "Integração",
  "/dashboard/registration": "Cadastros",
  "/dashboard/settings": "Configurações",
  "/dashboard/help": "Ajuda",
  "/dashboard/signage": "Coala Signage",
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

function StatusBar({ tasks }: { tasks: LegacyTask[] }) {
  const { lots } = useExpiryProducts();
  const [clock, setClock] = useState("");

  const now = Date.now();
  const in48h = now + 48 * 60 * 60 * 1000;
  const expiringLots = lots
    .filter((l) => {
    if (!l.expiryDate || (l.quantity ?? 0) <= 0) return false;
    const d = new Date(l.expiryDate).getTime();
    return d >= now && d <= in48h;
    })
    .sort((a, b) => new Date(a.expiryDate ?? 0).getTime() - new Date(b.expiryDate ?? 0).getTime());
  const expiringCount = expiringLots.length;
  const taskCount = tasks.length;

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

  if (expiringCount === 0 && taskCount === 0 && !clock) return null;

  return (
    <div className="flex h-[30px] items-center overflow-hidden border-t border-border/50 bg-muted/30 px-4 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-0">
        {expiringCount > 0 ? (
          <div
            className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"
            style={{
              paddingRight: 14,
              marginRight: 14,
              borderRight: taskCount > 0 ? "1px solid var(--border)" : undefined,
            }}
          >
            <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
            <strong className="font-semibold text-foreground">{expiringCount} {expiringCount === 1 ? "validade" : "validades"}</strong>
            {" "}{expiringCount === 1 ? "vence" : "vencem"} em 48h
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="ml-1 font-semibold text-primary hover:underline">
                  Ver →
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] p-0">
                <div className="border-b p-3">
                  <p className="text-sm font-semibold text-foreground">Validades próximas</p>
                  <p className="text-xs text-muted-foreground">Lotes com estoque e vencimento nas próximas 48h.</p>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {expiringLots.slice(0, 6).map((lot) => (
                    <div key={lot.id} className="rounded-lg px-2 py-2 text-xs hover:bg-muted/60">
                      <p className="truncate font-medium text-foreground">{lot.productName}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {lot.kioskId || "Sem unidade"} · {lot.quantity} un · vence em{" "}
                        {lot.expiryDate ? new Date(lot.expiryDate).toLocaleDateString("pt-BR") : "—"}
                      </p>
                    </div>
                  ))}
                  {expiringCount > 6 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">+{expiringCount - 6} validade(s) na página completa.</p>
                  ) : null}
                </div>
                <div className="border-t p-2">
                  <Button asChild size="sm" className="h-8 w-full rounded-lg text-xs">
                    <Link href="/dashboard/expiry">Abrir controle de validades</Link>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
        {taskCount > 0 ? (
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
            <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
            <strong className="font-semibold text-foreground">{taskCount} {taskCount === 1 ? "tarefa" : "tarefas"}</strong>
            {" "}pendente{taskCount !== 1 && "s"}
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="ml-1 font-semibold text-primary hover:underline">
                  Ver →
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] p-0">
                <div className="border-b p-3">
                  <p className="text-sm font-semibold text-foreground">Tarefas pendentes</p>
                  <p className="text-xs text-muted-foreground">Resumo das pendências operacionais atribuídas.</p>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {tasks.slice(0, 6).map((task) => (
                    <Link
                      key={task.id}
                      href={task.link || "/dashboard/tasks"}
                      className="block rounded-lg px-2 py-2 text-xs hover:bg-muted/60"
                    >
                      <p className="truncate font-medium text-foreground">{task.title}</p>
                      <p className="mt-0.5 truncate text-muted-foreground">{task.type} · {task.description}</p>
                    </Link>
                  ))}
                  {taskCount > 6 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground">+{taskCount - 6} tarefa(s) na página completa.</p>
                  ) : null}
                </div>
                <div className="border-t p-2">
                  <Button asChild size="sm" className="h-8 w-full rounded-lg text-xs">
                    <Link href="/dashboard/tasks">Abrir central de tarefas</Link>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>
      {clock && (
        <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/70">{clock}</span>
      )}
    </div>
  );
}

// ── Search items (all navigable pages) ───────────────────────────────────────

const SEARCH_ITEMS: { label: string; href: string; section: string }[] = [
  { label: "Painel da gestão", href: "/dashboard", section: "Início" },
  { label: "Painel de operações", href: "/dashboard/operations", section: "Departamento operacional" },
  { label: "Tarefas gerais", href: "/dashboard/tasks", section: "Departamento operacional" },
  { label: "Formulários", href: "/dashboard/forms", section: "Departamento operacional" },
  { label: "Gestão de estoque", href: "/dashboard/stock", section: "Departamento operacional" },
  { label: "Validades", href: "/dashboard/expiry", section: "Departamento operacional" },
  { label: "Reposição", href: "/dashboard/stock/restock", section: "Departamento operacional" },
  { label: "Histórico de movimentos", href: "/dashboard/stock/movement", section: "Departamento operacional" },
  { label: "Auditoria de estoque", href: "/dashboard/stock/audit", section: "Departamento operacional" },
  { label: "Análise de consumo", href: "/dashboard/stock/analysis", section: "Departamento operacional" },
  { label: "Compras", href: "/dashboard/purchasing", section: "Departamento operacional" },
  { label: "Cotações", href: "/dashboard/purchasing/quotations", section: "Departamento operacional" },
  { label: "Pedidos de compra", href: "/dashboard/purchasing/orders", section: "Departamento operacional" },
  { label: "Recebimentos", href: "/dashboard/purchasing/receipts", section: "Departamento operacional" },
  { label: "Despesas de compras", href: "/dashboard/financial/expenses?origin=purchasing&status=pending_audit", section: "Departamento financeiro" },
  { label: "Histórico de custo efetivo", href: "/dashboard/purchasing/costs", section: "Departamento operacional" },
  { label: "Ficha técnica", href: "/dashboard/commercial", section: "Departamento comercial" },
  { label: "Metas de vendas", href: "/dashboard/goals", section: "Departamento comercial" },
  { label: "Gestão de preços", href: "/dashboard/pricing", section: "Departamento comercial" },
  { label: "Painel DP", href: "/dashboard/dp", section: "Departamento pessoal" },
  { label: "Acompanhamento de processos", href: "/dashboard/processes", section: "Gestão" },
  { label: "Integração", href: "/dashboard/hr/recruitment/integration", section: "Gestão do colaborador" },
  { label: "Escalas de trabalho", href: "/dashboard/dp/schedules", section: "Gestão do colaborador" },
  { label: "Férias da equipe", href: "/dashboard/dp/ferias", section: "Gestão do colaborador" },
  { label: "Uniformes", href: "/dashboard/stock/uniforms", section: "Gestão do colaborador" },
  { label: "Desligamentos CLT", href: "/dashboard/dp/terminations", section: "Gestão do colaborador" },
  { label: "Configurações do DP", href: "/dashboard/settings?department=pessoal&tab=roles", section: "Departamento pessoal" },
  { label: "Colaboradores", href: "/dashboard/dp/collaborators", section: "Gestão do colaborador" },
  { label: "Cargos e funções", href: "/dashboard/settings?department=pessoal&tab=roles", section: "Departamento pessoal" },
  { label: "Organograma", href: "/dashboard/settings?department=pessoal&tab=organogram", section: "Departamento pessoal" },
  { label: "Acesso por escala", href: "/dashboard/settings?department=pessoal&tab=login-access", section: "Departamento pessoal" },
  { label: "Atualização cadastral", href: "/dashboard/settings?department=pessoal&tab=profile-compliance", section: "Departamento pessoal" },
  { label: "Campos do perfil", href: "/dashboard/settings?department=pessoal&tab=profile-fields", section: "Departamento pessoal" },
  { label: "Modelos do recrutamento", href: "/dashboard/settings?department=pessoal&tab=recruitment", section: "Departamento pessoal" },
  { label: "Turnos do DP", href: "/dashboard/settings?department=pessoal&tab=shifts", section: "Departamento pessoal" },
  { label: "Calendários do DP", href: "/dashboard/settings?department=pessoal&tab=calendars", section: "Departamento pessoal" },
  { label: "Coala Signage", href: "/dashboard/signage", section: "Departamento de marketing" },
  { label: "Painel financeiro", href: "/dashboard/financial", section: "Departamento financeiro" },
  { label: "Despesas", href: "/dashboard/financial/expenses", section: "Departamento financeiro" },
  { label: "Caixa de cobranças", href: "/dashboard/financial/inbox", section: "Departamento financeiro" },
  { label: "Nova despesa", href: "/dashboard/financial/expenses/new", section: "Departamento financeiro" },
  { label: "Fluxo de caixa", href: "/dashboard/financial/cash-flow", section: "Departamento financeiro" },
  { label: "Autorizações bancárias", href: "/dashboard/financial/payment-requests", section: "Departamento financeiro" },
  { label: "DRE", href: "/dashboard/financial/dre", section: "Departamento financeiro" },
  { label: "Cadastros", href: "/dashboard/settings?department=operacional&tab=cadastros", section: "Configurações" },
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
          <NotificationCenter
            tasks={tasks}
          />
          <UserProfile />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar tasks={tasks} />
    </header>
  );
}
