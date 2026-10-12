"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookImage,
  CalendarDays,
  ChevronDown,
  Grid3X3,
  Hash,
  Inbox,
  Lightbulb,
  Link2,
  LogOut,
  Megaphone,
  MessageSquare,
  Settings2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { SystemBrand } from "@/components/patterns/system-brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import type { InstagramInsightsSection } from "./contracts";

export type InstagramWorkspaceView = "posts" | "calendar" | "feed" | "media" | "bio" | "reports";

type NavItem = {
  label: string;
  view?: InstagramWorkspaceView;
  section?: InstagramInsightsSection;
  icon: LucideIcon;
  requiresBioAccess?: boolean;
};

const groups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Planejar",
    items: [
      { label: "Calendário", view: "calendar", icon: CalendarDays },
      { label: "Grade do feed", view: "feed", icon: Grid3X3 },
      { label: "Ideias", icon: Lightbulb },
      { label: "Campanhas", icon: Megaphone },
    ],
  },
  {
    title: "Criar",
    items: [
      { label: "Posts e aprovações", view: "posts", icon: MessageSquare },
      { label: "Biblioteca de mídia", view: "media", icon: BookImage },
      { label: "Legendas e hashtags", icon: Hash },
    ],
  },
  {
    title: "Relacionar",
    items: [
      { label: "Caixa de entrada", icon: Inbox },
      { label: "Link na bio", view: "bio", icon: Link2, requiresBioAccess: true },
      { label: "Concorrentes", icon: Users },
    ],
  },
  {
    title: "Medir",
    items: [
      { label: "Relatórios", view: "reports", icon: BarChart3 },
      { label: "Anúncios", view: "reports", section: "ads", icon: Megaphone },
    ],
  },
  {
    title: "Ajustes",
    items: [
      { label: "Fila e horários", icon: Settings2 },
      { label: "Equipe", icon: Users },
    ],
  },
];

const STORAGE_KEY = "coala.instagram.sidebar";

type StoredState = { closed: string[] };

function readStored(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { closed: [] };
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    return {
      closed: Array.isArray(parsed.closed) ? parsed.closed.filter((entry): entry is string => typeof entry === "string") : [],
    };
  } catch {
    return { closed: [] };
  }
}

function itemKey(item: NavItem) {
  return `${item.label}`;
}

type InstagramWorkspaceSidebarProps = {
  activeView: InstagramWorkspaceView;
  activeInsightsSection: InstagramInsightsSection;
  email: string | null | undefined;
  /** Pessoa conectada: foto, nome e cargo no cartão do rodapé. */
  person?: { name?: string | null; role?: string | null; avatarUrl?: string | null } | null;
  canManageBio: boolean;
  mobileOpen: boolean;
  /** Contadores discretos ao lado de cada tela (ex.: publicações programadas). */
  counts?: Partial<Record<InstagramWorkspaceView, number>>;
  onCloseMobile: () => void;
  onSelect: (view: InstagramWorkspaceView, section?: InstagramInsightsSection) => void;
  onCreate: () => void;
  onFutureFeature: (label: string) => void;
  onLogout: () => void;
};

