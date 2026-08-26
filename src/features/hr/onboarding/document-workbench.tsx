"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Download, ExternalLink, FileText, Loader2, RotateCcw, Sparkles, XCircle } from "lucide-react";

import type { OnboardingDocument } from "@/types";

type DocumentFilter = "all" | "pending" | "approved" | "rejected" | "waiting";

type DocumentWorkbenchProps = {
  documents: OnboardingDocument[];
  canReview: boolean;
  disabled?: boolean;
  busyAction?: string | null;
  onStatusChange: (documentId: string, status: OnboardingDocument["status"], note?: string) => Promise<unknown> | unknown;
  onBulkStatusChange: (documentIds: string[], status: "approved" | "rejected", note?: string) => Promise<unknown> | unknown;
  onConfirmField: (documentId: string, fieldKey: string) => Promise<unknown> | unknown;
};

const STATUS_LABELS: Record<OnboardingDocument["status"], string> = {
  pending: "Aguardando envio",
  received: "Enviado",
  ai_approved: "Pré-aprovado pelo copiloto",
  review_required: "Revisão necessária",
  approved: "Aprovado pelo RH",
  rejected: "Reprovado",
};

const REJECTION_REASONS = [
  "Documento ilegível ou cortado",
  "Documento incorreto",
  "Documento vencido",
  "Dados divergentes do formulário",
];

function hasFile(document: OnboardingDocument) {
  return Boolean(document.fileUrl || document.filePath);
}

