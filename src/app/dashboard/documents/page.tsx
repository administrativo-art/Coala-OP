"use client";

import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Building2, ChevronRight, Folder, HardDrive, ReceiptText, Search, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const destinations = [
  {
    title: "Empresa",
    description: "Arquivos institucionais organizados por categoria e unidade.",
    href: "/dashboard/documents/company",
    icon: Building2,
    tone: "bg-teal-50 text-teal-700",
    canShow: (permissions: ReturnType<typeof useAuth>["permissions"]) => hasFormalizationPermission(permissions, "companyDocuments.view"),
  },
  {
    title: "Colaboradores",
    description: "Dossiês dos colaboradores, conforme suas permissões de acesso.",
    href: "/dashboard/documents/collaborators",
    icon: Users,
    tone: "bg-sky-50 text-sky-700",
    canShow: (permissions: ReturnType<typeof useAuth>["permissions"]) => hasFormalizationPermission(permissions, "documents.view"),
  },
  {
    title: "Financeiro",
    description: "Documentos recebidos e vinculados às obrigações financeiras.",
    href: "/dashboard/documents/financial",
    icon: ReceiptText,
    tone: "bg-amber-50 text-amber-700",
    canShow: (permissions: ReturnType<typeof useAuth>["permissions"]) => Boolean(permissions.financial?.view && permissions.financial?.inbox?.view),
  },
];

export default function DocumentsPage() {
  const { permissions } = useAuth();
  const router = useRouter();
  const [selectedHref, setSelectedHref] = useState("");
  const [search, setSearch] = useState("");
  const visibleDestinations = useMemo(() => destinations.filter(({ canShow, title }) => canShow(permissions)
    && title.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))), [permissions, search]);
  const selected = visibleDestinations.find((destination) => destination.href === selectedHref) ?? visibleDestinations[0] ?? null;
  return (
    <PageContainer>
      <div className="overflow-hidden rounded-xl border bg-white shadow-xs">
        <header className="border-b px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Gestão documental</p>
          <h1 className="text-xl font-black text-slate-950">Acervo</h1>
          <p className="mt-1 text-xs text-slate-500">Navegue pelas áreas autorizadas. A organização, a visibilidade e a publicação continuam sob as regras de cada origem.</p>
        </header>
        <div className="grid min-h-[560px] md:grid-cols-[230px_1fr]">
          <aside className="border-r bg-slate-50/70 p-3">
            <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-900 shadow-xs"><HardDrive className="h-4 w-4 text-teal-700" />Acervo</div>
            <div className="mt-2 space-y-1 border-l pl-3">
              {visibleDestinations.map(({ title, href, icon: Icon }) => <button key={href} type="button" onClick={() => setSelectedHref(href)} className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] font-bold ${selected?.href === href ? "bg-teal-100 text-teal-900" : "text-slate-600 hover:bg-white"}`}><Icon className="h-4 w-4" />{title}</button>)}
            </div>
          </aside>
          <section className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
              <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500"><HardDrive className="h-3.5 w-3.5" /><ChevronRight className="h-3.5 w-3.5" />{selected?.title ?? "Acervo"}</div>
              <div className="relative ml-auto w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-8 pl-8 text-xs" placeholder="Buscar pasta..." /></div>
            </div>
            <div className="p-4">
              {visibleDestinations.length ? <div className="overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_80px] bg-slate-50 px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400"><span>Pasta</span><span>Conteúdo</span><span>Ação</span></div>
                {visibleDestinations.map(({ title, description, href, icon: Icon, tone }) => <button key={href} type="button" onClick={() => setSelectedHref(href)} onDoubleClick={() => router.push(href)} className={`grid w-full grid-cols-[minmax(180px,1fr)_minmax(220px,1.4fr)_80px] items-center border-t px-3 py-3 text-left transition ${selected?.href === href ? "bg-teal-50" : "hover:bg-slate-50"}`}><span className="flex min-w-0 items-center gap-2"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${tone}`}><Icon className="h-4 w-4" /></span><span className="truncate text-xs font-black text-slate-900">{title}</span></span><span className="pr-3 text-[11px] leading-4 text-slate-500">{description}</span><span><Folder className="h-4 w-4 text-slate-400" /></span></button>)}
              </div> : <div className="grid min-h-52 place-items-center text-center"><div><Folder className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Nenhuma pasta encontrada</p></div></div>}
              {selected ? <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border bg-slate-50 p-3"><div><p className="text-xs font-black text-slate-900">{selected.title}</p><p className="mt-0.5 text-[11px] text-slate-500">{selected.description}</p></div><Button asChild size="sm" className="bg-teal-700 hover:bg-teal-800"><Link href={selected.href}>Abrir pasta<ChevronRight className="ml-1.5 h-4 w-4" /></Link></Button></div> : null}
            </div>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
