"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, PackageCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";

type ResponsibleAsset = {
  id: string; code: string | null; name: string | null; category: string | null; subcategory: string | null;
  brand: string | null; model: string | null; assetTag: string | null; status: string | null;
  custody?: { since?: string; holderNameSnapshot?: string } | null;
  currentLocation?: { nameSnapshot?: string } | null;
};

export function CollaboratorAssets({ userId }: { userId: string }) {
  const [items, setItems] = useState<ResponsibleAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/assets`, { headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os equipamentos.");
      setItems(Array.isArray(payload.items) ? payload.items : []); setTruncated(payload.truncated === true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar equipamentos."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [userId]);

  if (loading) return <div aria-label="Carregando equipamentos" className="space-y-2"><div className="h-16 animate-pulse rounded-xl bg-ds-neutral-bg" /><div className="h-16 animate-pulse rounded-xl bg-ds-neutral-bg" /></div>;
  if (error) return <div role="alert" className="rounded-xl border border-ds-danger-bg bg-ds-danger-bg/40 p-3 text-sm text-ds-danger">{error}<Button type="button" variant="ghost" size="sm" className="ml-2" onClick={() => void load()}>Tentar novamente</Button></div>;
  if (items.length === 0) return <div className="rounded-xl border border-dashed p-5 text-center"><PackageCheck className="mx-auto h-6 w-6 text-ds-ink-faint" /><p className="mt-2 text-sm font-semibold text-ds-ink-muted">Nenhum equipamento sob responsabilidade.</p></div>;

  return <div className="space-y-2">
    {items.map((asset) => <Link key={asset.id} href={`/dashboard/financial/assets?search=${encodeURIComponent(asset.code || asset.name || asset.id)}`} className="flex items-center justify-between gap-3 rounded-xl border border-ds-divider bg-ds-input p-3 transition hover:border-ds-accent/40 hover:bg-ds-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent">
      <div className="min-w-0"><p className="truncate text-sm font-black text-ds-ink">{asset.name || "Equipamento"}</p><p className="truncate text-xs font-semibold text-ds-ink-muted">{[asset.code, asset.subcategory || asset.category, [asset.brand, asset.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</p><p className="mt-1 text-xs text-ds-ink-faint">{asset.currentLocation?.nameSnapshot || "Local não informado"}{asset.custody?.since ? ` · desde ${new Date(asset.custody.since).toLocaleDateString("pt-BR")}` : ""}</p></div><ExternalLink className="h-4 w-4 shrink-0 text-ds-ink-faint" />
    </Link>)}
    {truncated ? <p className="text-xs text-ds-warn">A lista atingiu o limite de 100 equipamentos. Consulte Patrimônio para a relação completa.</p> : null}
  </div>;
}
