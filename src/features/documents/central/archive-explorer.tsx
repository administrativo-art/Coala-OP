"use client";

import Link from "next/link";
import { DocumentNavigation } from "./document-navigation";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUp, Building2, ChevronDown, ChevronRight, FileStack, FileText, Folder, Grid2X2, HardDrive, List, Loader2, MoreHorizontal, RefreshCw, Search, Users } from "lucide-react";
import { SortHeader } from "@/components/patterns/sort-header";
import { sortByTitle } from "@/lib/sort-by-title";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { companyArchiveFolderLabel, companyArchiveHref } from "@/lib/documents/company-archive-navigation";

export type ArchiveArea = "company" | "collaborators" | "financial" | "models";
export type ArchiveAction = { label: string; run: () => void; destructive?: boolean };
export type ArchiveEntry = { id: string; name: string; kind: "folder" | "file" | "model"; description?: string; modified?: string; size?: string; open: () => void; actions?: ArchiveAction[] };
export type ArchiveFolder = { id: string; name: string; active?: boolean; depth?: number; open: () => void };
export const ARCHIVE_AREAS = [
  { id: "company" as const, name: "Empresa", description: "Documentos institucionais", icon: Building2 },
  { id: "collaborators" as const, name: "Colaboradores", description: "Pastas individuais da equipe", icon: Users },
];

export function useCompanyArchiveAccess() {
  const { permissions, isDefaultAdmin } = useAuth();
  return {
    documents: hasFormalizationPermission(permissions, "companyDocuments.view", isDefaultAdmin),
    financial: isDefaultAdmin || Boolean(permissions.financial?.view && permissions.financial?.inbox?.view),
    models: hasFormalizationPermission(permissions, "templates.view", isDefaultAdmin),
  };
}

export function useArchiveAreas() {
  const { permissions, isDefaultAdmin } = useAuth();
  const access = useCompanyArchiveAccess();
  return ARCHIVE_AREAS.filter((area) => area.id === "company" ? access.documents || access.financial || access.models
    : hasFormalizationPermission(permissions, "documents.view", isDefaultAdmin));
}
export function archiveAreaHref(area: ArchiveArea) { return `/dashboard/documents/${area}`; }

