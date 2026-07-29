"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Loader2, Plus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { hasFormalizationPermission } from "@/lib/hr-formalization-permissions";
import type { ImageVoiceConsentState } from "@/features/hr/consents/image-voice-consent";

const STATUS_LABELS = {
  granted: "Autorizado",
  denied: "Não autorizado",
  revoked: "Revogado",
} as const;

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString("pt-BR");
}

export default function ImageVoiceConsentManagementPage() {
  const params = useParams<{ employeeId: string }>();
  const employeeId = decodeURIComponent(params.employeeId ?? "");
  const { firebaseUser, permissions, activeUsers } = useAuth();
  const canView = hasFormalizationPermission(permissions, "consents.view");
  const canManage = hasFormalizationPermission(permissions, "consents.manage");
  const [consent, setConsent] = useState<ImageVoiceConsentState | null>(null);
  const [channel, setChannel] = useState("");
  const [asset, setAsset] = useState("");
  const [publishedAt, setPublishedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const fallbackEmployeeName = useMemo(
    () => activeUsers.find((user) => user.id === employeeId)?.username ?? employeeId,
    [activeUsers, employeeId],
  );
  const [employeeName, setEmployeeName] = useState("");

  const token = useCallback(async () => {
    if (!firebaseUser) throw new Error("Sessão expirada.");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser || !canView || !employeeId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/hr/consents/image-voice/${encodeURIComponent(employeeId)}`, {
        headers: { Authorization: `Bearer ${await token()}` },
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar consentimento.");
      setConsent(payload.consent);
      setEmployeeName(typeof payload.employeeName === "string" && payload.employeeName.trim()
        ? payload.employeeName
        : fallbackEmployeeName);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao carregar consentimento.");
    } finally {
      setLoading(false);
    }
  }, [canView, employeeId, fallbackEmployeeName, firebaseUser, token]);

  useEffect(() => { void load(); }, [load]);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    setNotice("");
    try {
      const response = await fetch(`/api/hr/consents/image-voice/${encodeURIComponent(employeeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao atualizar inventário.");
      setConsent(payload.consent);
      setChannel("");
      setAsset("");
      setNotice(body.action === "register_usage" ? "Uso registrado." : "Retirada registrada.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao atualizar inventário.");
    } finally {
      setBusy(false);
    }
  }

  if (!canView) return <p className="p-6 text-sm text-slate-500">Sem permissão para consultar consentimentos.</p>;
  if (loading) return <div className="grid min-h-52 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-teal-700" /></div>;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dashboard/dp/collaborators" className="inline-flex items-center gap-1 text-xs font-bold text-teal-700">
          <ArrowLeft className="h-3.5 w-3.5" />Voltar aos colaboradores
        </Link>
        <h1 className="mt-1 text-xl font-black text-slate-950">Imagem e voz — {employeeName || fallbackEmployeeName}</h1>
        <p className="text-xs text-slate-500">Decisão vigente, prova da manifestação e inventário dos usos operacionais.</p>
      </div>
      {message ? <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{message}</div> : null}
      {notice ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{notice}</div> : null}

      <section className="grid gap-3 rounded-xl border bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-[10px] font-bold uppercase text-slate-400">Estado</p><p className="mt-1 font-black text-slate-900">{consent ? STATUS_LABELS[consent.status] : "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase text-slate-400">Decisão</p><p className="mt-1 text-sm font-semibold">{formatDate(consent?.decisionAt)}</p></div>
        <div><p className="text-[10px] font-bold uppercase text-slate-400">Canal</p><p className="mt-1 text-sm font-semibold">{consent?.decisionChannel || "—"}</p></div>
        <div><p className="text-[10px] font-bold uppercase text-slate-400">Efeito operacional</p><p className="mt-1 text-sm font-semibold">{consent?.operationalEffectStatus ?? "—"}</p></div>
        <div className="sm:col-span-2"><p className="text-[10px] font-bold uppercase text-slate-400">Termo</p><p className="mt-1 break-all text-xs">Versão {consent?.termVersion || "—"} · hash {consent?.termHash || "—"}</p></div>
        <div className="sm:col-span-2"><p className="text-[10px] font-bold uppercase text-slate-400">Revogação</p><p className="mt-1 text-xs">{formatDate(consent?.revokedAt)}{consent?.revocationReason ? ` · ${consent.revocationReason}` : ""}</p></div>
      </section>

      {canManage ? (
        <section className="rounded-xl border bg-white shadow-sm">
          <header className="border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-black"><Plus className="h-4 w-4 text-teal-700" />Registrar publicação</h2></header>
          <div className="grid gap-3 p-4 md:grid-cols-4">
            <Input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="Canal: Instagram, site..." />
            <Input className="md:col-span-2" value={asset} onChange={(event) => setAsset(event.target.value)} placeholder="Ativo, campanha ou URL interna" />
            <Input type="date" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} />
            <div className="md:col-span-4 flex justify-end">
              <Button disabled={busy || consent?.status !== "granted" || !channel.trim() || !asset.trim()} onClick={() => void action({ action: "register_usage", channel, asset, publishedAt })}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}Registrar uso
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-white shadow-sm">
        <header className="border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-black"><ShieldCheck className="h-4 w-4 text-violet-700" />Inventário de usos</h2></header>
        {!consent?.usages.length ? (
          <p className="p-6 text-center text-xs text-slate-500">Nenhum uso registrado.</p>
        ) : (
          <div className="divide-y">
            {consent.usages.map((usage) => (
              <div key={usage.usageId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800">{usage.channel}</p>
                  <p className="break-all text-xs text-slate-600">{usage.asset}</p>
                  <p className="text-[10px] text-slate-400">Publicado em {formatDate(usage.publishedAt)} · registrado em {formatDate(usage.registeredAt)}</p>
                </div>
                {usage.removedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" />Retirado em {formatDate(usage.removedAt)}</span>
                ) : canManage ? (
                  <Button size="sm" variant="outline" className="text-xs text-rose-700" disabled={busy} onClick={() => void action({ action: "mark_removed", usageId: usage.usageId })}>Registrar retirada</Button>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Em circulação</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
