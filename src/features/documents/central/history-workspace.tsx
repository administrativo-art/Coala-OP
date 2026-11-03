"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FileClock, Loader2, RefreshCw, Search } from "lucide-react";

import { BackButton } from "@/components/navigation/back-button";
import { DocumentCreateLink } from "./document-create-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { CentralDocumentSource, CentralHistoryPage, CentralDocumentRef } from "./types";

type HistorySource = "all" | Exclude<CentralDocumentSource, "absence">;

const SOURCES: Array<{ value: HistorySource; label: string }> = [
  { value: "all", label: "Todas as origens" },
  { value: "generated", label: "Documentos gerados" },
  { value: "company", label: "Empresa" },
  { value: "employee_upload", label: "Uploads do dossiê" },
  { value: "onboarding", label: "Admissão" },
  { value: "vacation", label: "Férias" }, { value: "termination", label: "Desligamentos" },
];

const SOURCE_LABEL: Partial<Record<CentralDocumentSource, string>> = {
  generated: "Documentos gerados",
  company: "Empresa",
  employee_upload: "Dossiê do colaborador",
  onboarding: "Admissão",
  vacation: "Férias", termination: "Desligamentos",
};

const METHOD_LABEL: Record<string, string> = {
  rule: "Regra do sistema",
  ocr: "OCR",
  ai: "IA",
  unknown: "Método não registrado",
};

