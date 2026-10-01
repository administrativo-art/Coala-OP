"use client";

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
  Megaphone,
  MessageSquare,
  Settings2,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

export type InstagramWorkspaceView = "calendar" | "feed" | "media" | "bio" | "reports";

type NavItem = {
  label: string;
  view?: InstagramWorkspaceView;
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
      { label: "Biblioteca de mídia", view: "media", icon: BookImage },
      { label: "Legendas e hashtags", icon: Hash },
      { label: "Aprovações", icon: MessageSquare },
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
      { label: "Anúncios", icon: Megaphone },
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

type InstagramWorkspaceSidebarProps = {
  activeView: InstagramWorkspaceView;
  email: string | null | undefined;
  canManageBio: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelect: (view: InstagramWorkspaceView) => void;
  onCreate: () => void;
  onFutureFeature: (label: string) => void;
  onLogout: () => void;
};

export function InstagramWorkspaceSidebar({
  activeView,
  email,
  canManageBio,
  mobileOpen,
  onCloseMobile,
  onSelect,
  onCreate,
  onFutureFeature,
  onLogout,
}: InstagramWorkspaceSidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="fixed inset-0 z-40 bg-[#4A1A04]/30 lg:hidden"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[250px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#EADFD3] bg-[#F4ECE2] px-3.5 py-4 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Navegação da programação do Instagram"
      >
        <div className="flex items-center justify-between gap-2 px-1.5">
          <div className="flex items-center gap-2.5">
            <div className="relative h-11 w-24 shrink-0 overflow-hidden" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/instagram/coala-logo.png"
                alt=""
                className="absolute left-[-17px] top-[-44px] h-auto w-[129px] max-w-none"
              />
            </div>
            <div className="border-l border-[#D9C8B6] pl-2 text-[12px] font-semibold leading-[1.2] text-[#7A5646]">
              Programação
              <br />
              Instagram
            </div>
          </div>
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-lg border border-[#EADFD3] bg-white text-[#4A1A04] lg:hidden"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center gap-2 rounded-[10px] bg-[#F462A7] px-3.5 py-2.5 text-left text-[14px] font-extrabold text-[#4A1A04] transition hover:bg-[#E9509A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D90F6F]"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Criar post
          <PlusLabel />
        </button>

        <nav className="flex flex-col gap-3 text-[14px]">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`instagram-nav-${group.title}`}>
              <h2
                id={`instagram-nav-${group.title}`}
                className="flex items-center justify-between px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.09em] text-[#7A5646]"
              >
                {group.title}
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
              </h2>
              <div className="mt-0.5 space-y-0.5">
                {group.items.filter((item) => !item.requiresBioAccess || canManageBio).map((item) => {
                  const active = item.view === activeView;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      aria-disabled={!item.view}
                      onClick={() => item.view ? onSelect(item.view) : onFutureFeature(item.label)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D90F6F] ${active ? "bg-white font-bold text-[#4A1A04] shadow-sm" : "text-[#5E3A28] hover:bg-white/70"}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {!item.view && (
                        <span className="text-[10px] font-semibold text-[#7A5646]">em breve</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="mt-auto rounded-[10px] border border-[#EADFD3] bg-white p-2.5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#FDE3EF] text-[12px] font-extrabold text-[#D90F6F]">
              {(email?.[0] ?? "V").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-[#4A1A04]">Você · admin</div>
              <div className="truncate text-[11px] text-[#7A5646]">{email ?? "@coalashakes"}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-2 w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-[#7A5646] hover:bg-[#F4ECE2] hover:text-[#4A1A04]"
          >
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}

function PlusLabel() {
  return <span className="ml-auto text-[18px] font-medium leading-none" aria-hidden="true">+</span>;
}
