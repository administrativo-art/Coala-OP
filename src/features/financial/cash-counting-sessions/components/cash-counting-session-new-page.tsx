"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Store, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import type { CashCountingSession } from "../types";
import { CashControlNavigation } from "@/features/financial/cash-closures/components/cash-control-navigation";

type Unit = { id: string; name: string; pdvFilialId: string | null };

function currentMonthKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Belem", year: "numeric", month: "2-digit" })
    .formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function CashCountingSessionNewPage() {
  const router = useRouter();
  const { firebaseUser, permissions } = useAuth();
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [periods, setPeriods] = useState([currentMonthKey()]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    let active = true;
    void api<{ units?: Unit[] }>("/api/financial/cash-closures/overview", { fallbackError: "Falha ao carregar unidades." })
      .then((payload) => { if (active) setUnits(payload.units ?? []); })
      .catch((error) => toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar unidades." }))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, firebaseUser, toast]);

  const uniquePeriods = useMemo(() => Array.from(new Set(periods.filter(Boolean))).sort(), [periods]);

  async function createSession() {
    setWorking(true);
    try {
      const payload = await api<{ session: CashCountingSession }>("/api/financial/cash-counting-sessions", {
        method: "POST",
        json: {
          kioskIds: selectedUnits,
          periods: uniquePeriods.map((period) => {
            const [year, month] = period.split("-").map(Number);
            return { year, month };
          }),
        },
      });
      router.push(`/dashboard/financial/cash-closures/sessions/${payload.session.id}`);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao abrir sessão." });
    } finally {
      setWorking(false);
    }
  }

  if (!permissions.financial?.cashClosures?.approve) return null;
  return <PageContainer variant="compact" className="space-y-5 pb-10">
    <CashControlNavigation active="closures" crumbs={[
      { label: "Fechamento do caixa", href: "/dashboard/financial/cash-closures" },
      { label: "Nova sessão" },
    ]} />
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-3xl font-black tracking-tight">Abrir sessão de contagem</h1><p className="mt-1.5 text-sm font-medium text-zinc-500">Escolha as unidades e competências dos malotes que serão conferidos juntos.</p></div>
      <Button asChild variant="outline" className="rounded-xl"><Link href="/dashboard/financial/cash-closures"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
    </div>

    <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="text-lg">1. Unidades</CardTitle></CardHeader>
      <CardContent>{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <div className="grid gap-3 sm:grid-cols-2">{units.map((unit) => {
        const checked = selectedUnits.includes(unit.id);
        return <label key={unit.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-stone-200 p-3.5 transition-colors hover:border-pink-300">
          <Checkbox checked={checked} onCheckedChange={(next) => setSelectedUnits((current) => next ? [...current, unit.id] : current.filter((id) => id !== unit.id))} />
          <Store className="h-4 w-4 text-pink-600" />
          <span className="min-w-0"><strong className="block truncate text-sm">{unit.name}</strong><span className="text-xs text-zinc-400">Filial PDV {unit.pdvFilialId ?? "não configurada"}</span></span>
        </label>;
      })}</div>}</CardContent>
    </Card>

    <Card className="rounded-2xl border-stone-200">
      <CardHeader><CardTitle className="text-lg">2. Competências</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {periods.map((period, index) => <div key={`${period}-${index}`} className="flex gap-2">
          <Input type="month" value={period} min="2020-01" max="2200-12" onChange={(event) => setPeriods((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.value : value))} className="max-w-xs" />
          {periods.length > 1 && <Button type="button" size="icon" variant="outline" onClick={() => setPeriods((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X className="h-4 w-4" /><span className="sr-only">Remover competência</span></Button>}
        </div>)}
        <Button type="button" variant="outline" disabled={periods.length >= 6} onClick={() => setPeriods((current) => [...current, current.at(-1) ?? currentMonthKey()])}><Plus className="mr-2 h-4 w-4" />Adicionar competência</Button>
      </CardContent>
    </Card>

    <div className="flex justify-end"><Button className="h-11 rounded-xl bg-pink-600 px-6 font-bold hover:bg-pink-700" disabled={working || selectedUnits.length === 0 || uniquePeriods.length === 0 || uniquePeriods.length !== periods.length || selectedUnits.length * uniquePeriods.length > 36} onClick={() => void createSession()}>{working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Abrir sessão</Button></div>
  </PageContainer>;
}
