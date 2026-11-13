"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  FileQuestion,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";

import { BackButton } from "@/components/navigation/back-button";
import { DocumentCreateLink } from "./document-create-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { CentralDocumentDimensions, CentralWorkItem, CentralWorkPage, CentralWorkTab } from "./types";

const TABS: Array<{ value: CentralWorkTab; label: string; description: string; icon: typeof FileQuestion }> = [
  { value: "classify", label: "A classificar", description: "Arquivos recebidos que ainda precisam de confirmação.", icon: FileQuestion },
  { value: "preparation", label: "Em preparação", description: "Documentos em revisão ou finalização.", icon: FileCheck2 },
  { value: "flows", label: "Fluxos", description: "Processos e requisitos, inclusive documentos ainda não recebidos.", icon: GitBranch },
  { value: "signatures", label: "Assinaturas", description: "Envios, falhas e trilhas que ainda não terminaram.", icon: Send },
];

const SOURCE_LABEL: Record<CentralWorkItem["source"], string> = {
  employee_upload: "Dossiê do colaborador",
  onboarding: "Admissão",
  generated: "Documentos gerados",
  financial: "Financeiro",
  absence: "Ausências",
  company: "Empresa",
  vacation: "Férias",
  termination: "Desligamentos",
};

const DIMENSION_LABEL: Record<keyof CentralDocumentDimensions, string> = {
  classification: "Classificação",
  preparation: "Preparação",
  signature: "Assinatura",
  archiving: "Arquivamento",
  publication: "Publicação",
};

const STATE_LABEL: Record<string, string> = {
  not_applicable: "Não se aplica",
  pending: "Pendente",
  suggested: "Sugestão pronta",
  confirmed: "Confirmada",
  failed: "Exige atenção",
  ready: "Pronto",
  completed: "Concluída",
  not_sent: "Ainda não enviada",
  partially_signed: "Parcialmente assinada",
  filed: "Arquivado",
  private: "Restrita",
  published: "Publicada",
};

function stateTone(value: string) {
  if (["failed"].includes(value)) return "bg-rose-50 text-rose-700";
  if (["pending", "suggested", "partially_signed", "not_sent"].includes(value)) return "bg-amber-50 text-amber-800";
  if (["confirmed", "ready", "completed", "filed", "published"].includes(value)) return "bg-emerald-50 text-emerald-700";
  return "bg-slate-50 text-slate-500";
}