function filterMatches(document: OnboardingDocument, filter: DocumentFilter) {
  if (filter === "all") return true;
  if (filter === "approved") return document.status === "approved";
  if (filter === "rejected") return document.status === "rejected";
  if (filter === "waiting") return !hasFile(document) || document.status === "pending";
  return hasFile(document) && !["approved", "rejected"].includes(document.status);
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Não identificado";
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function confidenceTone(confidence?: number) {
  if (confidence === undefined) return { label: "—", className: "bg-stone-100 text-stone-500" };
  const percentage = Math.round(confidence <= 1 ? confidence * 100 : confidence);
  if (percentage >= 90) return { label: `${percentage}%`, className: "bg-emerald-100 text-emerald-700" };
  if (percentage >= 75) return { label: `${percentage}%`, className: "bg-amber-100 text-amber-700" };
  return { label: `${percentage}%`, className: "bg-rose-100 text-rose-700" };
}

export function OnboardingDocumentWorkbench({
  documents,
  canReview,
  disabled = false,
  busyAction,
  onStatusChange,
  onBulkStatusChange,
  onConfirmField,
}: DocumentWorkbenchProps) {
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(documents[0]?.id ?? null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState(false);
  const [bulkRejecting, setBulkRejecting] = useState(false);
  const filtered = useMemo(() => documents.filter((document) => filterMatches(document, filter)), [documents, filter]);
  const selected = documents.find((document) => document.id === selectedId) ?? filtered[0] ?? documents[0] ?? null;
  const actionable = documents.filter((document) => hasFile(document) && !["approved", "rejected"].includes(document.status));
  const approved = documents.filter((document) => document.status === "approved").length;
  const counts = {
    all: documents.length,
    pending: actionable.length,
    approved,
    rejected: documents.filter((document) => document.status === "rejected").length,
    waiting: documents.filter((document) => !hasFile(document) || document.status === "pending").length,
  };

  useEffect(() => {
    if (selectedId && documents.some((document) => document.id === selectedId)) return;
    setSelectedId(documents[0]?.id ?? null);
  }, [documents, selectedId]);

  useEffect(() => {
    setCheckedIds((current) => current.filter((id) => actionable.some((document) => document.id === id)));
  }, [documents]);

  function toggleChecked(documentId: string) {
    setCheckedIds((current) => current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]);
  }

  async function bulkDecision(status: "approved" | "rejected", note?: string) {
    await onBulkStatusChange(checkedIds, status, note);
    setCheckedIds([]);
    setBulkRejecting(false);
  }

  if (!documents.length) {
    return <div className="rounded-[20px] border border-dashed border-stone-300 bg-white p-8 text-center text-sm font-semibold text-stone-500">Nenhum documento configurado para esta integração.</div>;
  }

  const extracted = selected ? Object.entries(selected.extractedFields ?? {}) : [];
  const selectedHasFile = selected ? hasFile(selected) : false;
  const selectedCanAct = Boolean(selected && selectedHasFile && canReview && !disabled);

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#e2ded6] bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f3f1ec] px-4 py-3.5">
        <div><p className="text-[10px] font-black uppercase tracking-[0.09em] text-stone-500">Documentação obrigatória</p><h4 className="mt-1 text-sm font-black tracking-[-0.02em] text-slate-950">Conferência do RH</h4></div>
        <span className={`rounded-xl px-3 py-1.5 text-[11px] font-black ${approved === documents.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{approved}/{documents.length} aprovados</span>
      </header>

      <div className="border-b border-[#f3f1ec] bg-[#fdfcfa] px-4 py-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-[#eeebe4]"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${documents.length ? (approved / documents.length) * 100 : 0}%` }} /></div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(["all", "pending", "approved", "rejected", "waiting"] as DocumentFilter[]).map((value) => {
            const labels: Record<DocumentFilter, string> = { all: "Todos", pending: "Para revisar", approved: "Aprovados", rejected: "Reprovados", waiting: "Aguardando" };
            return <button key={value} type="button" onClick={() => setFilter(value)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-black ${filter === value ? "border-pink-200 bg-pink-50 text-pink-700" : "border-stone-200 bg-white text-stone-600"}`}>{labels[value]}<span className="rounded-md bg-current/10 px-1.5 py-0.5 font-mono text-[9px]">{counts[value]}</span></button>;
          })}
          <span className="flex-1" />
          {actionable.length ? <button type="button" disabled={!canReview || disabled} onClick={() => setCheckedIds(checkedIds.length === actionable.length ? [] : actionable.map((document) => document.id))} className="h-8 rounded-lg border border-dashed border-stone-300 bg-white px-2.5 text-[10.5px] font-black text-stone-600 disabled:opacity-50">{checkedIds.length === actionable.length ? "Limpar seleção" : "Selecionar pendentes"}</button> : null}
        </div>
        {checkedIds.length ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-slate-950 px-3 py-2.5 text-white">
            <span className="text-[11.5px] font-black">{checkedIds.length} selecionado{checkedIds.length === 1 ? "" : "s"}</span><span className="flex-1" />
            {bulkRejecting ? REJECTION_REASONS.map((reason) => <button key={reason} type="button" disabled={Boolean(busyAction)} onClick={() => void bulkDecision("rejected", reason)} className="h-8 rounded-lg border border-rose-400/30 px-2.5 text-[10px] font-bold text-rose-200 hover:bg-rose-950">{reason}</button>) : <button type="button" onClick={() => setBulkRejecting(true)} className="h-8 rounded-lg border border-rose-400/30 px-3 text-[10.5px] font-black text-rose-200">Reprovar em lote</button>}
            <button type="button" disabled={Boolean(busyAction)} onClick={() => void bulkDecision("approved")} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[10.5px] font-black text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" />Aprovar em lote</button>
          </div>
        ) : null}
      </div>

      <div className="grid lg:grid-cols-[minmax(250px,.85fr)_minmax(0,1.4fr)]">
        <div className="max-h-[620px] space-y-1.5 overflow-y-auto border-b border-[#f3f1ec] p-2 lg:border-b-0 lg:border-r">
          {filtered.map((document) => {
            const active = selected?.id === document.id;
            const selectable = hasFile(document) && !["approved", "rejected"].includes(document.status);
            const stateTone = document.status === "approved" ? "text-emerald-700" : document.status === "rejected" ? "text-rose-700" : hasFile(document) ? "text-amber-700" : "text-stone-400";
            return (
              <div key={document.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition ${active ? "border-pink-200 bg-pink-50" : "border-stone-100 bg-white hover:border-stone-200"}`}>
                {selectable && canReview ? <button type="button" onClick={() => toggleChecked(document.id)} className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${checkedIds.includes(document.id) ? "border-pink-600 bg-pink-600 text-white" : "border-stone-300 bg-white text-transparent"}`} aria-label={`Selecionar ${document.label}`}><Check className="h-3 w-3" /></button> : <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${document.status === "approved" ? "bg-emerald-100 text-emerald-700" : document.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-stone-100 text-stone-400"}`}>{document.status === "approved" ? <Check className="h-3 w-3" /> : document.status === "rejected" ? <XCircle className="h-3 w-3" /> : <FileText className="h-3 w-3" />}</span>}
                <button type="button" onClick={() => { setSelectedId(document.id); setRejecting(false); }} className="min-w-0 flex-1 text-left"><span className="block truncate text-[11.5px] font-black text-slate-800">{document.label}{document.required !== false ? <span className="text-pink-600"> *</span> : null}</span><span className={`mt-0.5 block text-[10px] font-bold ${stateTone}`}>{STATUS_LABELS[document.status]}</span></button>
                {active ? <span className="h-6 w-1 shrink-0 rounded-full bg-pink-600" /> : null}
              </div>
            );
          })}
          {!filtered.length ? <p className="p-6 text-center text-xs font-semibold text-stone-400">Nenhum documento neste filtro.</p> : null}
        </div>

        {selected ? (
          <div className="space-y-3 bg-[#faf9f6] p-3.5">
            <div className="flex items-center gap-2"><h5 className="min-w-0 flex-1 truncate text-xs font-black text-slate-900">{selected.label}</h5>{selected.fileUrl ? <><a href={selected.fileUrl} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600" aria-label="Abrir documento em nova aba"><ExternalLink className="h-3.5 w-3.5" /></a><a href={selected.fileUrl} download className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600" aria-label="Baixar documento"><Download className="h-3.5 w-3.5" /></a></> : null}</div>
            <div className="min-h-[260px] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              {selected.fileUrl ? <iframe src={selected.fileUrl} title={`Pré-visualização de ${selected.label}`} className="h-[330px] w-full bg-white" /> : <div className="grid h-[260px] place-items-center p-8 text-center"><span><FileText className="mx-auto h-8 w-8 text-stone-300" /><span className="mt-2 block text-xs font-bold text-stone-500">Aguardando o envio deste documento.</span></span></div>}
            </div>

            {extracted.length ? (
              <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
                <div className="flex items-center gap-2 text-blue-800"><Sparkles className="h-4 w-4" /><span className="text-[11px] font-black uppercase tracking-wide">Dados extraídos pelo copiloto</span></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {extracted.map(([key, value]) => {
                    const confidence = confidenceTone(selected.fieldConfidences?.[key]);
                    const confirmed = selected.confirmedExtractedFields?.includes(key) ?? false;
                    const rawConfidence = selected.fieldConfidences?.[key];
                    const lowConfidence = typeof rawConfidence === "number" && (rawConfidence <= 1 ? rawConfidence < .9 : rawConfidence < 90);
                    return <div key={key} className={`rounded-lg border bg-white p-2.5 ${lowConfidence && !confirmed ? "border-amber-300" : "border-blue-100"}`}><span className="block truncate text-[9px] font-black uppercase tracking-wide text-stone-400">{key.replaceAll("_", " ")}</span><span className="mt-1 flex items-start gap-2"><span className="min-w-0 flex-1 break-words font-mono text-[11px] font-bold text-slate-800">{valueText(value)}</span><span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black ${confidence.className}`}>{confidence.label}</span></span>{lowConfidence ? confirmed ? <span className="mt-1.5 inline-flex items-center gap-1 text-[9.5px] font-black text-emerald-700"><CheckCircle2 className="h-3 w-3" />Valor confirmado pelo RH</span> : <button type="button" disabled={!canReview || disabled || Boolean(busyAction)} onClick={() => void onConfirmField(selected.id, key)} className="mt-2 h-7 w-full rounded-lg border border-amber-300 bg-amber-50 text-[9.5px] font-black uppercase tracking-wide text-amber-700 disabled:opacity-50">Confirmar valor</button> : null}</div>;
                  })}
                </div>
              </div>
            ) : null}

            {selected.status === "approved" || selected.status === "rejected" ? (
              <div className={`flex items-center gap-2 rounded-xl border p-3 ${selected.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>{selected.status === "approved" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}<span className="min-w-0 flex-1 text-xs font-black">{selected.status === "approved" ? "Documento aprovado" : selected.note || "Documento reprovado"}</span>{canReview && !disabled ? <button type="button" disabled={Boolean(busyAction)} onClick={() => void onStatusChange(selected.id, "received")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-current/20 bg-white px-2.5 text-[10px] font-black"><RotateCcw className="h-3 w-3" />Desfazer</button> : null}</div>
            ) : selectedHasFile ? rejecting ? (
              <div className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3"><div className="flex items-center justify-between"><span className="text-xs font-black text-rose-800">Motivo da reprovação</span><button type="button" onClick={() => setRejecting(false)} className="text-[10px] font-black text-rose-700">Cancelar</button></div>{REJECTION_REASONS.map((reason) => <button key={reason} type="button" disabled={Boolean(busyAction)} onClick={() => void onStatusChange(selected.id, "rejected", reason)} className="block h-9 w-full rounded-lg border border-rose-200 bg-white px-3 text-left text-[11px] font-bold text-rose-800 disabled:opacity-50">{reason}</button>)}</div>
            ) : (
              <div className="flex gap-2"><button type="button" disabled={!selectedCanAct || Boolean(busyAction)} onClick={() => setRejecting(true)} className="h-10 flex-1 rounded-xl border border-rose-200 bg-white text-xs font-black text-rose-700 disabled:opacity-50">Reprovar documento</button><button type="button" disabled={!selectedCanAct || Boolean(busyAction)} onClick={() => void onStatusChange(selected.id, "approved")} className="inline-flex h-10 flex-[1.2] items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-black text-white disabled:opacity-50">{busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Aprovar documento</button></div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
