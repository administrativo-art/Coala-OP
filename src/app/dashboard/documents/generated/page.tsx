"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Eye, FileStack, Loader2, Lock, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";

type GeneratedDocument = {
  id: string;
  templateId: string;
  templateName?: string;
  employeeId?: string | null;
  employeeName?: string | null;
  onboardingId?: string | null;
  status: string;
  pdfAvailable?: boolean;
  generatedAt?: string;
  generatedByName?: string;
};

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

export default function GeneratedDocumentsPage() {
  const { firebaseUser, permissions } = useAuth();
  const canView = hasFormalizationPermission(permissions, "documents.view");
  const canReview = hasFormalizationPermission(permissions, "documents.review");
  const [documents, setDocuments] = useState<GeneratedDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "final">("all");
  const [busyDocument, setBusyDocument] = useState<string | null>(null);

  const token = useCallback(async () => {
    if (!firebaseUser) throw new Error("Sessão expirada.");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser || !canView) return;
    setLoading(true);
    try {
      const response = await fetch("/api/documents/generated", { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar documentos gerados.");
      setDocuments(payload.documents ?? []);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar documentos gerados.");
    } finally {
      setLoading(false);
    }
  }, [canView, firebaseUser, token]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return documents.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!term) return true;
      return `${item.templateName ?? ""} ${item.employeeName ?? ""}`.toLocaleLowerCase("pt-BR").includes(term);
    });
  }, [documents, search, statusFilter]);

  async function openFile(id: string, format: "pdf" | "docx") {
    setBusyDocument(id);
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}/file${format === "pdf" ? "?format=pdf" : ""}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao abrir o arquivo.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      if (format === "pdf") window.open(url, "_blank", "noopener");
      else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "documento.docx";
        anchor.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao abrir o arquivo.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function finalize(id: string) {
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ status: "final" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao finalizar.");
      setDocuments((current) => current.map((item) => (item.id === id ? { ...item, ...payload.document } : item)));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao finalizar.");
    } finally {
      setBusyDocument(null);
    }
  }

  async function discard(id: string) {
    if (!window.confirm("Descartar esta prévia? O arquivo será excluído.")) return;
    setBusyDocument(id);
    setMessage("");
    try {
      const response = await fetch(`/api/documents/generated/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await token()}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao descartar.");
      setDocuments((current) => current.filter((item) => item.id !== id));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao descartar.");
    } finally {
      setBusyDocument(null);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para acessar documentos gerados.</p>;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">Documentos</p>
        <h1 className="text-xl font-black text-slate-950">Documentos gerados</h1>
        <p className="text-xs text-slate-500">Prévias em conferência e documentos finalizados a partir dos <Link className="font-bold text-teal-700" href="/dashboard/documents/templates">modelos</Link>.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1 rounded-lg border bg-white p-2 shadow-sm">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="h-9 pl-9 text-sm" placeholder="Buscar por modelo ou colaborador..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="h-[52px] rounded-lg border bg-white px-3 text-sm shadow-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">Todos os estados</option>
          <option value="draft">Em conferência</option>
          <option value="final">Finalizados</option>
        </select>
      </div>
      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {loading ? (
        <div className="grid min-h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div>
      ) : filtered.length === 0 ? (
        <div className="grid min-h-52 place-items-center rounded-lg border border-dashed bg-white p-8 text-center">
          <div><FileStack className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-black text-slate-700">Nenhum documento gerado</p></div>
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-white shadow-sm">
          {filtered.map((item) => {
            const isDraft = item.status === "draft";
            const busy = busyDocument === item.id;
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <FileStack className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800">
                    <Link className="hover:underline" href={`/dashboard/documents/templates/${encodeURIComponent(item.templateId)}`}>{item.templateName ?? "Modelo"}</Link>
                    {" · "}{item.employeeName ?? item.employeeId ?? item.onboardingId ?? "—"}
                  </p>
                  <p className="text-[11px] text-slate-500">{formatDateTime(item.generatedAt)} · por {item.generatedByName ?? "—"}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${isDraft ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {isDraft ? "Em conferência" : "Finalizado"}
                </span>
                <div className="flex shrink-0 gap-1">
                  {item.pdfAvailable ? (
                    <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => void openFile(item.id, "pdf")}><Eye className="h-3.5 w-3.5" />PDF</Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" disabled={busy} onClick={() => void openFile(item.id, "docx")}><Download className="h-3.5 w-3.5" />DOCX</Button>
                  {isDraft && canReview ? (
                    <>
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-emerald-700" disabled={busy} onClick={() => void finalize(item.id)}><Lock className="h-3.5 w-3.5" />Finalizar</Button>
                      <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs text-rose-600" disabled={busy} onClick={() => void discard(item.id)}><Trash2 className="h-3.5 w-3.5" />Descartar</Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
