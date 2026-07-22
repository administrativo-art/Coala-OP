"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { terminationFetch } from "./client";
import type { CltTerminationProcess } from "./types";

const healthLabel = { on_track: "No prazo", attention: "Atenção", overdue: "Atrasado", blocked: "Bloqueado", completed: "Concluído", cancelled: "Cancelado" };

export function TerminationListPage() {
  const { firebaseUser } = useAuth();
  const [items, setItems] = useState<CltTerminationProcess[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (firebaseUser) terminationFetch<{ processes: CltTerminationProcess[] }>(firebaseUser, "/api/hr/terminations").then((v) => setItems(v.processes)).catch((e) => setError(e.message)); }, [firebaseUser]);
  const shown = useMemo(() => items.filter((item) => `${item.employeeName} ${item.request.protocol}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const active = items.filter((item) => !["completed", "cancelled"].includes(item.status));
  return <div className="space-y-6 p-4 md:p-8">
    <div><h1 className="text-2xl font-bold">Desligamentos CLT</h1><p className="text-muted-foreground">Processos ativos, prazos, pendências e histórico em um único lugar.</p></div>
    <div className="grid gap-3 md:grid-cols-3">
      <Card><CardContent className="p-5"><Clock3 className="mb-2 h-5 w-5 text-blue-600"/><div className="text-2xl font-bold">{active.length}</div><p className="text-sm text-muted-foreground">Ativos</p></CardContent></Card>
      <Card><CardContent className="p-5"><AlertTriangle className="mb-2 h-5 w-5 text-red-600"/><div className="text-2xl font-bold">{active.filter((i) => ["overdue", "blocked"].includes(i.health)).length}</div><p className="text-sm text-muted-foreground">Atrasados ou bloqueados</p></CardContent></Card>
      <Card><CardContent className="p-5"><CheckCircle2 className="mb-2 h-5 w-5 text-green-600"/><div className="text-2xl font-bold">{items.filter((i) => i.status === "completed").length}</div><p className="text-sm text-muted-foreground">Concluídos</p></CardContent></Card>
    </div>
    <div className="relative max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/><Input className="pl-9" placeholder="Buscar colaborador ou protocolo" value={query} onChange={(e) => setQuery(e.target.value)}/></div>
    {error && <p className="text-sm text-destructive">{error}</p>}
    <div className="grid gap-4 lg:grid-cols-2">{shown.map((item) => <Link key={item.id} href={`/dashboard/dp/terminations/${item.id}`}><Card className="h-full transition hover:border-primary"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{item.employeeName}</CardTitle><p className="text-xs text-muted-foreground">{item.request.protocol} · {item.unitName ?? "Sem unidade"}</p></div><Badge variant={item.health === "overdue" || item.health === "blocked" ? "destructive" : "secondary"}>{healthLabel[item.health]}</Badge></div></CardHeader><CardContent className="space-y-3"><p className="text-sm">{item.currentSummary}</p><Progress value={item.progress}/><div className="flex justify-between text-xs text-muted-foreground"><span>{item.progress}% concluído</span><span>{item.nextDueAt ? `Próximo prazo: ${new Date(`${item.nextDueAt}T12:00:00`).toLocaleDateString("pt-BR")}` : "Sem prazo definido"}</span></div></CardContent></Card></Link>)}</div>
    {!shown.length && !error && <p className="py-12 text-center text-muted-foreground">Nenhum desligamento encontrado.</p>}
  </div>;
}
