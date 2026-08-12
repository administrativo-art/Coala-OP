"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, CheckCircle2, ExternalLink, FileCheck2, FileSignature, History, LockKeyhole } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { CnpjValidator } from "@/lib/company/cnpj-validator";
import type { CltTerminationProcess, PjTerminationAgreement, PjTerminationWitness, TerminationEvent, TerminationStepStatus } from "./types";

const TERMINAL_STATUSES = ["completed", "waived", "cancelled"];

function dateLabel(value?: string | null) {
  if (!value) return "—";
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR");
}

function money(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function agreementStatusLabel(status?: PjTerminationAgreement["status"]) {
  return {
    not_generated: "Não gerado",
    review_pending: "Aguardando revisão",
    approved: "Aprovado",
    sent: "Aguardando assinaturas",
    signed: "Assinado",
    correction_required: "Correção necessária",
    failed: "Falha",
  }[String(status ?? "not_generated")] ?? "Não gerado";
}

function StepStatus({ status }: { status?: TerminationStepStatus }) {
  const done = status && TERMINAL_STATUSES.includes(status);
  return <Badge variant="outline" className={done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "blocked" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-700"}>{done ? "Concluída" : status === "blocked" ? "Bloqueada" : status === "waiting_external" ? "Aguardando terceiro" : status === "pending" ? "Pendente" : "Em andamento"}</Badge>;
}

export function PjTerminationDetail({
  process,
  events,
  busy,
  error,
  onAction,
}: {
  process: CltTerminationProcess;
  events: TerminationEvent[];
  busy: boolean;
  error: string | null;
  onAction: (body: Record<string, unknown>) => void;
}) {
  const { firebaseUser } = useAuth();
  const contract = process.pjContractSnapshot;
  const agreement = process.pjAgreement;
  const terminationDate = process.notice?.contractEndDate ?? new Date().toISOString().slice(0, 10);
  const defaultDays = Math.min(30, Math.max(1, Number(terminationDate.slice(8, 10)) || 1));
  const [daysWorked, setDaysWorked] = useState(defaultDays);
  const [invoiceNumber, setInvoiceNumber] = useState(agreement?.settlement?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(agreement?.settlement?.invoiceDate ?? new Date().toISOString().slice(0, 10));
  const [paymentDate, setPaymentDate] = useState(agreement?.settlement?.paymentDate ?? new Date().toISOString().slice(0, 10));
  const [paymentConfirmed, setPaymentConfirmed] = useState(Boolean(agreement?.settlement?.paymentConfirmed));
  const [signatureCity, setSignatureCity] = useState(agreement?.settlement?.signatureCity ?? contract?.sourceContract.signatureCity ?? "São Luís/MA");
  const [forumCity, setForumCity] = useState(agreement?.settlement?.forumCity ?? contract?.sourceContract.forumCity ?? "São Luís/MA");
  const [witnesses, setWitnesses] = useState<PjTerminationWitness[]>(() => agreement?.witnesses ?? [
    { name: "", email: "", cpf: "" },
    { name: "", email: "", cpf: "" },
  ]);

  useEffect(() => {
    if (!agreement?.settlement) return;
    setDaysWorked(agreement.settlement.daysWorked);
    setInvoiceNumber(agreement.settlement.invoiceNumber);
    setInvoiceDate(agreement.settlement.invoiceDate);
    setPaymentDate(agreement.settlement.paymentDate);
    setPaymentConfirmed(agreement.settlement.paymentConfirmed);
    setSignatureCity(agreement.settlement.signatureCity);
    setForumCity(agreement.settlement.forumCity);
    if (agreement.witnesses) setWitnesses(agreement.witnesses);
  }, [agreement]);

  const steps = useMemo(() => new Map(process.steps.map((step) => [step.id, step])), [process.steps]);
  const grossValue = contract ? Number(((contract.sourceContract.monthlyValue / 30) * daysWorked).toFixed(2)) : 0;
  const currentDocument = agreement?.documentId ? process.documents.find((document) => document.id === agreement.documentId) : null;
  const readOnly = firebaseUser?.uid === process.employeeId;
  const agreementLocked = readOnly || agreement?.status === "sent" || agreement?.status === "signed";
  const allRequiredDone = process.steps.every((step) => !step.required || step.id === "closure" || TERMINAL_STATUSES.includes(step.status));
  const contractReached = new Date().toISOString().slice(0, 10) >= terminationDate;

  async function openAsset(query: string) {
    if (!firebaseUser) return;
    const preview = window.open("", "_blank");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(`/api/hr/terminations/${process.id}/asset?${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) {
      preview?.close();
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function setWitness(index: number, field: "name" | "email" | "cpf", value: string) {
    setWitnesses((current) => current.map((witness, position) => position === index ? { ...witness, [field]: value } : witness));
  }

  function generate() {
    onAction({
      action: "generate_pj_agreement",
      daysWorked,
      invoiceNumber,
      invoiceDate,
      paymentConfirmed,
      paymentDate,
      signatureCity,
      forumCity,
      witnesses,
    });
  }

  if (!contract) return <div className="p-8 text-sm font-semibold text-amber-800">O processo PJ não possui o snapshot do contrato original. Reabra o processo depois de vincular o contrato assinado.</div>;

  return (
    <div className="min-h-full bg-[#f0eee9] px-4 py-5 text-[#1d1d26] sm:px-7 sm:py-7">
      <div className="mx-auto max-w-[1180px] space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline"><Link href="/dashboard/dp/terminations"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
          <Badge className="bg-violet-100 text-violet-800 hover:bg-violet-100">Encerramento PJ</Badge>
          <span className="ml-auto font-mono text-xs text-slate-500">{process.request.protocol}</span>
        </div>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.1em] text-violet-600">Distrato por mútuo acordo</p>
              <h1 className="mt-1 text-2xl font-black">{contract.provider.legalName}</h1>
              <p className="mt-2 text-sm font-semibold text-slate-500">Término em {dateLabel(terminationDate)} · {process.terminationReason}</p>
            </div>
            <Badge variant="outline" className="px-3 py-1.5">{agreementStatusLabel(agreement?.status)}</Badge>
          </div>
          {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-pink-600" /><h2 className="font-black">Contratante congelada</h2></div>
            <p className="mt-3 font-bold">{contract.contractor.legalName}</p>
            <p className="text-sm text-slate-500">{CnpjValidator.format(contract.contractor.cnpj)}</p>
            <p className="mt-2 text-sm">Representante: {contract.contractor.representative.name}</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-violet-600" /><h2 className="font-black">Contratada congelada</h2></div>
            <p className="mt-3 font-bold">{contract.provider.legalName}</p>
            <p className="text-sm text-slate-500">{CnpjValidator.format(contract.provider.cnpj)}</p>
            <p className="mt-2 text-sm">Representante: {contract.provider.representative.name}</p>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-black">Contrato original</h2>
              <p className="mt-1 text-sm text-slate-500">Firmado em {dateLabel(contract.sourceContract.contractDate)} · v{contract.sourceContract.version} · valor mensal {money(contract.sourceContract.monthlyValue)}</p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">SHA-256 {contract.sourceContract.signedHashSha256}</p>
            </div>
            <Button variant="outline" onClick={() => void openAsset("sourceContract=1")}><ExternalLink className="mr-2 h-4 w-4" />Abrir contrato assinado</Button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-black">Dados do distrato</h2><p className="mt-1 text-sm text-slate-500">O valor é calculado automaticamente por trinta avos. A geração final exige nota fiscal e pagamento já confirmado.</p></div>
            <StepStatus status={steps.get("document_audit")?.status} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1.5 text-sm font-bold">Dias trabalhados<Input type="number" min={1} max={30} value={daysWorked} disabled={agreementLocked} onChange={(event) => setDaysWorked(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} /></label>
            <label className="space-y-1.5 text-sm font-bold">Valor proporcional<Input value={money(grossValue)} readOnly className="bg-slate-50" /></label>
            <label className="space-y-1.5 text-sm font-bold">Número da nota fiscal<Input value={invoiceNumber} disabled={agreementLocked} onChange={(event) => setInvoiceNumber(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-bold">Emissão da nota<Input type="date" value={invoiceDate} disabled={agreementLocked} onChange={(event) => setInvoiceDate(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-bold">Data do pagamento<Input type="date" value={paymentDate} disabled={agreementLocked} onChange={(event) => setPaymentDate(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-bold">Cidade da assinatura<Input value={signatureCity} disabled={agreementLocked} onChange={(event) => setSignatureCity(event.target.value)} /></label>
            <label className="space-y-1.5 text-sm font-bold sm:col-span-2">Foro<Input value={forumCity} disabled={agreementLocked} onChange={(event) => setForumCity(event.target.value)} /></label>
          </div>
          <label className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
            <input type="checkbox" className="mt-1" checked={paymentConfirmed} disabled={agreementLocked} onChange={(event) => setPaymentConfirmed(event.target.checked)} />
            Confirmo que a nota fiscal foi emitida e que o valor proporcional já foi recebido pela contratada. Essa confirmação sustenta a declaração de quitação da cláusula 2.4.
          </label>

          {!readOnly ? <div className="mt-5 grid gap-4 md:grid-cols-2">
            {witnesses.map((witness, index) => (
              <div key={index} className="rounded-xl border bg-slate-50 p-4">
                <p className="font-black">Testemunha {index + 1}</p>
                <div className="mt-3 grid gap-3">
                  <Input placeholder="Nome completo" value={witness.name} disabled={agreementLocked} onChange={(event) => setWitness(index, "name", event.target.value)} />
                  <Input type="email" placeholder="E-mail para assinatura" value={witness.email} disabled={agreementLocked} onChange={(event) => setWitness(index, "email", event.target.value)} />
                  <Input placeholder="CPF" value={witness.cpf} disabled={agreementLocked} onChange={(event) => setWitness(index, "cpf", event.target.value)} />
                </div>
              </div>
            ))}
          </div> : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {!agreementLocked ? <Button disabled={busy || !paymentConfirmed || !invoiceNumber} onClick={generate}><FileSignature className="mr-2 h-4 w-4" />{agreement?.documentId ? "Gerar nova versão" : "Gerar distrato"}</Button> : null}
            {currentDocument ? <Button variant="outline" onClick={() => void openAsset(`documentId=${currentDocument.id}`)}><ExternalLink className="mr-2 h-4 w-4" />Visualizar v{agreement?.version}</Button> : null}
            {!readOnly && agreement?.status === "review_pending" ? <Button variant="outline" disabled={busy} onClick={() => onAction({ action: "approve_pj_agreement" })}><FileCheck2 className="mr-2 h-4 w-4" />Aprovar distrato</Button> : null}
            {!readOnly && agreement?.status === "approved" ? <Button disabled={busy} onClick={() => onAction({ action: "send_pj_agreement_signatures" })}><FileSignature className="mr-2 h-4 w-4" />Enviar quatro assinaturas</Button> : null}
            {agreement?.status === "signed" ? <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Distrato assinado e arquivado</span> : null}
          </div>
          {agreement?.lastError ? <p className="mt-3 text-sm font-semibold text-red-700">{agreement.lastError}</p> : null}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><h2 className="font-black">Acessos e obrigações remanescentes</h2><p className="mt-1 text-sm text-slate-500">A revogação é liberada na data do encerramento. Depois da assinatura, confirme devoluções e eliminação de dados.</p></div><StepStatus status={steps.get("operational")?.status} /></div>
          {!contractReached ? <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900"><LockKeyhole className="h-4 w-4" />Aguardando {dateLabel(terminationDate)} para revogar os acessos.</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {(["pdv", "bizneo", "healthPlan"] as const).map((target) => {
              const state = process.accessRevocation?.[target];
              const done = state?.status === "completed" || state?.status === "not_applicable";
              return done
                ? <Badge key={target} className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{target === "pdv" ? "PDV" : target === "bizneo" ? "Bizneo" : "Benefício"}: concluído</Badge>
                : readOnly
                  ? <Badge key={target} variant="outline">{target === "pdv" ? "PDV" : target === "bizneo" ? "Bizneo" : "Benefício"}: pendente</Badge>
                  : <Button key={target} variant="outline" disabled={busy || !contractReached} onClick={() => onAction({ action: "revoke_access", target })}>Revogar {target === "pdv" ? "PDV" : target === "bizneo" ? "Bizneo" : "benefício"}</Button>;
            })}
          </div>
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border bg-slate-50 p-4">
            <div><p className="font-bold">Devolução de materiais e eliminação de dados</p><p className="text-xs text-slate-500">Confirme somente após receber os materiais e a declaração de eliminação.</p></div>
            <Select disabled={readOnly || busy || agreement?.status !== "signed"} value={steps.get("operational")?.status ?? "pending"} onValueChange={(status) => onAction({ action: "update_step", stepId: "operational", status })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="in_progress">Em andamento</SelectItem><SelectItem value="completed">Concluída</SelectItem></SelectContent>
            </Select>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-black">Fechamento</h2><p className="mt-1 text-sm text-slate-500">O cadastro será inativado somente após distrato assinado, acessos revogados e obrigações concluídas.</p></div>
            {!readOnly ? <Button disabled={busy || process.status === "completed" || !allRequiredDone} onClick={() => onAction({ action: "complete" })}>{process.status === "completed" ? "Processo concluído" : "Concluir encerramento PJ"}</Button> : <Badge variant="outline">Acompanhamento somente leitura</Badge>}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-slate-500" /><h2 className="font-black">Histórico</h2></div>
          <div className="mt-3 space-y-2">{events.slice(0, 12).map((event) => <div key={event.id ?? `${event.type}-${event.at}`} className="rounded-xl border bg-slate-50 p-3 text-sm"><p className="font-semibold">{event.message}</p><p className="mt-1 text-xs text-slate-500">{new Date(event.at).toLocaleString("pt-BR")} · {event.actorName}</p></div>)}</div>
        </section>
      </div>
    </div>
  );
}
