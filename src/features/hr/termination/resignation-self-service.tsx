"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { terminationFetch } from "./client";
import type { CltTerminationProcess } from "./types";

const TEMPLATE = `PEDIDO DE DEMISSÃO\n\nÀ\n[NOME DA EMPRESA]\n\nEu, [NOME COMPLETO DO COLABORADOR], inscrito(a) no CPF sob o nº [CPF], ocupante do cargo de [CARGO], venho, por minha livre e espontânea vontade, comunicar formalmente meu pedido de demissão do emprego que atualmente ocupo nesta empresa.\n\nEm relação ao aviso-prévio, declaro que:\n\n( ) Cumprirei o aviso-prévio de 30 dias, com início em __/__/____ e término previsto para __/__/____.\n\n( ) Solicito a dispensa do cumprimento do aviso-prévio, ciente de que dependerá da concordância da empresa e de eventual desconto legal.\n\nSolicito as providências necessárias para a formalização do desligamento e pagamento das verbas rescisórias devidas.\n\n[CIDADE], ____ de __________________ de ________.\n\n________________________________\nAssinatura`;

export function ResignationSelfService() {
  const { firebaseUser, user } = useAuth();
  const [mine, setMine] = useState<CltTerminationProcess[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  useEffect(() => { if (firebaseUser) terminationFetch<{ processes: CltTerminationProcess[] }>(firebaseUser, "/api/hr/terminations?scope=mine").then((r) => setMine(r.processes)).catch(() => null); }, [firebaseUser]);
  const active = mine.find((item) => !["completed", "cancelled"].includes(item.status));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!firebaseUser || !confirm("Tem certeza de que deseja formalizar seu pedido de demissão?")) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const result = await terminationFetch<{ process: CltTerminationProcess; signatureUrl: string | null }>(firebaseUser, "/api/hr/terminations", { method: "POST", body: form });
      setMine([result.process, ...mine]); setSignatureUrl(result.signatureUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao enviar pedido."); } finally { setBusy(false); }
  }
  if (active) return <div className="p-4 md:p-8"><Card><CardHeader><CardTitle>Seu pedido de demissão</CardTitle></CardHeader><CardContent className="space-y-3"><p>Protocolo <strong>{active.request.protocol}</strong></p><p className="text-muted-foreground">{active.currentSummary} · {active.progress}% concluído</p>{active.request.identityStatus === "pending_signature" && signatureUrl && <Button asChild><a href={signatureUrl} target="_blank" rel="noreferrer">Confirmar identidade e assinar</a></Button>}</CardContent></Card></div>;
  return <div className="mx-auto max-w-3xl space-y-5 p-4 md:p-8"><div><h1 className="text-2xl font-bold">Pedir demissão</h1><p className="text-muted-foreground">Formalização para colaboradores CLT.</p></div>
    <Alert><AlertTitle>Antes de continuar</AlertTitle><AlertDescription>Escreva a carta à mão, marque sua preferência de aviso-prévio, date e assine. A empresa decidirá sobre o cumprimento ou a dispensa. Depois do envio, você confirmará sua identidade por SMS e assinatura eletrônica.</AlertDescription></Alert>
    <Card><CardHeader><CardTitle className="text-base">Modelo para copiar à mão</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-xs">{TEMPLATE}</pre></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Enviar carta assinada</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={submit}><label className="block text-sm font-medium">Preferência de aviso-prévio<select name="noticePreference" className="mt-1 block h-10 w-full rounded-md border bg-background px-3"><option value="work">Quero cumprir 30 dias</option><option value="request_waiver">Solicito dispensa</option></select></label><label className="block text-sm font-medium">Carta em PDF, JPG ou PNG<Input className="mt-1" required name="letter" type="file" accept="application/pdf,image/jpeg,image/png"/></label><Textarea name="notes" placeholder="Observação opcional"/>{error && <p className="text-sm text-destructive">{error}</p>}<Button disabled={busy || user?.employmentRelationshipType !== "clt"} type="submit">{busy ? "Enviando..." : "Enviar e confirmar identidade"}</Button>{user?.employmentRelationshipType !== "clt" && <p className="text-xs text-muted-foreground">Este fluxo está disponível apenas para vínculo CLT.</p>}</form></CardContent></Card>
    <p className="text-xs text-muted-foreground">O pedido, seus arquivos, hashes, assinatura, horários e decisões formarão um dossiê auditável.</p><Link className="text-sm underline" href="/dashboard">Voltar ao painel</Link>
  </div>;
}