function formatDate(value: string | null) {
  if (!value) return "Data não registrada";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function Value({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="rounded-lg border bg-white p-3"><p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-semibold text-slate-800">{value || "Não registrado"}</p></div>;
}

export function DocumentHistoryWorkspace() {
  const { firebaseUser } = useAuth();
  const searchParams = useSearchParams();
  const [source, setSource] = useState<HistorySource>(() => SOURCES.find((entry) => entry.value === searchParams.get("source"))?.value ?? "all");
  const [timelineDocument, setTimelineDocument] = useState<CentralDocumentRef | null>(() => ["company", "employee_upload"].includes(searchParams.get("source") ?? "") && searchParams.get("documentId") ? { source: searchParams.get("source") as CentralDocumentSource, sourceId: searchParams.get("documentId")! } : null);
  const [payload, setPayload] = useState<CentralHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const requestSequence = useRef(0);
  const invalidateRequest = useCallback(() => { requestSequence.current++; }, []);

  const load = useCallback(async (page?: CentralHistoryPage["continuations"][number]) => {
    if (!firebaseUser) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/history?source=${encodeURIComponent(timelineDocument?.source ?? page?.source ?? source)}&limit=50${timelineDocument ? `&documentId=${encodeURIComponent(timelineDocument.sourceId)}` : ""}${page ? `&cursor=${encodeURIComponent(page.cursor)}` : ""}`, {
        headers: { Authorization: `Bearer ${await firebaseUser.getIdToken()}` }, cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (sequence !== requestSequence.current) return;
      if (!response.ok) throw new Error(body.error || "Falha ao carregar o histórico documental.");
      const next = body as CentralHistoryPage;
      setPayload((previous) => page && previous ? { ...next, continuations: [...previous.continuations.filter((entry) => entry.source !== page.source), ...next.continuations], entries: [...new Map([...previous.entries, ...next.entries].map((entry) => [entry.id, entry])).values()] } : next);
      setSelectedId((current) => current && (page || next.entries.some((entry) => entry.id === current)) ? current : next.entries[0]?.id ?? "");
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      if (!page) setPayload(null);
      setError(cause instanceof Error ? cause.message : "Falha ao carregar o histórico documental.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [firebaseUser, source, timelineDocument]);

  // A leitura assíncrona sincroniza esta visão com as origens autorizadas.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); return invalidateRequest; }, [load, invalidateRequest]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("pt-BR");
    if (!term) return payload?.entries ?? [];
    return (payload?.entries ?? []).filter((entry) => [entry.eventLabel, entry.title, entry.subject, entry.originalName, entry.appliedName, entry.destination, entry.statusLabel]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(term));
  }, [payload?.entries, query]);
  const selected = filtered.find((entry) => entry.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-xs">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.09em] text-teal-700">Gestão documental</p><BackButton fallbackHref="/dashboard/documents" ariaLabel="Voltar ao Acervo" /><h1 className="text-xl font-black text-slate-950">Histórico</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Consulte os eventos efetivamente registrados e os estados atuais legados. Campos ausentes aparecem como não registrados.</p></div>
          <div className="flex items-center gap-2"><DocumentCreateLink /><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Atualizar</Button></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SOURCES.map((option) => <button key={option.value} type="button" onClick={() => { setTimelineDocument(null); setSource(option.value); }} className={`rounded-full border px-3 py-1.5 text-[11px] font-bold ${!timelineDocument && source === option.value ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 text-slate-500 hover:border-teal-200"}`}>{option.label}</button>)}
        </div>
        {timelineDocument ? <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs">Trilha registrada deste documento</p><Button variant="ds-secondary" size="sm" onClick={() => setTimelineDocument(null)}>Voltar ao histórico</Button></div> : null}
      </header>
      {(payload?.warnings ?? []).length ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">{payload?.warnings.map((warning) => <p key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</p>)}</div> : null}
      <div className="grid min-h-[620px] lg:grid-cols-[minmax(360px,1fr)_minmax(360px,0.82fr)]">
        <section className="min-w-0 border-r">
          <div className="border-b p-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input className="h-9 pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, destino, evento ou pessoa..." /></div></div>
          <div className="max-h-[680px] overflow-y-auto">
            {loading ? <div className="grid min-h-56 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-teal-700" /></div>
              : error ? <div className="grid min-h-56 place-items-center p-6 text-center"><div><AlertTriangle className="mx-auto h-8 w-8 text-rose-400" /><p className="mt-3 text-sm font-black">Não foi possível carregar</p><p className="mt-1 text-xs text-slate-500">{error}</p></div></div>
              : filtered.length === 0 ? <div className="grid min-h-56 place-items-center p-6 text-center"><div><FileClock className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black">Nenhum registro encontrado</p><p className="mt-1 text-xs text-slate-500">A consulta respeita as permissões de cada origem.</p></div></div>
              : filtered.map((entry) => <button type="button" key={entry.id} onClick={() => setSelectedId(entry.id)} className={`w-full border-b px-4 py-3 text-left ${selected?.id === entry.id ? "bg-teal-50" : "hover:bg-slate-50"}`}><span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate text-xs font-black text-slate-900">{entry.eventLabel}</span><span className="mt-0.5 block truncate text-[11px] text-slate-600">{entry.title}{entry.subject ? ` · ${entry.subject}` : ""}</span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${entry.recordKind === "event" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{entry.recordKind === "event" ? "Evento" : "Estado atual"}</span></span><span className="mt-2 flex justify-between text-[10px] text-slate-400"><span>{SOURCE_LABEL[entry.source] ?? entry.source}</span><span>{formatDate(entry.occurredAt)}</span></span></button>)}
          </div>
          {payload?.continuations?.length ? <div className="flex flex-wrap gap-2 p-3">{payload.continuations.map((page) => <Button key={page.source} variant="outline" disabled={loading} onClick={() => void load(page)}>Carregar mais · {SOURCE_LABEL[page.source] ?? page.source}</Button>)}</div> : null}
        </section>
        <aside className="min-w-0 bg-slate-50/60 p-4">
          {selected ? <div className="space-y-4">
            <div><p className="text-[10px] font-black uppercase tracking-wider text-teal-700">{SOURCE_LABEL[selected.source] ?? selected.source}</p><h2 className="mt-1 text-lg font-black text-slate-950">{selected.eventLabel}</h2><p className="mt-1 text-xs text-slate-500">{formatDate(selected.occurredAt)}</p></div>
            {selected.recordKind === "current_snapshot" ? <div className="rounded-lg border border-slate-200 bg-white p-3 text-[11px] leading-5 text-slate-600">Este item representa o estado atual disponível na origem. A central não criou eventos retroativos para ações que não foram registradas.</div> : null}
            <div className="grid gap-2 sm:grid-cols-2"><Value label="Documento ou processo" value={selected.title} /><Value label="Pessoa ou contraparte" value={selected.subject} /><Value label="Nome original" value={selected.originalName} /><Value label="Nome aplicado" value={selected.appliedName} /><Value label="Destino" value={selected.destination} /><Value label="Situação" value={selected.statusLabel} /><Value label="Responsável" value={selected.actorName} /><Value label="Análise" value={selected.analysisMethod ? METHOD_LABEL[selected.analysisMethod] : null} /></div>
            {selected.detail ? <div className="rounded-lg border bg-white p-3 text-[11px] leading-5 text-slate-600">{selected.detail}</div> : null}
            {!timelineDocument && selected.documentRef && ["company", "employee_upload"].includes(selected.documentRef.source) ? <Button variant="ds-secondary" className="w-full" onClick={() => { setQuery(""); setTimelineDocument(selected.documentRef!); }}>Ver trilha do documento</Button> : null}
            <Button asChild className="w-full bg-teal-700 hover:bg-teal-800"><Link href={selected.href}>Abrir na origem<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
          </div> : <div className="grid min-h-56 place-items-center text-center"><p className="text-xs text-slate-500">Selecione um registro para conferir os dados preservados.</p></div>}
        </aside>
      </div>
    </div>
  );
}
