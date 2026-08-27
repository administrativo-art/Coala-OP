"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { terminationFetch } from "./client";
import type { ProcessProjection } from "./types";

export function ProcessCenterPage() {
  const { firebaseUser } = useAuth(); const [items, setItems] = useState<ProcessProjection[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (firebaseUser) terminationFetch<{ processes: ProcessProjection[] }>(firebaseUser, "/api/processes").then((r) => setItems(r.processes)).catch((e) => setError(e.message)); }, [firebaseUser]);
  return <div className="space-y-6 p-4 md:p-8"><div><h1 className="text-2xl font-bold">Acompanhamento de processos</h1><p className="text-muted-foreground">Visão persistente dos processos de todos os módulos, alimentada pela fonte oficial de cada fluxo.</p></div>{error && <p className="text-destructive">{error}</p>}<div className="space-y-3">{items.map((item) => <Link key={item.id} href={item.href}><Card className="transition hover:border-primary"><CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_160px_120px]"><div><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{item.currentSummary}</p></div><div className="space-y-1"><Progress value={item.progress}/><p className="text-xs text-muted-foreground">{item.progress}%</p></div><Badge className="justify-center" variant={["overdue", "blocked"].includes(item.health) ? "destructive" : "secondary"}>{item.health}</Badge></CardContent></Card></Link>)}</div>{!items.length && !error && <p className="py-12 text-center text-muted-foreground">Nenhum processo publicado.</p>}</div>;
}
