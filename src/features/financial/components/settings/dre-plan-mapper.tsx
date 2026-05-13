"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { auth } from "@/lib/firebase";
import { financialDb } from "@/lib/firebase-financial";
import { fetchWithTimeout } from "@/lib/fetch-utils";
import { DRE_CATEGORIES } from "@/features/financial/lib/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

type RawPlan = {
  id: string;
  name: string;
  parentId?: string | null;
  dreCategory?: string | null;
  order?: number;
};

type FlatPlan = RawPlan & { depth: number; number: string };

function flatten(plans: RawPlan[], parentId: string | null = null, depth = 0, prefix = ""): FlatPlan[] {
  const children = plans
    .filter((p) => (p.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const result: FlatPlan[] = [];
  children.forEach((p, i) => {
    const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
    result.push({ ...p, depth, number });
    result.push(...flatten(plans, p.id, depth + 1, number));
  });
  return result;
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  DRE_CATEGORIES.map((c) => [c.value, c.label])
);

const CATEGORY_COLOR: Record<string, string> = Object.fromEntries(
  DRE_CATEGORIES.map((c) => [c.value, c.color])
);

export function DrePlanMapper({ canManage = true }: { canManage?: boolean }) {
  const [plans, setPlans] = useState<RawPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [showOnlyUncategorized, setShowOnlyUncategorized] = useState(false);

  const load = useCallback(async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetchWithTimeout("/api/financial/data?path=accountPlans", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Falha ao carregar planos.");
      const loaded = (payload.docs ?? []) as RawPlan[];
      setPlans(loaded);
      // initialize draft from existing values
      const initial: Record<string, string | null> = {};
      loaded.forEach((p) => { initial[p.id] = p.dreCategory ?? null; });
      setDraft(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const flat = useMemo(() => flatten(plans), [plans]);

  const visible = useMemo(
    () => showOnlyUncategorized ? flat.filter((p) => !draft[p.id]) : flat,
    [flat, draft, showOnlyUncategorized]
  );

  const dirtyIds = useMemo(
    () => plans.filter((p) => (p.dreCategory ?? null) !== draft[p.id]).map((p) => p.id),
    [plans, draft]
  );

  const mappedCount = useMemo(
    () => Object.values(draft).filter(Boolean).length,
    [draft]
  );

  function setCategory(planId: string, value: string | null) {
    setDraft((prev) => ({ ...prev, [planId]: value }));
  }

  async function save() {
    if (dirtyIds.length === 0 || !auth.currentUser) return;
    setSaving(true);
    try {
      const batch = writeBatch(financialDb);
      dirtyIds.forEach((id) => {
        batch.update(doc(financialDb, "accountPlans", id), {
          dreCategory: draft[id] ?? null,
        });
      });
      await batch.commit();
      // reflect saved state
      setPlans((prev) => prev.map((p) => dirtyIds.includes(p.id) ? { ...p, dreCategory: draft[p.id] } : p));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Mapeamento DRE</CardTitle>
            <CardDescription>
              Associe cada plano de contas a uma linha da DRE para categorização automática das despesas.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {mappedCount} / {plans.length} mapeados
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: plans.length > 0 ? `${(mappedCount / plans.length) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowOnlyUncategorized((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showOnlyUncategorized ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {showOnlyUncategorized ? "Mostrar todos" : `Mostrar não mapeados (${flat.filter((p) => !draft[p.id]).length})`}
          </button>

          {canManage && dirtyIds.length > 0 && (
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
              Salvar {dirtyIds.length} alteração{dirtyIds.length !== 1 ? "ões" : ""}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {showOnlyUncategorized ? "Todos os planos já estão mapeados." : "Nenhum plano de contas cadastrado."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plano de contas</th>
                  <th className="w-64 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categoria DRE</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((plan) => {
                  const current = draft[plan.id] ?? null;
                  const isDirty = (plan.dreCategory ?? null) !== current;
                  return (
                    <tr
                      key={plan.id}
                      className={`border-b border-border/50 transition-colors ${isDirty ? "bg-primary/5" : "hover:bg-muted/20"}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5" style={{ paddingLeft: plan.depth * 20 }}>
                          {plan.depth > 0 && (
                            <span className="text-border">└</span>
                          )}
                          <span className="font-mono text-[10px] text-muted-foreground">{plan.number}</span>
                          <span className={plan.depth === 0 ? "font-semibold" : ""}>{plan.name}</span>
                          {isDirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {canManage ? (
                          <Select
                            value={current ?? "none"}
                            onValueChange={(val) => setCategory(plan.id, val === "none" ? null : val)}
                          >
                            <SelectTrigger className="h-8 w-full rounded-lg text-xs [&>span]:truncate">
                              <SelectValue placeholder="Sem categoria" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">
                                <span className="text-muted-foreground">Sem categoria</span>
                              </SelectItem>
                              {DRE_CATEGORIES.map((cat) => (
                                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : current ? (
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_COLOR[current] ?? ""}`}>
                            {CATEGORY_LABEL[current] ?? current}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canManage && dirtyIds.length > 0 && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Salvar {dirtyIds.length} alteração{dirtyIds.length !== 1 ? "ões" : ""}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
