"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, ExternalLink, Loader2, RefreshCw, Send, ShieldCheck, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { BankPaymentRequest, BankPaymentRequestStatus } from "./types";
import { PageContainer } from "@/components/layout/page-container";
import { FinancialAccessGuard } from "@/features/financial/components/financial-access-guard";

const statusLabel: Record<BankPaymentRequestStatus, string> = {
  draft: "Rascunho", awaiting_financial_authorization: "Aguardando autorização financeira",
  ready_to_submit: "Pronto para enviar", submitting: "Enviando ao banco",
  awaiting_bank_approval: "Aguardando aprovação no Banco Inter", scheduled: "Agendado no Inter",
  processing: "Processando", awaiting_statement: "Aguardando extrato",
  paid: "Pago", rejected: "Rejeitado", approval_expired: "Aprovação expirada",
  failed: "Falha", cancelled: "Cancelado",
};

function StatusIcon({ status }: { status: BankPaymentRequestStatus }) {
  if (status === "paid") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (["rejected", "failed", "approval_expired", "cancelled"].includes(status)) return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Clock3 className="h-4 w-4 text-amber-600" />;
}

function sourceLabel(sourceType: BankPaymentRequest["sourceType"]) {
  if (sourceType === "aso") return "ASO";
  if (sourceType === "termination") return "Rescisão CLT";
  if (sourceType === "vacation") return "Férias";
  if (sourceType === "purchase_order") return "Pedido de compra";
  if (sourceType === "financial_inbox") return "Cobrança recebida";
  return "Recibo gerado";
}