export function InstagramWorkspaceSidebar({
  activeView,
  activeInsightsSection,
  email,
  person,
  canManageBio,
  mobileOpen,
  counts,
  onCloseMobile,
  onSelect,
  onCreate,
  onFutureFeature,
  onLogout,
}: InstagramWorkspaceSidebarProps) {
  /* Recolhida por padrão; expande ao passar o cursor ou focar um item, sobrepondo o conteúdo (sem empurrar a tela). */
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const [hover, setHover] = useState<{ top: number; height: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const stored = readStored();
    setClosed(new Set(stored.closed));
  }, []);

  const persist = useCallback((nextClosed: ReadonlySet<string>) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ closed: [...nextClosed] }));
    } catch {
      /* sem armazenamento: o estado vale só nesta sessão */
    }
  }, []);

  const visibleGroups = useMemo(
    () => groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.requiresBioAccess || canManageBio) })),
    [canManageBio],
  );

  const isActive = useCallback(
    (item: NavItem) =>
      item.view === activeView &&
      (item.view !== "reports" || (item.section ? item.section === activeInsightsSection : activeInsightsSection !== "ads")),
    [activeView, activeInsightsSection],
  );
  const activeLabel = useMemo(
    () => visibleGroups.flatMap((group) => group.items).find(isActive)?.label ?? null,
    [visibleGroups, isActive],
  );

  const expanded = hovered || focused || mobileOpen;
  const collapsed = !expanded;

  /* Item ativo dentro de um grupo recolhido não tem posição visível: o realce some em vez de ficar parado sobre o vizinho. */
  const activeGroupTitle = useMemo(
    () => visibleGroups.find((group) => group.items.some(isActive))?.title ?? null,
    [visibleGroups, isActive],
  );
  const activeGroupOpen = activeGroupTitle === null || collapsed || !closed.has(activeGroupTitle);

  /* O realce desliza até o item ativo; recalcula ao recolher grupos, trocar a largura ou redimensionar. */
  const measure = useCallback(() => {
    const nav = navRef.current;
    const element = activeLabel ? itemRefs.current.get(activeLabel) : null;
    if (!nav || !element) {
      setIndicator(null);
      return;
    }
    const navRect = nav.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setIndicator({ top: rect.top - navRect.top + nav.scrollTop, height: rect.height });
  }, [activeLabel]);

  useLayoutEffect(() => {
    measure();
  }, [measure, hovered, focused, closed, mobileOpen]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(nav);
    const timer = window.setTimeout(measure, 260);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [measure, hovered, focused, closed]);

  /* O realce de passagem acompanha o cursor (ou o foco) de item em item. */
  function previewItem(element: HTMLElement) {
    const nav = navRef.current;
    if (!nav) return;
    const navRect = nav.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    setHover({ top: rect.top - navRect.top + nav.scrollTop, height: rect.height });
  }

  function openRail() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setHovered(true);
  }

  function closeRail() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setHovered(false), 140);
  }

  /* Enquanto o grupo abre ou fecha (300 ms), os realces acompanham quadro a quadro em vez de ficarem parados. */
  function trackAnimation() {
    const start = performance.now();
    const tick = () => {
      measure();
      if (performance.now() - start < 340) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  function toggleGroup(title: string) {
    setHover(null);
    trackAnimation();
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      persist(next);
      return next;
    });
  }

  function go(item: NavItem) {
    if (item.view) onSelect(item.view, item.section);
    else onFutureFeature(item.label);
  }

  const displayName = person?.name?.trim() || email?.split("@")[0] || "Você";
  const personRole = person?.role?.trim() || email || "Programação do Instagram";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-40 bg-[var(--ds-scrim)] transition-opacity duration-200 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      {/* Reserva a largura do trilho (76px + 12px de respiro); a barra, flutuante e de cantos arredondados, se expande por cima do conteúdo. */}
      <div aria-hidden="true" className="hidden shrink-0 lg:block lg:w-[88px]" />
      <aside
        data-collapsed={collapsed || undefined}
        onMouseEnter={openRail}
        onMouseLeave={closeRail}
        onFocus={(event) => {
          /* Só o foco de teclado mantém a barra aberta; depois de um clique o item segue focado, mas a barra deve recolher ao tirar o cursor. */
          if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) setFocused(true);
        }}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col gap-4 overflow-hidden rounded-r-ds-card-lg bg-ds-dark py-4 font-ds text-ds-on-dark lg:inset-y-3 lg:left-3 lg:rounded-ds-panel lg:ring-1 lg:ring-white/10",
          "transition-[transform,width,box-shadow] duration-300 ease-out motion-reduce:transition-none",
          "lg:translate-x-0",
          mobileOpen ? "w-[260px] translate-x-0" : "w-[260px] -translate-x-full",
          collapsed ? "px-2 lg:w-[76px]" : "px-3 lg:w-[260px] lg:shadow-ds-modal",
        )}
        aria-label="Navegação da programação do Instagram"
      >
        <div className={cn("flex shrink-0 items-center gap-2", collapsed ? "justify-center" : "justify-between px-1.5")}>
          <SystemBrand collapsed={collapsed} accent="Pulse" />
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-ds-md text-ds-on-dark-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker lg:hidden"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={onCreate}
          title={collapsed ? "Criar post" : undefined}
          className={cn(
            "group relative flex shrink-0 items-center gap-2 overflow-hidden rounded-ds-btn-lg bg-ds-accent text-left text-[14px] font-extrabold text-ds-dark",
            "transition-[transform,box-shadow,background] duration-200 hover:-translate-y-0.5 hover:bg-ds-accent-hover hover:shadow-ds-lift active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ds-dark",
            collapsed ? "h-11 w-11 justify-center self-center" : "w-full px-3.5 py-2.5",
          )}
        >
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full motion-reduce:hidden" />
          <span aria-hidden="true" className="relative text-[20px] font-medium leading-none transition-transform duration-300 group-hover:rotate-90 motion-reduce:transition-none">+</span>
          {!collapsed && <span className="relative">Criar post</span>}
          {collapsed && <span className="sr-only">Criar post</span>}
        </button>

        <nav
          ref={navRef}
          className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain text-[14px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onMouseLeave={() => setHover(null)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(null); }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 rounded-ds-btn bg-gradient-to-r from-ds-accent/25 via-white/[0.07] to-transparent ring-1 ring-inset ring-white/10 transition-[transform,height,opacity] duration-200 ease-out motion-reduce:transition-none"
            style={{
              opacity: hover ? 1 : 0,
              height: hover?.height ?? 0,
              transform: `translateY(${hover?.top ?? 0}px)`,
            }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 rounded-ds-btn bg-white/10 transition-[transform,height,opacity] duration-300 ease-out motion-reduce:transition-none"
            style={{
              opacity: indicator && activeGroupOpen ? 1 : 0,
              height: indicator?.height ?? 0,
              transform: `translateY(${indicator?.top ?? 0}px)`,
            }}
          >
            <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-ds-accent" />
          </span>

          {visibleGroups.map((group) => {
            const open = collapsed || !closed.has(group.title);
            return (
              <section key={group.title} aria-labelledby={`instagram-nav-${group.title}`}>
                {collapsed ? (
                  <div aria-hidden="true" className="mx-3 my-2 border-t border-white/10 first:hidden" />
                ) : (
                  <h2 id={`instagram-nav-${group.title}`}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group.title)}
                      className="group flex w-full items-center justify-between rounded-ds-sm px-2.5 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-on-dark-muted transition-colors hover:text-ds-on-dark-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
                    >
                      {group.title}
                      <ChevronDown className={cn("h-3 w-3 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden="true" />
                    </button>
                  </h2>
                )}
                <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="overflow-hidden">
                    <div className="space-y-0.5 py-0.5">
                      {group.items.map((item) => {
                        const active = isActive(item);
                        const Icon = item.icon;
                        const count = item.view && !item.section ? counts?.[item.view] : undefined;
                        return (
                          <button
                            key={itemKey(item)}
                            ref={(element) => {
                              if (element) itemRefs.current.set(item.label, element);
                              else itemRefs.current.delete(item.label);
                            }}
                            type="button"
                            aria-current={active ? "page" : undefined}
                            aria-disabled={!item.view}
                            tabIndex={open ? 0 : -1}
                            title={collapsed ? item.label : undefined}
                            onClick={() => go(item)}
                            onMouseEnter={(event) => previewItem(event.currentTarget)}
                            onFocus={(event) => previewItem(event.currentTarget)}
                            className={cn(
                              "group/item relative flex w-full items-center gap-2.5 rounded-ds-btn px-2.5 py-2 text-left transition-[color,background,transform] duration-200 motion-reduce:transition-none",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker",
                              collapsed && "justify-center px-0 py-1.5",
                              active ? "font-extrabold text-white" : "text-ds-on-dark-sub hover:bg-white/[0.06] hover:text-white",
                              !collapsed && "hover:translate-x-1",
                              !item.view && "opacity-70",
                            )}
                          >
                            <Icon className="h-[18px] w-[18px] shrink-0 transition-[transform,color] duration-300 ease-out group-hover/item:-rotate-6 group-hover/item:scale-125 group-hover/item:text-ds-accent-kicker group-focus-visible/item:scale-125 motion-reduce:transition-none motion-reduce:group-hover/item:rotate-0 motion-reduce:group-hover/item:scale-100" aria-hidden="true" />
                            {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                            {collapsed && <span className="sr-only">{item.label}</span>}
                            {!collapsed && !item.view && (
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-ds-on-dark-muted">em breve</span>
                            )}
                            {!collapsed && item.view && !active && (
                              <span aria-hidden="true" className="-translate-x-2 text-[13px] font-bold text-ds-accent-kicker opacity-0 transition-[opacity,transform] duration-200 group-hover/item:translate-x-0 group-hover/item:opacity-100 motion-reduce:transition-none">→</span>
                            )}
                            {!collapsed && count !== undefined && count > 0 && (
                              <span className="rounded-full bg-ds-accent px-2 py-0.5 font-ds-mono text-[10px] font-bold text-ds-dark transition-transform duration-200 group-hover/item:scale-110">{count}</span>
                            )}
                            {collapsed && count !== undefined && count > 0 && (
                              <span aria-hidden="true" className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-ds-accent" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-2">
          <div className={cn("rounded-ds-btn-lg border border-white/10 bg-white/[0.06]", collapsed ? "p-1.5" : "p-2.5")}>
            <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")} title={collapsed ? [displayName, personRole].filter(Boolean).join(" · ") : undefined}>
              <Avatar className={cn("shrink-0 ring-2 ring-white/10 transition-[width,height] duration-300 motion-reduce:transition-none", collapsed ? "h-9 w-9" : "h-10 w-10")}>
                {person?.avatarUrl ? <AvatarImage src={person.avatarUrl} alt={displayName} className="object-cover" /> : null}
                <AvatarFallback className="bg-ds-accent text-[13px] font-extrabold text-ds-dark">{initials}</AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-extrabold leading-tight">{displayName}</div>
                  <div className="truncate text-[11.5px] text-ds-on-dark-muted" title={email ?? undefined}>{personRole}</div>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                type="button"
                onClick={onLogout}
                className="mt-2 flex w-full items-center gap-2 rounded-ds-sm px-2 py-1.5 text-left text-[12px] font-semibold text-ds-on-dark-sub transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent-kicker"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sair
              </button>
            )}
          </div>
        </div>
      </aside>

    </>
  );
}
