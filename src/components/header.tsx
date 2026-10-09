"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type LegacyTask, NotificationCenter } from "./notification-center";
import { useExpiryProducts } from "@/hooks/use-expiry-products";
import { cn } from "@/lib/utils";
import { useNavTrail } from "@/components/navigation/nav-trail";

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
  "/dashboard/financial/reconciliation/bank-statements": "Financeiro",
  "/dashboard/financial/reconciliation/card-statements": "Financeiro",
  "/dashboard/financial/cash-closures": "Financeiro",
  "/dashboard/financial/cash-deposits": "Financeiro",
  "/dashboard/financial/cash-flow": "Financeiro",
  "/dashboard/financial/stone-anticipations": "Financeiro",
  "/dashboard/financial/stone-receipts": "Financeiro",
  "/dashboard/financial/sales-reconciliation": "Financeiro",
  "/dashboard/financial/financial-flow": "Financeiro",
  "/dashboard/financial/expenses/authorizations": "Financeiro",
  "/dashboard/financial/expenses/inbox": "Financeiro",
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
  "/dashboard/financial/expenses/new": "Nova despesa",
  "/dashboard/financial/expenses/import": "Importar extrato",
  "/dashboard/financial/reconciliation/bank-statements": "Extratos bancários",
  "/dashboard/financial/reconciliation/card-statements": "Faturas de cartão de crédito",
  "/dashboard/financial/cash-closures": "Fechamento de caixa",
  "/dashboard/financial/cash-deposits": "Depósitos",
  "/dashboard/financial/cash-flow": "Fluxo de caixa",
  "/dashboard/financial/stone-anticipations": "Antecipações Stone",
  "/dashboard/financial/stone-receipts": "Conciliação de recebimentos",
  "/dashboard/financial/sales-reconciliation": "Conciliação de vendas",
  "/dashboard/financial/financial-flow": "Fluxo de caixa",
  "/dashboard/financial/expenses/authorizations": "Autorizações bancárias",
  "/dashboard/financial/expenses/inbox": "Caixa de cobranças",
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

// ── Pendências (só aparecem quando existem) e relógio ─────────────────────────

function PendingChips({ tasks }: { tasks: LegacyTask[] }) {
  const { lots } = useExpiryProducts();

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

  if (expiringCount === 0 && taskCount === 0) return null;

  const chip = "inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full bg-white/[0.07] px-3 text-[12px] font-semibold text-ds-on-dark-2 ring-1 ring-inset ring-white/10";
  const see = "ml-0.5 font-extrabold text-ds-accent-kicker hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker";

  return (
    <div className="flex items-center gap-2" aria-label="Pendências">
      {expiringCount > 0 ? (
        <div className={chip}>
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ds-danger" />
          <strong className="font-extrabold text-white">{expiringCount} {expiringCount === 1 ? "validade" : "validades"}</strong>
          <span className="hidden xl:inline">{expiringCount === 1 ? "vence" : "vencem"} em 48h</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={see}>Ver →</button>
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
        <div className={chip}>
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-ds-warn" />
          <strong className="font-extrabold text-white">{taskCount} {taskCount === 1 ? "tarefa" : "tarefas"}</strong>
          <span className="hidden xl:inline">pendente{taskCount !== 1 && "s"}</span>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={see}>Ver →</button>
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
  );
}

function Clock() {
  const [clock, setClock] = useState("");
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
  if (!clock) return null;
  return <span className="hidden whitespace-nowrap font-ds-mono text-[11px] text-ds-on-dark-muted xl:inline">{clock}</span>;
}

// ── Search items (all navigable pages) ───────────────────────────────────────

const SEARCH_ITEMS: { label: string; href: string; section: string }[] = [
  { label: "Painel da gestão", href: "/dashboard", section: "Início" },
  { label: "Painel de operações", href: "/dashboard/operations", section: "Departamento operacional" },
  { label: "Tarefas gerais", href: "/dashboard/tasks", section: "Departamento operacional" },
  { label: "Formulários", href: "/dashboard/forms", section: "Departamento operacional" },
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
  { label: "Nova despesa", href: "/dashboard/financial/expenses/new", section: "Departamento financeiro" },
  { label: "Fluxo de caixa", href: "/dashboard/financial/cash-flow", section: "Departamento financeiro" },
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
    <div ref={containerRef} className="relative ml-2 hidden max-w-[360px] flex-1 lg:flex">
      <label className={cn(
        "flex h-8 w-full cursor-text items-center gap-2 rounded-full border bg-white/[0.07] px-3.5 text-xs text-ds-on-dark-muted transition-[border-color,box-shadow,background] duration-200",
        open ? "border-ds-accent-kicker bg-white/10 ring-2 ring-ds-accent-kicker/30" : "border-white/10 hover:bg-white/10"
      )}>
        <Search className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-ds-on-dark-muted"
          placeholder="Buscar…"
          value={query}
          onChange={e => { setQuery(e.target.value); setCursor(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
        {!open && (
          <kbd className="rounded-md border border-white/15 px-1.5 py-px font-ds-mono text-[10px] text-ds-on-dark-muted">
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
  /** Margem lateral igual à do conteúdo da página, para a barra e a tela terem as mesmas bordas. */
  gutterClassName?: string;
}

export function Header({ onMenuClick, tasks, gutterClassName = "mx-4 md:mx-8" }: HeaderProps) {
  const pathname = usePathname();
  const { trail } = useNavTrail();
  const fallback = getBreadcrumb(pathname ?? "");
  const crumbs = trail.length > 0 ? trail : [fallback.section, fallback.current].filter((item): item is string => Boolean(item));
  const parents = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1] ?? fallback.current;

  return (
    <header className={cn("sticky top-3 z-30 mt-3", gutterClassName)}>
      {/* Barra fina e flutuante, no mesmo desenho da barra lateral */}
      <div className="flex h-11 items-center gap-3 rounded-ds-card-lg bg-ds-dark px-3 text-ds-on-dark shadow-ds-panel ring-1 ring-white/10 lg:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0 text-ds-on-dark-2 hover:bg-white/10 hover:text-white lg:hidden"
          onClick={onMenuClick}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Caminho da tela, gerado a partir do menu lateral */}
        <nav aria-label="Caminho" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {parents.map((label) => (
            <span key={label} className="hidden items-center gap-1.5 lg:flex">
              <span className="whitespace-nowrap text-ds-on-dark-muted">{label}</span>
              <span aria-hidden="true" className="text-ds-on-dark-muted/60">›</span>
            </span>
          ))}
          <span className="truncate font-extrabold text-white">{current}</span>
        </nav>

        <HeaderSearch />

        <div className="flex-1" />

        <PendingChips tasks={tasks} />
        <Clock />
        <NotificationCenter tasks={tasks} tone="dark" />
      </div>
    </header>
  );
}
