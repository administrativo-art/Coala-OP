"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LockKeyhole, Store } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHero } from "@/components/patterns/page-hero";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getUserDisplayName } from "@/lib/user-display";
import type { CashCountingSession } from "../types";
import { CashControlNavigation } from "@/features/financial/cash-closures/components/cash-control-navigation";

type Unit = { id: string; name: string; pdvFilialId: string | null };

export function CashCountingSessionNewPage() {
  const router = useRouter();
  const { firebaseUser, permissions, user } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [sessions, setSessions] = useState<CashCountingSession[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    void Promise.all([
      api<{ units?: Unit[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." }),
      api<{ sessions?: CashCountingSession[] }>("/api/financial/cash-counting-sessions", { fallbackError: "Falha ao carregar sessões." }),
    ])
      .then(([unitPayload, sessionPayload]) => {
        if (!active) return;
        setUnits(unitPayload.units ?? []);
        setSessions(sessionPayload.sessions ?? []);
      })
      .catch((error) => toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar unidades." }))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, firebaseUser, toast]);

  const lockByUnitId = useMemo(() => {
    const result = new Map<string, CashCountingSession>();
    for (const session of sessions.filter((item) => item.status === "open")) {
      for (const kioskId of session.kioskIds) result.set(kioskId, session);
    }
    return result;
  }, [sessions]);
  const countingUserName = getUserDisplayName({
    id: user?.id ?? firebaseUser?.uid,
    username: user?.username ?? firebaseUser?.displayName ?? undefined,
    email: user?.email ?? firebaseUser?.email ?? undefined,
    hrEmployeeId: user?.hrEmployeeId,
    registrationIdBizneo: user?.registrationIdBizneo,
    registrationIdPdv: user?.registrationIdPdv,
  }, firebaseUser?.uid);
  const countingUserInitials = countingUserName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  async function createSession() {
    setWorking(true);
    try {
      const payload = await api<{ session: CashCountingSession }>("/api/financial/cash-counting-sessions", {
        method: "POST",
        json: { kioskIds: selectedUnits },
      });
      router.push(`/dashboard/financial/cash-closures/sessions/${payload.session.id}`);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir sessão." });
    } finally {
      setWorking(false);
    }
  }

  if (!permissions.financial?.cashClosures?.approve) return null;
  return <PageContainer variant="compact" surface className="space-y-5 pb-10">
    <CashControlNavigation crumbs={[
      { label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" },
      { label: "Nova sessão" },
    ]} />
<PageHero kicker="Financeiro · Fechamento do caixa" title="Abrir sessão de contagem" subtitle="Selecione as unidades. A data de cada malote será informada durante a contagem." />
    <Card className="overflow-hidden rounded-[18px] border-ds-border bg-ds-warm">
      <CardHeader className="border-b border-ds-border bg-[#faf8f4]"><CardTitle className="text-lg">Unidades da sessão</CardTitle><p className="text-sm text-ds-ink-muted">Uma unidade fica indisponível para outras sessões até esta contagem ser finalizada.</p></CardHeader>
      <CardContent className="pt-6">{loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="grid gap-3 sm:grid-cols-2">{units.map((unit) => {
        const lockedBy = lockByUnitId.get(unit.id);
        const checked = selectedUnits.includes(unit.id);
        const disabled = !!lockedBy;
        return <label key={unit.id} className={cn(
          "flex min-h-20 items-center gap-3 rounded-xl border p-3.5 transition-all motion-reduce:transform-none motion-reduce:transition-none",
          disabled ? "cursor-not-allowed border-ds-border bg-ds-muted opacity-70" : "cursor-pointer border-ds-border hover:-translate-y-0.5 hover:border-ds-accent-soft hover:shadow-sm",
          checked && "border-ds-accent-soft bg-ds-accent-soft ring-2 ring-ds-accent",
        )}>
          <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => setSelectedUnits((current) => next ? [...current, unit.id] : current.filter((id) => id !== unit.id))} />
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", disabled ? "bg-ds-muted text-ds-ink-muted" : "bg-ds-accent-soft text-ds-accent-ink")}>{disabled ? <LockKeyhole className="h-4 w-4" /> : <Store className="h-4 w-4" />}</span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{unit.name}</strong><span className="mt-0.5 block text-xs text-ds-ink-faint">{disabled ? `Em contagem por ${lockedBy.openedByName}` : `Filial PDV ${unit.pdvFilialId ?? "não configurada"}`}</span></span>
        </label>;
      })}</div>}</CardContent>
    </Card>

    <div className="flex items-center gap-3 rounded-[18px] border border-ds-border bg-ds-warm px-5 py-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ds-info-bg text-sm font-black text-ds-info">{countingUserInitials || "U"}</span>
      <span className="min-w-0"><span className="block text-[11px] font-black uppercase tracking-[.1em] text-ds-ink-faint">Contagem realizada por</span><strong className="mt-1 block truncate text-sm font-extrabold">{countingUserName}</strong><span className="mt-0.5 block text-xs font-semibold text-ds-ink-faint">Financeiro</span></span>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-ds-dark px-5 py-4 text-white">
      <span><span className="block text-xs text-ds-ink-faint">Unidades selecionadas</span><strong className="text-lg">{selectedUnits.length}</strong></span>
      <Button className="h-11 rounded-xl bg-ds-accent px-6 font-bold text-white hover:bg-ds-accent-hover" disabled={working || selectedUnits.length === 0} onClick={() => void createSession()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Abrir sessão</Button>
    </div>
  </PageContainer>;
}
