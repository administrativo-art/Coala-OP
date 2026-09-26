"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { toDate } from "@/features/financial/lib/utils";
import { financialExpenseCompetenceMonth } from "@/features/financial/lib/expense-accounting-contract";
import { FINANCIAL_ROUTES } from "@/features/financial/lib/constants";

export function ExpenseBoletoPanel({ expense, canEdit }: { expense: any; canEdit: boolean }) {
  const id = useId(), api = useAuthenticatedApi(), { permissions } = useAuth();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [attached, setAttached] = useState(Boolean(expense.boletoAttachment));
  const [prepared, setPrepared] = useState(Boolean(expense.paymentRequestId));
  const [file, setFile] = useState<File | null>(null);
  const [barcode, setBarcode] = useState(expense.documentIdentity?.barcode ?? "");
  const [cnpj, setCnpj] = useState(expense.boletoAttachment?.beneficiaryDocument ?? "");
  const [reference, setReference] = useState(expense.sourceReference ?? "");
  const due = toDate(expense.dueDate)?.toISOString().slice(0, 10) ?? "";
  const [scheduledFor, setScheduledFor] = useState(due);
  const [confirmed, setConfirmed] = useState(false);
  const path = `/api/financial/expenses/${encodeURIComponent(expense.id)}/boleto`;
  const canPrepare = canEdit && permissions?.financial?.paymentRequests?.create && permissions?.financial?.paymentRequests?.view;
  const eligible = ["pending", "provisioned"].includes(expense.status) && expense.paymentMethod === "single" && !expense.financialInboxMessageId;
  async function action(run: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await run(); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-3 rounded-xl border bg-muted/20 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold">Boleto da despesa</span>
      {attached && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => action(async () => {
        const blob = await api<Blob>(path, { responseType: "blob" });
        const url = URL.createObjectURL(blob), anchor = document.createElement("a");
        anchor.href = url; anchor.download = "boleto.pdf"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Baixar PDF</Button>}
      {canEdit && eligible && !prepared && <Button type="button" variant="outline" size="sm" onClick={() => setOpen(!open)}>{attached ? "Preparar pagamento" : "Anexar boleto"}</Button>}
      {prepared && <Link className="text-sm underline" href={FINANCIAL_ROUTES.paymentRequests}>Ver solicitação de pagamento</Link>}
    </div>
    {open && eligible && !prepared && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Confira os dados no PDF. O boleto deve ter o mesmo valor, vencimento e competência desta despesa. Preparar não envia ao banco.</p>
      {!attached && <>
        <Label htmlFor={`${id}-pdf`}>1. PDF do boleto (até 10 MB)</Label><Input id={`${id}-pdf`} type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <Label htmlFor={`${id}-code`}>Linha digitável (47 dígitos)</Label><Input id={`${id}-code`} value={barcode} onChange={e => setBarcode(e.target.value)} />
        <Label htmlFor={`${id}-cnpj`}>CNPJ do favorecido</Label><Input id={`${id}-cnpj`} value={cnpj} onChange={e => setCnpj(e.target.value)} />
        <Label htmlFor={`${id}-ref`}>Número do documento</Label><Input id={`${id}-ref`} value={reference} onChange={e => setReference(e.target.value)} />
      </>}
      <p className="text-sm">Valor: {Number(expense.totalValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Vencimento: {due} · Competência: {financialExpenseCompetenceMonth(expense)}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi o PDF, o favorecido e os dados acima.</label>
      {!attached && <Button type="button" disabled={busy || !file || !confirmed} onClick={() => action(async () => {
        const body = new FormData(); body.set("file", file!); body.set("barcode", barcode); body.set("beneficiaryDocument", cnpj); body.set("documentReference", reference); body.set("amountCents", String(Math.round(Number(expense.totalValue) * 100))); body.set("dueDate", due); body.set("competenceMonth", financialExpenseCompetenceMonth(expense) ?? ""); body.set("confirmed", "true");
        await api(path, { method: "POST", body }); setAttached(true); setMessage("PDF anexado. Nenhum pagamento enviado.");
      })}>Salvar anexo</Button>}
      {attached && canPrepare && <>
        <Label htmlFor={`${id}-date`}>2. Data solicitada para pagamento</Label><Input id={`${id}-date`} type="date" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
        <p className="text-xs text-muted-foreground">Em dia não útil, confira a data aceita pelo Inter. A aprovação final é feita no aplicativo do banco.</p>
        <Button type="button" disabled={busy || !confirmed} onClick={() => action(async () => { await api(`${path}/payment`, { method: "POST", json: { scheduledFor, confirmed: true } }); setPrepared(true); setMessage("Solicitação preparada. Autorize e envie na tela de solicitações de pagamento."); })}>Preparar solicitação</Button>
      </>}
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
