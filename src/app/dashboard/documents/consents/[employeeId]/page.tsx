"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Loader2, Plus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHero } from "@/components/patterns/page-hero";
import { StatusPill } from "@/components/ui/status-pill";
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

  if (!canView) return <p className="p-6 text-sm text-ds-ink-muted">Sem permissão para consultar consentimentos.</p>;
  if (loading) return <div className="grid min-h-52 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-ds-accent-ink" /></div>;

  return (
    <div className="space-y-4">
      <PageHero
        kicker="Departamento pessoal"
        title={`Imagem e voz — ${employeeName || fallbackEmployeeName}`}
        subtitle="Decisão vigente, prova da manifestação e inventário dos usos operacionais."
        actions={<Button asChild variant="ds-secondary" size="md"><Link href="/dashboard/dp/collaborators"><ArrowLeft className="mr-2 h-4 w-4" />Voltar aos colaboradores</Link></Button>}
      />
      {message ? <div className="rounded-ds-btn bg-ds-danger-bg px-3 py-2 text-xs font-semibold text-ds-danger" role="alert">{message}</div> : null}
      {notice ? <div className="rounded-ds-btn bg-ds-ok-bg px-3 py-2 text-xs font-semibold text-ds-ok" role="status">{notice}</div> : null}

      <section className="grid gap-3 rounded-ds-card border border-ds-border bg-ds-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Estado</p><p className="mt-1 font-black text-ds-ink">{consent ? STATUS_LABELS[consent.status] : "—"}</p></div>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Decisão</p><p className="mt-1 text-sm font-semibold">{formatDate(consent?.decisionAt)}</p></div>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Canal</p><p className="mt-1 text-sm font-semibold">{consent?.decisionChannel || "—"}</p></div>
        <div><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Efeito operacional</p><p className="mt-1 text-sm font-semibold">{consent?.operationalEffectStatus ?? "—"}</p></div>
        <div className="sm:col-span-2"><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Termo</p><p className="mt-1 break-all text-xs">Versão {consent?.termVersion || "—"} · hash {consent?.termHash || "—"}</p></div>
        <div className="sm:col-span-2"><p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-ds-ink-faint">Revogação</p><p className="mt-1 text-xs">{formatDate(consent?.revokedAt)}{consent?.revocationReason ? ` · ${consent.revocationReason}` : ""}</p></div>
      </section>

      {canManage ? (
        <section className="rounded-ds-card border border-ds-border bg-ds-surface">
          <header className="border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-black"><Plus className="h-4 w-4 text-ds-accent-ink" />Registrar publicação</h2></header>
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

      <section className="rounded-ds-card border border-ds-border bg-ds-surface">
        <header className="border-b px-4 py-3"><h2 className="flex items-center gap-2 text-sm font-black"><ShieldCheck className="h-4 w-4 text-ds-accent-ink" />Inventário de usos</h2></header>
        {!consent?.usages.length ? (
          <p className="p-6 text-center text-xs text-ds-ink-muted">Nenhum uso registrado.</p>
        ) : (
          <div className="divide-y">
            {consent.usages.map((usage) => (
              <div key={usage.usageId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-ds-ink">{usage.channel}</p>
                  <p className="break-all text-xs text-ds-ink-muted">{usage.asset}</p>
                  <p className="text-[10px] text-ds-ink-faint">Publicado em {formatDate(usage.publishedAt)} · registrado em {formatDate(usage.registeredAt)}</p>
                </div>
                {usage.removedAt ? (
                  <StatusPill variant="ok" className="gap-1"><CheckCircle2 className="h-3 w-3" />Retirado em {formatDate(usage.removedAt)}</StatusPill>
                ) : canManage ? (
                  <Button size="sm" variant="outline" className="text-xs text-ds-danger" disabled={busy} onClick={() => void action({ action: "mark_removed", usageId: usage.usageId })}>Registrar retirada</Button>
                ) : (
                  <StatusPill variant="warn">Em circulação</StatusPill>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