export function PaymentRequestsPage() {
  const { firebaseUser, permissions } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BankPaymentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [authorizationTarget, setAuthorizationTarget] = useState<BankPaymentRequest | null>(null);
  const [submissionTarget, setSubmissionTarget] = useState<BankPaymentRequest | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!firebaseUser) throw new Error("Sessão não disponível.");
    const token = await firebaseUser.getIdToken();
    const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Falha na operação.");
    return payload;
  }, [firebaseUser]);

  const load = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try { setItems((await api("/api/financial/payment-requests")).requests ?? []); }
    catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha ao carregar." }); }
    finally { setLoading(false); }
  }, [api, firebaseUser, toast]);

  useEffect(() => { void load(); }, [load]);

  async function action(id: string, name: "authorize" | "submit" | "refresh") {
    setWorking(`${id}:${name}`);
    try {
      await api(`/api/financial/payment-requests/${id}/${name}`, { method: "POST" });
      toast({ title: name === "authorize" ? "Pagamento autorizado no Coala." : name === "submit" ? "Solicitação enviada ao Banco Inter." : "Situação bancária atualizada." });
      await load();
    } catch (error) { toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na operação." }); }
    finally { setWorking(null); }
  }

  async function authorizeAndSubmit(item: BankPaymentRequest) {
    setWorking(`${item.id}:authorize`);
    try {
      await api(`/api/financial/payment-requests/${item.id}/authorize`, { method: "POST" });
      if (item.sourceType === "financial_inbox" && permissions.financial.paymentRequests.submit) {
        await api(`/api/financial/payment-requests/${item.id}/submit`, { method: "POST" });
        toast({ title: "Pagamento autorizado e enviado ao Banco Inter." });
      } else {
        toast({ title: "Pagamento autorizado no Coala." });
      }
      await load();
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "Falha na operação." });
      await load();
    } finally {
      setWorking(null);
    }
  }

  async function openProof(id: string) {
    if (!firebaseUser) return;
    const preview = window.open('', '_blank');
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/financial/payment-requests/${id}/proof`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'Falha ao abrir comprovante.'); }
      const url = URL.createObjectURL(await response.blob());
      if (preview) preview.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { preview?.close(); toast({ variant: 'destructive', title: error instanceof Error ? error.message : 'Falha ao abrir comprovante.' }); }
  }

  if (!permissions.financial?.paymentRequests?.view) return <FinancialAccessGuard title="Autorizações bancárias" description="Seu perfil não possui permissão para visualizar autorizações bancárias." />;

  return <PageContainer variant="compact" className="space-y-5 pb-10">
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight">Autorizações bancárias</h1><p className="text-sm text-muted-foreground">Autorização, aprovação bancária, conciliação e comprovantes Pix.</p></div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar lista</Button>
    </div>
    {loading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : items.length === 0 ?
      <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhuma solicitação bancária foi criada.</CardContent></Card> :
      <div className="grid gap-3">{items.map((item) => <Card key={item.id}>
        <CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{item.description}</CardTitle><CardDescription>{sourceLabel(item.sourceType)} · {item.beneficiarySnapshot?.name ?? "Código de barras"}</CardDescription></div><div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"><StatusIcon status={item.status} />{statusLabel[item.status]}</div></div></CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1 text-sm"><span><strong>Valor:</strong> {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.amount)}</span><span><strong>Destino:</strong> {item.beneficiarySnapshot?.maskedPaymentDestination ?? item.barcodeSnapshot?.maskedCode ?? "—"}</span>{item.barcodeSnapshot && <span><strong>Pagamento:</strong> {item.barcodeSnapshot.scheduledFor === item.barcodeSnapshot.dueDate ? "No vencimento" : item.barcodeSnapshot.scheduledFor} · vence em {item.barcodeSnapshot.dueDate}</span>}{!item.barcodeSnapshot && item.scheduledFor ? <span><strong>Programado para:</strong> {item.scheduledFor.split('-').reverse().join('/')}</span> : null}{item.interRequestId && <span className="text-xs text-muted-foreground">Inter: {item.interRequestId}</span>}{item.lastError && <span className="text-xs text-rose-600">{item.lastError.safeMessage}</span>}</div>
          <div className="flex flex-wrap gap-2">
            {item.status === "awaiting_financial_authorization" && permissions.financial.paymentRequests.authorize && <Button onClick={() => setAuthorizationTarget(item)} disabled={!!working}><ShieldCheck className="mr-2 h-4 w-4" />{item.sourceType === "financial_inbox" && permissions.financial.paymentRequests.submit ? "Autorizar e enviar" : "Autorizar"}</Button>}
            {["ready_to_submit", "failed"].includes(item.status) && permissions.financial.paymentRequests.submit && <Button onClick={() => setSubmissionTarget(item)} disabled={!!working}><Send className="mr-2 h-4 w-4" />Enviar ao Inter</Button>}
            {["awaiting_bank_approval", "scheduled", "processing"].includes(item.status) && permissions.financial.paymentRequests.refresh && <Button variant="outline" onClick={() => void action(item.id, "refresh")} disabled={!!working}><RefreshCw className="mr-2 h-4 w-4" />Atualizar situação</Button>}
            {item.proofStoragePath && permissions.financial.paymentRequests.viewProof && <Button variant="outline" onClick={() => void openProof(item.id)}>Comprovante<ExternalLink className="ml-2 h-4 w-4" /></Button>}
          </div>
        </CardContent>
      </Card>)}</div>}
    <AlertDialog open={Boolean(authorizationTarget)} onOpenChange={(open) => !open && setAuthorizationTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Autorizar este pagamento?</AlertDialogTitle>
          <AlertDialogDescription>
            {authorizationTarget ? `${authorizationTarget.description} · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(authorizationTarget.amount)}.` : ""}
            {authorizationTarget?.sourceType === "financial_inbox" && permissions.financial.paymentRequests.submit
              ? " Ao confirmar, o Coala enviará a solicitação ao Banco Inter. Dependendo da conta, ainda poderá haver aprovação final no aplicativo ou Internet Banking."
              : " A confirmação registra a autorização financeira no Coala."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            const target = authorizationTarget;
            setAuthorizationTarget(null);
            if (target) void authorizeAndSubmit(target);
          }}>Confirmar autorização</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={Boolean(submissionTarget)} onOpenChange={(open) => !open && setSubmissionTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enviar a solicitação ao Banco Inter?</AlertDialogTitle>
          <AlertDialogDescription>
            {submissionTarget ? `${submissionTarget.description} · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(submissionTarget.amount)}.` : ""} Esta ação pode efetuar ou agendar o pagamento. Em contas com dupla aprovação, a confirmação final continuará no Inter.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            const target = submissionTarget;
            setSubmissionTarget(null);
            if (target) void action(target.id, "submit");
          }}>Enviar ao Inter</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </PageContainer>;
}
