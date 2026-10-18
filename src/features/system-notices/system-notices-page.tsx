"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { errorMessageOf } from "@/components/patterns/panel-form";
import { Segmented } from "@/components/patterns/segmented";
import { Button } from "@/components/ui/button";
import { StatusPill, type StatusPillVariant } from "@/components/ui/status-pill";
import { useAuth } from "@/hooks/use-auth";
import { authenticatedApiRequest } from "@/lib/authenticated-api-client";

type Severity = "info" | "warning" | "critical";
type Notice = {
  id: string; category: string; severity: Severity; title: string; body: string; path: string | null;
  status: "open" | "resolved"; createdAt: string; resolvedAt: string | null; resolvedReason: string | null;
};
type Payload = { notices: Notice[]; nextCursor: string | null };
type Status = "open" | "resolved";

const severityLabel: Record<Severity, { label: string; variant: StatusPillVariant }> = {
  critical: { label: "Crítico", variant: "danger" },
  warning: { label: "Atenção", variant: "warn" },
  info: { label: "Informativo", variant: "info" },
};
const categoryLabel: Record<string, string> = {
  "rep-p.certificate": "Certificado do ponto",
  "rep-p.receipts": "Comprovantes do ponto",
  "rep-p.norms-review": "Normas do ponto",
};

function brDateTime(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso));
}

export function SystemNoticesPage() {
  const { firebaseUser, permissions, isDefaultAdmin } = useAuth();
  const canView = isDefaultAdmin || (permissions.settings.view && permissions.settings.viewSystemNotices);
  const [status, setStatus] = useState<Status>("open");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor: string | null) => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ status, ...(nextCursor ? { cursor: nextCursor } : {}) });
      const payload = await authenticatedApiRequest<Payload>(`/api/system-notices?${query}`, {
        getIdToken: () => firebaseUser.getIdToken(), fallbackError: "Não foi possível carregar os avisos.",
      });
      setNotices((current) => nextCursor ? [...current, ...payload.notices] : payload.notices);
      setCursor(payload.nextCursor);
    } catch (cause) {
      setError(errorMessageOf(cause, "Não foi possível carregar os avisos."));
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, status]);

  useEffect(() => { if (canView) void load(null); }, [canView, load]);

  if (!canView) return <p className="p-6 text-ds-ink-muted">Sem permissão para ver os avisos do sistema.</p>;

  return (
    <PageContainer variant="compact" className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-ds-ink">Avisos do sistema</h1>
        <Segmented<Status> aria-label="Situação dos avisos" value={status} onChange={setStatus}
          options={[{ value: "open", label: "Abertos" }, { value: "resolved", label: "Resolvidos" }]} />
      </div>
      <p className="text-sm text-ds-ink-muted">
        Você vê apenas os avisos dos módulos em que tem permissão para agir.
      </p>
      {error ? <p role="alert" className="text-sm font-semibold text-ds-danger">{error}</p> : null}
      <section className="rounded-ds-card border border-ds-border bg-ds-surface">
        {loading && notices.length === 0 ? (
          <p className="flex items-center gap-2 p-5 text-sm text-ds-ink-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Carregando avisos…</p>
        ) : notices.length === 0 ? (
          <p className="p-5 text-sm text-ds-ink-muted">{status === "open" ? "Nenhum aviso aberto." : "Nenhum aviso resolvido."}</p>
        ) : (
          <ul className="divide-y divide-ds-divider">
            {notices.map((notice) => (
              <li key={notice.id} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill variant={severityLabel[notice.severity].variant}>{severityLabel[notice.severity].label}</StatusPill>
                  <span className="text-xs font-bold text-ds-ink-muted">{categoryLabel[notice.category] ?? notice.category}</span>
                  <span className="text-xs text-ds-ink-faint">· {brDateTime(notice.createdAt)}</span>
                </div>
                <p className="text-sm font-extrabold text-ds-ink">{notice.title}</p>
                <p className="text-sm text-ds-ink-2">{notice.body}</p>
                {notice.status === "resolved" && notice.resolvedAt ? (
                  <p className="text-xs text-ds-ink-muted">Resolvido em {brDateTime(notice.resolvedAt)}</p>
                ) : null}
                {notice.path && notice.path !== "/dashboard/system-notices" ? (
                  <Link href={notice.path} className="text-xs font-bold text-ds-accent-ink hover:underline">Abrir área relacionada</Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {cursor ? (
        <Button type="button" variant="ds-secondary" size="sm" loading={loading} loadingLabel="Carregando…" onClick={() => load(cursor)}>
          Carregar mais avisos
        </Button>
      ) : null}
    </PageContainer>
  );
}
