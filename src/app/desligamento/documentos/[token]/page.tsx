"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Download, FileCheck2, Loader2, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Summary = {
  employeeName: string;
  protocol: string;
  unitName?: string | null;
  contractEndDate?: string | null;
  payment: { status: string; amount?: number | null; paidAt?: string | null; proofAvailable: boolean };
  documents: Array<{ id: string; label: string; fileName: string }>;
};

export default function EmployeeTerminationDocumentsPage() {
  const token = String(useParams().token);
  const [process, setProcess] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/hr/termination-documents/${token}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setProcess(body.process);
  }, [token]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha ao abrir os documentos.")); }, [load]);

  if (!process && !error) return <main className="grid min-h-screen place-items-center bg-[#f0eee9]"><p className="text-sm font-bold text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando documentos...</p></main>;
  if (error) return <main className="grid min-h-screen place-items-center bg-[#f0eee9] p-5"><p className="max-w-md rounded-2xl border bg-white p-6 text-center font-semibold text-rose-700">{error}</p></main>;
  if (!process) return null;

  const amount = typeof process.payment.amount === "number" ? process.payment.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
  return (
    <main className="min-h-screen bg-[#f0eee9] p-4 md:p-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-[24px] border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.1em] text-emerald-700">Desligamento concluído com o colaborador</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Seus documentos finais estão disponíveis</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">Olá, {process.employeeName}. Guarde este link e baixe os documentos do protocolo {process.protocol}.</p>
        </section>

        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Resumo</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <p><b>Empresa:</b> {process.unitName ?? "—"}</p><p><b>Término:</b> {process.contractEndDate ?? "—"}</p>
            <p><b>Pagamento:</b> {process.payment.status === "not_applicable" ? "Sem valor devido" : amount}</p><p><b>Situação:</b> Concluído</p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base">Documentos rescisórios</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {process.documents.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-slate-50 p-4">
                <div className="flex min-w-0 gap-3"><FileCheck2 className="h-5 w-5 shrink-0 text-pink-600" /><div className="min-w-0"><p className="font-bold text-slate-900">{document.label}</p><p className="truncate text-xs text-slate-500">{document.fileName}</p></div></div>
                <Button asChild variant="outline" size="sm"><a href={`/api/hr/termination-documents/${token}?documentId=${encodeURIComponent(document.id)}`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Abrir</a></Button>
              </div>
            ))}
            {!process.documents.length ? <p className="text-sm font-medium text-slate-500">Não há documentos adicionais para download.</p> : null}
            {process.payment.proofAvailable ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex gap-3"><ReceiptText className="h-5 w-5 text-emerald-700" /><div><p className="font-bold text-emerald-950">Comprovante do pagamento</p><p className="text-xs text-emerald-700">Pagamento confirmado no sistema.</p></div></div>
                <Button asChild variant="outline" size="sm"><a href={`/api/hr/termination-documents/${token}?paymentProof=1`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Abrir</a></Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
