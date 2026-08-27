"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { terminationFetch } from "./client";
import type { CltTerminationProcess } from "./types";

export function ActiveTerminationsCard() {
  const { firebaseUser } = useAuth(); const [items, setItems] = useState<CltTerminationProcess[]>([]);
  useEffect(() => { if (firebaseUser) terminationFetch<{ processes: CltTerminationProcess[] }>(firebaseUser, "/api/hr/terminations").then((r) => setItems(r.processes.filter((item) => !["completed", "cancelled"].includes(item.status)).slice(0, 5))).catch(() => null); }, [firebaseUser]);
  return <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-lg">Desligamentos ativos</CardTitle><Button asChild size="sm" variant="outline"><Link href="/dashboard/dp/terminations">Ver todos</Link></Button></CardHeader><CardContent className="space-y-2">{items.map((item) => <Link key={item.id} href={`/dashboard/dp/terminations/${item.id}`} className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50"><div><p className="text-sm font-medium">{item.employeeName}</p><p className="text-xs text-muted-foreground">{item.currentSummary} · {item.progress}%</p></div><Badge variant={["overdue", "blocked"].includes(item.health) ? "destructive" : "secondary"}>{item.health === "overdue" ? "Atrasado" : item.health === "blocked" ? "Bloqueado" : item.health === "attention" ? "Atenção" : "No prazo"}</Badge></Link>)}{!items.length && <p className="py-4 text-sm text-muted-foreground">Nenhum desligamento ativo.</p>}</CardContent></Card>;
}
