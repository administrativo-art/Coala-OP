"use client";

import { ChevronLeft, ClipboardCheck, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type ClosureSidebarPerson = { key: string; name: string; pending: number; meta?: string; detail: string; selected?: boolean; onClick: () => void };
export type ClosureSidebarGroup = { organization: string; people: ClosureSidebarPerson[] };

/** Lista lateral do fechamento: pessoas por organização, no mesmo padrão da lateral das Escalas. */
export function ClosureSidebar({ mode, title, subtitle, groups, query, onQueryChange, onBack, showBack, doneCount, totalCount }: {
  mode: "organizations" | "people"; title: string; subtitle: string; groups: ClosureSidebarGroup[]; query: string; onQueryChange: (value: string) => void; onBack: () => void; showBack: boolean;
  doneCount: number; totalCount: number;
}) {
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  return (
    <aside className="flex max-h-[42vh] w-full shrink-0 flex-col overflow-hidden rounded-[12px] bg-[#0f172a] px-[11px] pb-[11px] pt-[15px] text-slate-100 lg:sticky lg:top-4 lg:max-h-[calc(100vh-9rem)] lg:w-[230px]">
      <div className="flex items-center gap-2 px-[5px]">
        <ClipboardCheck className="h-[15px] w-[15px] shrink-0 text-[#db2777]" strokeWidth={2.4} />
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-black leading-4 tracking-[-0.01em] text-white">{title}</p>
          <p className="text-[10.5px] font-bold leading-[14px] text-[#67758c]">{subtitle}</p>
        </div>
      </div>
      {mode === "people" ? <label className="mt-[14px] flex h-8 items-center gap-2 rounded-[10px] bg-[#1a2537] px-[10px]">
        <Search className="h-[13px] w-[13px] shrink-0 text-[#5b6a83]" strokeWidth={2.4} />
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa"
          className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-xs font-semibold text-slate-200 outline-hidden placeholder:text-[#5b6a83] focus:ring-0" />
      </label> : null}
      {showBack ? <button type="button" onClick={onBack} className="mt-3 flex items-center gap-[7px] px-[5px] text-[11.5px] font-extrabold text-[#7f8ea6] transition-colors hover:text-slate-200">
        <ChevronLeft className="h-3 w-3" strokeWidth={2.8} />Todos os meses
      </button> : null}
      <div className="no-scrollbar mt-[10px] min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? <p className="px-2 py-6 text-center text-[11px] text-[#5b6a83]">{query ? "Nenhuma pessoa encontrada." : "Nenhuma pessoa no fechamento."}</p> : groups.map((group) => (
          <section key={group.organization} className="mb-2">
            {group.organization ? <div className="sticky top-0 z-2 mb-0.5 flex items-center gap-[7px] rounded-[9px] bg-[#182337] p-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-black text-[#e2e8f0]">{group.organization}</span>
              <span className="shrink-0 text-[10px] font-bold text-[#6b7a94]">{group.people.length} {group.people.length === 1 ? "pessoa" : "pessoas"}</span>
            </div> : null}
            <div className={cn("mb-0.5", group.organization && "ml-[9px] border-l border-[#22304a] pl-[7px]")}>
              {group.people.map((person) => (
                <button key={person.key} type="button" onClick={person.onClick} aria-current={person.selected ? "page" : undefined}
                  className={cn("mb-0.5 w-full rounded-[11px] px-[10px] py-[9px] text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-[#db2777]",
                    person.selected ? "bg-[#334155]" : "hover:bg-[#1a2537]")}>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("min-w-0 flex-1 truncate text-[12.5px] leading-4", person.selected ? "font-extrabold text-white" : "font-semibold text-[#d8deea]")}>{person.name}</span>
                    <span className={cn("shrink-0 text-[10px] font-extrabold", person.pending ? "text-[#f472a5]" : "text-[#90a0b8]")}>{person.meta ?? (person.pending ? `${person.pending} pend.` : "ok")}</span>
                  </span>
                  <span className="mt-1 block truncate text-[9.5px] font-semibold leading-3 text-[#67758c]">{person.detail}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {mode === "people" ? <div className="mt-[10px] rounded-[12px] bg-[#1a2537] px-3 py-[11px]">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-extrabold text-[#e2e8f0]">{doneCount} de {totalCount} sem pendência</span>
          <span className="text-[10.5px] font-extrabold text-[#7f8ea6]">{pct}%</span>
        </div>
        <div className="mt-[7px] h-[5px] overflow-hidden rounded-[3px] bg-[#2b3a52]"><div className="h-[5px] rounded-[3px] bg-[#db2777]" style={{ width: `${pct}%` }} /></div>
      </div> : null}
    </aside>
  );
}
