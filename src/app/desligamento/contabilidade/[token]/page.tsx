"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Loader2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type Summary = {
  employeeName: string;
  protocol: string;
  unitName?: string | null;
  employer?: { legalName: string; tradeName?: string | null; cnpj: string } | null;
  jobRoleName?: string | null;
  notice?: { contractEndDate: string; legalPaymentDueDate: string } | null;
  status: "sent" | "documents_received" | "correction_requested" | "approved";
  correctionMessage?: string | null;
  grossAmount?: number | null;
  discountAmount?: number | null;
  netAmount?: number | null;
  noPaymentDue?: boolean;
  paymentDueDate?: string | null;
  documents: Array<{ id: string; label: string; kind?: string | null; version: number; auditStatus: string; correctionReason?: string | null }>;
};

function money(value?: number | null) {
  return typeof value === "number" ? value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
}

export default function AccountantTerminationPage() {
  const token = String(useParams().token);
  const [process, setProcess] = useState<Summary | null>(null);
  const [message, setMessage] = useState("Carregando...");
  const [busy, setBusy] = useState(false);
  const [noPaymentDue, setNoPaymentDue] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/hr/termination-accountant/${token}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setProcess(body.process);
    setNoPaymentDue(body.process.noPaymentDue === true);
    setMessage("");
  }, [token]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "Falha ao abrir o portal.")); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    form.set("noPaymentDue", String(noPaymentDue));
    try {
      const response = await fetch(`/api/hr/termination-accountant/${token}`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage("Documentos recebidos. O RH já pode conferir esta versão.");
      event.currentTarget.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no envio.");
    } finally {
      setBusy(false);
    }
  }

  const approved = process?.status === "approved";
  return (
    <main className="min-h-screen bg-[#f0eee9] p-4 md:p-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.1em] text-pink-600">Portal seguro da contabilidade</p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Documentos do desligamento</h1>
          <p className="mt-2 text-sm font-medium text-slate-500">Envie o TRCT, o demonstrativo e confirme os valores usados no pagamento.</p>
        </header>

        {process ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>{process.employeeName}</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <p><b>Protocolo:</b> {process.protocol}</p><p><b>Empresa:</b> {process.employer?.legalName ?? "—"}</p>
              <p><b>CNPJ:</b> {process.employer?.cnpj ? process.employer.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : "—"}</p><p><b>Unidade de trabalho:</b> {process.unitName ?? "—"}</p>
              <p><b>Cargo:</b> {process.jobRoleName ?? "—"}</p><p><b>Término:</b> {process.notice?.contractEndDate ?? "—"}</p>
              <p><b>Prazo legal:</b> {process.notice?.legalPaymentDueDate ?? "—"}</p><p><b>Situação:</b> {approved ? "Aprovado pelo RH" : process.status === "correction_requested" ? "Correção solicitada" : "Em análise"}</p>
            </CardContent>
          </Card>
        ) : null}

        {process?.correctionMessage ? (
          <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-black">Devolutiva do RH</p><p className="mt-1 whitespace-pre-line">{process.correctionMessage}</p></div>
          </div>
        ) : null}

        {process?.documents.length ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Versões atuais</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {process.documents.map((document) => (
                <div key={document.id} className="flex items-start gap-3 rounded-xl border bg-slate-50 p-3 text-sm">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" />
                  <div className="flex-1"><p className="font-bold">{document.label} · v{document.version}</p><p className="text-xs text-slate-500">{document.correctionReason ?? (document.auditStatus === "approved" ? "Aprovado pelo RH" : "Aguardando conferência")}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {approved ? (
          <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
            <CheckCircle2 className="h-6 w-6 shrink-0" /><div><p className="font-black">Envio aprovado</p><p className="mt-1 text-sm font-medium">O RH aprovou os documentos e os valores. Nenhuma outra ação é necessária neste portal.</p></div>
          </div>
        ) : process?.status === "documents_received" ? (
          <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-900">
            <CheckCircle2 className="h-6 w-6 shrink-0" /><div><p className="font-black">Documentos recebidos</p><p className="mt-1 text-sm font-medium">O RH está conferindo esta versão. Se houver algum ajuste, uma nova devolutiva e um novo acesso serão enviados por e-mail.</p></div>
          </div>
        ) : process ? (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle className="text-base">Enviar documentos e valores</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={submit}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-black">TRCT <Input name="trct" type="file" accept="application/pdf,image/*" required={!process.documents.some((document) => document.kind === "trct" && document.auditStatus === "approved")} /></label>
                  <label className="space-y-2 text-sm font-black">Demonstrativo do cálculo <Input name="calculationStatement" type="file" accept="application/pdf,image/*" required={!process.documents.some((document) => document.kind === "calculation_statement" && document.auditStatus === "approved")} /></label>
                </div>
                <label className="block space-y-2 text-sm font-black">Outros documentos <Input name="other" type="file" accept="application/pdf,image/*" multiple /></label>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="space-y-2 text-sm font-black">Valor bruto <Input name="grossAmount" type="number" min="0" step="0.01" defaultValue={process.grossAmount ?? ""} /></label>
                  <label className="space-y-2 text-sm font-black">Descontos <Input name="discountAmount" type="number" min="0" step="0.01" defaultValue={process.discountAmount ?? ""} /></label>
                  <label className="space-y-2 text-sm font-black">Valor líquido <Input name="netAmount" type="number" min="0" step="0.01" required={!noPaymentDue} disabled={noPaymentDue} defaultValue={process.netAmount ?? ""} /></label>
                </div>
                <label className="block max-w-xs space-y-2 text-sm font-black">Prazo do pagamento <Input name="paymentDueDate" type="date" defaultValue={process.paymentDueDate ?? process.notice?.legalPaymentDueDate ?? ""} required={!noPaymentDue} /></label>
                <label className="flex items-start gap-3 rounded-xl border bg-slate-50 p-4 text-sm font-semibold"><Checkbox checked={noPaymentDue} onCheckedChange={(checked) => setNoPaymentDue(checked === true)} />Não há valor líquido a pagar neste desligamento.</label>
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-semibold text-sky-800">Resumo atual: bruto {money(process.grossAmount)}, descontos {money(process.discountAmount)}, líquido {money(process.netAmount)}.</div>
                <Button disabled={busy} className="rounded-xl bg-pink-600 font-black hover:bg-pink-700">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{busy ? "Enviando..." : process.status === "correction_requested" ? "Enviar versões corrigidas" : "Enviar ao RH"}</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {message ? <p className="rounded-xl border bg-white p-4 text-sm font-semibold">{message}</p> : null}
      </div>
    </main>
  );
}
