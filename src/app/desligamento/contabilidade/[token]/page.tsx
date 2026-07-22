"use client";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Summary = { employeeName: string; protocol: string; unitName?: string | null; jobRoleName?: string | null; notice?: { contractEndDate: string; legalPaymentDueDate: string } | null; documentCount: number };
export default function Page() {
  const token = String(useParams().token); const [process, setProcess] = useState<Summary | null>(null); const [message, setMessage] = useState("Carregando..."); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/hr/termination-accountant/${token}`, { cache: "no-store" }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error); setProcess(b.process); setMessage(""); }).catch((e) => setMessage(e.message)); }, [token]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); const data = new FormData(event.currentTarget); try { const response = await fetch(`/api/hr/termination-accountant/${token}`, { method: "POST", body: data }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setMessage("Documentos recebidos com sucesso. O RH foi encaminhado para a auditoria."); event.currentTarget.reset(); } catch (e) { setMessage(e instanceof Error ? e.message : "Falha no envio."); } finally { setBusy(false); } }
  return <main className="min-h-screen bg-muted/30 p-4 md:p-10"><div className="mx-auto max-w-2xl space-y-5"><h1 className="text-2xl font-bold">Documentos do desligamento</h1>{process && <Card><CardHeader><CardTitle>{process.employeeName}</CardTitle></CardHeader><CardContent className="space-y-1 text-sm"><p>Protocolo: {process.protocol}</p><p>Empresa: {process.unitName ?? "—"}</p><p>Cargo: {process.jobRoleName ?? "—"}</p><p>Término: {process.notice?.contractEndDate ?? "—"}</p><p>Prazo legal: {process.notice?.legalPaymentDueDate ?? "—"}</p></CardContent></Card>}{process && <Card><CardHeader><CardTitle className="text-base">Anexar arquivos rescisórios</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><Input name="files" type="file" multiple required/><Button disabled={busy}>{busy ? "Enviando..." : "Enviar documentos"}</Button></form></CardContent></Card>}{message && <p className="rounded-md bg-background p-4 text-sm">{message}</p>}</div></main>;
}