function formatDate(value: string | null) {
  if (!value) return "Data não registrada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function CentralDocumentWorkspace() {
  const { firebaseUser } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requestedTab = searchParams.get("tab") as CentralWorkTab | null;
  const activeTab = TABS.some((tab) => tab.value === requestedTab) ? requestedTab! : "classify";
  const [payload, setPayload] = useState<CentralWorkPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(searchParams.get("item") ?? "");
  const requestSequence = useRef(0);
  const invalidateRequest = useCallback(() => { requestSequence.current++; }, []);

  const setUrl = useCallback((tab: CentralWorkTab, item?: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    if (item) params.set("item", item); else params.delete("item");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const load = useCallback(async (page?: CentralWorkPage["continuations"][number]) => {
    if (!firebaseUser) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/work-items?tab=${encodeURIComponent(activeTab)}&limit=40${page ? `&source=${page.source}&cursor=${encodeURIComponent(page.cursor)}${page.stage ? `&stage=${page.stage}` : ""}` : ""}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(body.error || "Falha ao carregar os fluxos documentais.");
      const next = body as CentralWorkPage;
      setPayload((previous) => page && previous ? { ...next, continuations: [...previous.continuations.filter((entry) => entry.source !== page.source || entry.stage !== page.stage), ...next.continuations], items: [...new Map([...previous.items, ...next.items].map((item) => [item.id, item])).values()] } : next);
      setSelectedId((current) => current && (page || next.items.some((item) => item.id === current)) ? current : next.items[0]?.id ?? "");
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      if (!page) setPayload(null);
      setError(cause instanceof Error ? cause.message : "Falha ao carregar os fluxos documentais.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [activeTab, firebaseUser]);

  // A leitura assíncrona sincroniza esta visão com as origens autorizadas.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return invalidateRequest; }, [load, invalidateRequest]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return payload?.items ?? [];
    return (payload?.items ?? []).filter((item) => [item.title, item.subject, item.statusLabel, SOURCE_LABEL[item.source], ...item.missingFields]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(term));
  }, [payload?.items, query]);
  const selected = filtered.find((item) => item.id === (searchParams.get("item") ?? selectedId)) ?? filtered[0] ?? null;
  const activeDefinition = TABS.find((tab) => tab.value === activeTab)!;

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-xs">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-teal-700">Gestão documental</p>
            <BackButton fallbackHref="/dashboard/documents" ariaLabel="Voltar ao Acervo" />
            <h1 className="text-xl font-black text-slate-950">Fluxos e pendências</h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Acompanhe o trabalho documental. Cada ação continua no módulo responsável e respeita as permissões daquela origem.</p>
          </div>
          <div className="flex items-center gap-2"><DocumentCreateLink /><Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button></div>
        </div>
        <nav className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Áreas de trabalho documental">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.value === activeTab;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => { setSelectedId(""); setUrl(tab.value); }}
                className={`rounded-lg border px-3 py-2.5 text-left transition ${active ? "border-teal-300 bg-teal-50 text-teal-950" : "border-slate-200 bg-white text-slate-600 hover:border-teal-200"}`}
              >
                <span className="flex items-center gap-2 text-xs font-black"><Icon className="h-4 w-4" />{tab.label}</span>
                <span className="mt-1 block text-[10px] leading-4 opacity-75">{tab.description}</span>
              </button>
            );
          })}
        </nav>
      </header>

      {(payload?.warnings ?? []).length ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
          {(payload?.warnings ?? []).map((warning) => <p key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}
        </div>
      ) : null}

      <div className="grid min-h-[620px] lg:grid-cols-[minmax(360px,1fr)_minmax(360px,0.82fr)]">
        <section className="min-w-0 border-r">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 pl-9 text-xs" placeholder={`Buscar em ${activeDefinition.label.toLocaleLowerCase("pt-BR")}...`} />
            </div>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading ? (
              <div className="grid min-h-56 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>
            ) : error ? (
              <div className="grid min-h-56 place-items-center p-6 text-center"><div><AlertTriangle className="mx-auto h-8 w-8 text-rose-400" /><p className="mt-3 text-sm font-black text-slate-800">Não foi possível carregar</p><p className="mt-1 text-xs text-slate-500">{error}</p><Button className="mt-4" size="sm" variant="outline" onClick={() => void load()}>Tentar novamente</Button></div></div>
            ) : filtered.length === 0 ? (
              <div className="grid min-h-56 place-items-center p-6 text-center"><div><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" /><p className="mt-3 text-sm font-black text-slate-800">Nenhum item nesta visão</p><p className="mt-1 text-xs text-slate-500">A lista considera somente as origens que seu perfil pode consultar.</p></div></div>
            ) : filtered.map((item) => {
              const active = selected?.id === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => { setSelectedId(item.id); setUrl(activeTab, item.id); }}
                  className={`w-full border-b px-4 py-3 text-left transition ${active ? "bg-teal-50" : "hover:bg-slate-50"}`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-black text-slate-900">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.subject ?? SOURCE_LABEL[item.source]}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${item.dimensions.preparation === "failed" || item.dimensions.classification === "failed" || item.dimensions.signature === "failed" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{item.statusLabel}</span>
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400"><span>{SOURCE_LABEL[item.source]}</span><span>{formatDate(item.updatedAt)}</span></span>
                </button>
              );
            })}
          </div>
          {payload?.continuations?.length ? <div className="flex flex-wrap gap-2 p-3">{payload.continuations.map((page) => <Button key={`${page.source}:${page.stage ?? ""}`} variant="outline" disabled={loading} onClick={() => void load(page)}>Carregar mais · {SOURCE_LABEL[page.source]}{page.stage ? ` (${{ classify: "Classificação", link: "Vínculo", pay: "Preparação", bank: "Banco" }[page.stage]})` : ""}</Button>)}</div> : null}
        </section>

        <aside className="min-w-0 bg-slate-50/60 p-4">
          {selected ? (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-teal-700">{SOURCE_LABEL[selected.source]}</p>
                <h2 className="mt-1 text-lg font-black text-slate-950">{selected.title}</h2>
                {selected.subject ? <p className="mt-1 text-xs text-slate-500">{selected.subject}</p> : null}
              </div>
              <div className="rounded-lg border bg-white p-3">
                <p className="text-xs font-black text-slate-900">{selected.statusLabel}</p>
                {selected.metadata.provider ? <p className="mt-1 text-xs text-slate-500">Provedor: {selected.metadata.provider}</p> : null}
                {selected.detail ? <p className="mt-1 text-[11px] leading-5 text-slate-600">{selected.detail}</p> : null}
                <p className="mt-2 text-[10px] text-slate-400">Atualização: {formatDate(selected.updatedAt)}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(selected.dimensions).map(([key, value]) => (
                  <div key={key} className="rounded-lg border bg-white p-2.5">
                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{DIMENSION_LABEL[key as keyof CentralDocumentDimensions]}</p>
                    <p className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${stateTone(value)}`}>{STATE_LABEL[value] ?? value}</p>
                  </div>
                ))}
              </div>
              {selected.metadata.requirementCount !== undefined ? (
                <div className="rounded-lg border bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Requisitos do fluxo</p>
                  <p className="mt-2 text-sm font-black text-slate-900">{selected.metadata.completedRequirementCount ?? 0} de {selected.metadata.requirementCount} concluídos</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-teal-600" style={{ width: `${Math.round(((selected.metadata.completedRequirementCount ?? 0) / Math.max(1, selected.metadata.requirementCount)) * 100)}%` }} /></div>
                </div>
              ) : null}
              {selected.missingFields.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">O que falta</p>
                  <ul className="mt-2 space-y-1 text-[11px] text-amber-900">{selected.missingFields.slice(0, 8).map((field) => <li key={field} className="flex gap-2"><CircleDot className="mt-0.5 h-3 w-3 shrink-0" />{field}</li>)}</ul>
                </div>
              ) : null}
              <Button asChild className="w-full bg-teal-700 hover:bg-teal-800">
                <Link href={selected.href}>{selected.actionLabel}<ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          ) : (
            <div className="grid min-h-56 place-items-center text-center"><p className="text-xs text-slate-500">Selecione um item para ver sua situação e abrir o fluxo responsável.</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