export function ArchiveExplorer({ area = null, entries, folders = [], breadcrumbs = [], search, onSearch, loading, error, toolbar, onRefresh, onUp, onRoot, preview, onSelect, footer }: {
  area?: ArchiveArea | null; entries: ArchiveEntry[]; folders?: ArchiveFolder[];
  breadcrumbs?: Array<{ name: string; open?: () => void }>;
  search: string; onSearch: (value: string) => void; loading?: boolean; error?: string | null; toolbar?: ReactNode;
  onRefresh?: () => void; onUp?: () => void; onRoot?: () => void; preview?: (entry: ArchiveEntry) => ReactNode; onSelect?: (entry: ArchiveEntry | null) => void; footer?: ReactNode;
}) {
  const router = useRouter();
  const areas = useArchiveAreas();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const orderedEntries = useMemo(() => sortByTitle(entries, (entry) => entry.name, order), [entries, order]);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const select = (entry: ArchiveEntry) => { setSelectedId(entry.id); if (selectedId !== entry.id) onSelect?.(entry); };
  const open = (entry: ArchiveEntry) => { if (entry.kind === "folder") { setSelectedId(null); onSelect?.(null); } else select(entry); entry.open(); };
  const nestedInCompany = area === "financial" || area === "models";
  const areaName = nestedInCompany ? companyArchiveFolderLabel(area === "financial" ? "Financeiro" : "Modelos") : ARCHIVE_AREAS.find((entry) => entry.id === area)?.name;
  return <PageContainer variant="wide">
    <div className="overflow-hidden rounded-xl border bg-white shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight"><HardDrive className="h-5 w-5 text-teal-700" />Acervo</h1>
        <DocumentNavigation active="archive" />
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50/60 px-3 py-2">
        <Button size="icon" variant="ghost" aria-label="Voltar" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="Pasta acima" disabled={!area} onClick={onUp ?? (() => router.push("/dashboard/documents"))}><ArrowUp className="h-4 w-4" /></Button>
        <nav aria-label="Caminho da pasta" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs"><Link className="rounded px-1 py-2 hover:bg-white" href="/dashboard/documents">Acervo</Link>{nestedInCompany && <><ChevronRight className="h-3 w-3" /><Link className="rounded px-1 py-2 font-semibold" href={companyArchiveHref()}>Empresa</Link></>}{areaName && <><ChevronRight className="h-3 w-3" /><button type="button" className="rounded px-1 py-2 font-semibold hover:bg-white" onClick={onRoot ?? (() => router.push(archiveAreaHref(area!)))}>{areaName}</button></>}{breadcrumbs.map((crumb, index) => <span key={`${crumb.name}:${index}`} className="flex min-w-0 items-center gap-1"><ChevronRight className="h-3 w-3 shrink-0" /><button type="button" onClick={crumb.open} disabled={!crumb.open} className="truncate rounded px-1 py-2 font-semibold">{crumb.name}</button></span>)}</nav>
        <div className="relative w-full sm:w-60"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Buscar nesta pasta" placeholder="Buscar nesta pasta…" value={search} onChange={(event) => onSearch(event.target.value)} className="h-8 bg-white pl-8 text-xs" /></div>
        <Button size="icon" variant="ghost" aria-label={grid ? "Exibir em lista" : "Exibir em ícones"} onClick={() => setGrid(!grid)}>{grid ? <List className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}</Button>
        <div className="relative"><select aria-label="Ordenar por título" value={order} onChange={(event) => setOrder(event.target.value as "asc" | "desc")} className="h-8 rounded-md border bg-white appearance-none pl-2 pr-10 text-xs"><option value="asc">Título: A–Z</option><option value="desc">Título: Z–A</option></select><span className="pointer-events-none absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border bg-white shadow-xs"><ChevronDown className="h-4 w-4" strokeWidth={2.25} /></span></div>
        {onRefresh && <Button size="icon" variant="ghost" aria-label="Atualizar pasta" disabled={loading} onClick={onRefresh}><RefreshCw className="h-4 w-4" /></Button>}{toolbar}
      </div>
      <div className="grid min-h-[600px] md:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="Árvore de pastas" className="border-b bg-slate-50/70 p-3 md:border-b-0 md:border-r">
          <Link href="/dashboard/documents" className="mb-3 flex items-center gap-2 rounded-md px-2 py-2 text-xs font-bold"><HardDrive className="h-4 w-4" />Acervo</Link>
          {areas.map((item) => <Link key={item.id} aria-current={(area === item.id || nestedInCompany && item.id === "company") ? "page" : undefined} href={archiveAreaHref(item.id)} onClick={(event) => { if (item.id === area && onRoot) { event.preventDefault(); onRoot(); } }} className={`flex items-center gap-2 rounded-md px-2 py-2.5 text-xs font-semibold ${(area === item.id || nestedInCompany && item.id === "company") ? "bg-teal-100 text-teal-900" : "text-slate-600 hover:bg-white"}`}><item.icon className="h-4 w-4 shrink-0" />{item.name}</Link>)}
          {folders.length > 0 && <div className="mt-4 border-t pt-3"><p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Pastas {areaName ? "· " + areaName : ""}</p><div className="ml-2 max-h-[360px] space-y-0.5 overflow-auto border-l pl-2">{folders.map((folder) => <button key={folder.id} type="button" onClick={folder.open} aria-current={folder.active ? "page" : undefined} style={{ paddingLeft: `${6 + (folder.depth ?? 0) * 10}px` }} className={`flex w-full items-start gap-2 rounded-md py-2 pr-1 text-left text-[11px] ${folder.active ? "bg-white font-bold text-teal-800" : "text-slate-500 hover:bg-white"}`}><Folder className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{folder.name}</span></button>)}</div></div>}
        </nav>
        <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_280px]">
          <main aria-label="Conteúdo da pasta" className="min-w-0">
            {error && <p role="alert" className="m-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
            {loading ? <div role="status" className="grid min-h-64 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /><span className="sr-only">Carregando pasta</span></div> : <>
              {!grid && <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-3 border-b bg-slate-50/50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 md:grid-cols-[minmax(0,1fr)_115px_80px_36px]"><SortHeader label="Título" active direction={order} onClick={() => setOrder(order === "asc" ? "desc" : "asc")} /><span className="hidden md:block">Modificado</span><span className="hidden md:block">Tamanho</span><span /></div>}
              <div className={grid ? "grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4" : ""}>
                {orderedEntries.map((entry) => <DropdownMenu key={entry.id} open={menuId === entry.id} onOpenChange={(value) => setMenuId(value ? entry.id : null)}>
                  <div onContextMenu={(event) => { event.preventDefault(); select(entry); setMenuId(entry.id); }} className={`group relative min-w-0 ${grid ? "rounded-lg border" : "border-b"} ${selected?.id === entry.id ? "bg-teal-50 ring-1 ring-inset ring-teal-200" : "hover:bg-slate-50"}`}>
                    <button type="button" id={"archive-entry-" + encodeURIComponent(entry.id)} aria-label={`${entry.kind === "folder" ? "Pasta" : entry.kind === "model" ? "Modelo" : "Arquivo"}: ${entry.name}`} aria-pressed={selected?.id === entry.id} onClick={(event) => (event.nativeEvent as PointerEvent).pointerType === "touch" ? open(entry) : select(entry)} onDoubleClick={() => open(entry)} onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); open(entry); }
                        else if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") { event.preventDefault(); select(entry); setMenuId(entry.id); }
                        else if (event.key === "Escape") { setSelectedId(null); onSelect?.(null); }
                        else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                          event.preventDefault();
                          const index = orderedEntries.findIndex((item) => item.id === entry.id);
                          const next = event.key === "Home" ? 0 : event.key === "End" ? orderedEntries.length - 1 : Math.max(0, Math.min(orderedEntries.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
                          const target = orderedEntries[next];
                          if (target) { select(target); window.document.getElementById("archive-entry-" + encodeURIComponent(target.id))?.focus(); }
                        }
                      }} className={grid ? "flex min-h-32 w-full flex-col items-center gap-3 p-4 pb-9 text-center" : "grid w-full grid-cols-[minmax(0,1fr)_36px] items-center gap-3 px-4 py-3 text-left md:grid-cols-[minmax(0,1fr)_115px_80px_36px]"}>
                      <span className={`flex min-w-0 gap-3 ${grid ? "flex-col items-center" : "items-center"}`}>{entry.kind === "folder" ? <Folder className={`${grid ? "h-12 w-12" : "h-7 w-7"} shrink-0 fill-amber-100 text-amber-500`} /> : entry.kind === "model" ? <FileStack className={`${grid ? "h-12 w-12" : "h-7 w-7"} shrink-0 text-violet-500`} /> : <FileText className={`${grid ? "h-12 w-12" : "h-7 w-7"} shrink-0 text-teal-600`} />}<span className="min-w-0"><span className="block break-words text-xs font-semibold text-slate-900">{entry.name}</span>{entry.description && <span className="mt-1 block truncate text-[10px] text-slate-500">{entry.description}</span>}</span></span>
                      {!grid && <><span className="hidden text-[11px] text-slate-500 md:block">{entry.modified || "—"}</span><span className="hidden text-[11px] text-slate-500 md:block">{entry.size || "—"}</span><span /></>}
                    </button>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações de ${entry.name}`} className="absolute bottom-1 right-1 h-8 w-8" onClick={() => select(entry)}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => open(entry)}>{entry.kind === "folder" ? "Abrir pasta" : "Abrir"}</DropdownMenuItem>{entry.actions?.map((action) => <DropdownMenuItem key={action.label} className={action.destructive ? "text-rose-600" : ""} onSelect={action.run}>{action.label}</DropdownMenuItem>)}</DropdownMenuContent>
                  </div>
                </DropdownMenu>)}
              </div>
              {entries.length === 0 && !error && <div className="grid min-h-64 place-items-center p-6 text-center"><div><Folder className="mx-auto h-10 w-10 text-slate-200" /><p className="mt-3 text-sm text-slate-500">{search ? "Nenhum item encontrado nesta pasta." : "Esta pasta está vazia."}</p></div></div>}
            </>}
            {footer}<p className="px-4 py-3 text-[10px] text-slate-400">{entries.length} {entries.length === 1 ? "item" : "itens"} · Duplo clique ou Enter para abrir</p>
          </main>
          <aside aria-label="Prévia e detalhes" className="min-w-0 space-y-4 border-t bg-slate-50/40 p-4 xl:border-l xl:border-t-0">{selected ? <><p className="break-words text-sm font-bold">{selected.name}</p>{preview ? preview(selected) : <p className="text-xs text-slate-500">{selected.description}</p>}<Button className="w-full" size="sm" onClick={() => open(selected)}>{selected.kind === "folder" ? "Abrir pasta" : "Abrir"}<ChevronRight className="ml-2 h-4 w-4" /></Button>{selected.actions?.map((action) => <Button key={action.label} variant="outline" size="sm" className={`w-full ${action.destructive ? "text-rose-600" : ""}`} onClick={action.run}>{action.label}</Button>)}</> : <p className="pt-6 text-center text-xs text-slate-400">Selecione um item para ver a prévia e os detalhes.</p>}</aside>
        </div>
      </div>
    </div>
  </PageContainer>;
}
