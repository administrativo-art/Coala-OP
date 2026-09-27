"use client";

import { useId, useState } from "react";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { useToast } from "@/hooks/use-toast";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canCloseCmvPeriod, type DreCmvPeriod } from "../../dre/cmv-closure";
import { FINANCIAL_TIME_ZONE } from "../../lib/financial-dates";
import { formatCurrency } from "../../lib/utils";

export function CmvClosingPanel({ entries, month, unitName, capabilities, disabled, onUpdated }: {
  entries: DreCmvPeriod[]; month: string; unitName: string | null;
  capabilities: { canClose: boolean; canReopen: boolean }; disabled: boolean; onUpdated: () => void;
}) {
  const api = useAuthenticatedApi();
  const { toast } = useToast();
  const confirmationId = useId();
  const reasonId = useId();
  const [action, setAction] = useState<"close" | "reopen" | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entry = unitName ? entries[0] : undefined;
  const closed = entry?.status === "closed";
  const closedCount = entries.filter(row => row.status === "closed").length;
  const value = entry?.totalCmv == null ? "Indisponível" : formatCurrency(entry.totalCmv);
  const pastMonth = canCloseCmvPeriod(month);
  const displayDate = (value: string) => new Intl.DateTimeFormat("pt-BR", {
    timeZone: FINANCIAL_TIME_ZONE, dateStyle: "short", timeStyle: "short",
  }).format(new Date(value));

  async function confirm() {
    if (!entry || !action || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/financial/dre/cmv-closure", {
        method: "POST", fallbackError: "Não foi possível atualizar o fechamento do CMV.",
        json: { action, kioskId: entry.kioskId, period: month, expectedRevision: entry.revision,
          ...(action === "close" ? { expectedSourceFingerprint: entry.sourceFingerprint, salesReviewed: reviewed } : { reason: reason.trim() }) },
      });
      toast({ title: action === "close" ? "CMV do mês congelado" : "CMV reaberto para conferência" });
      setAction(null);
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o CMV.");
      if (cause instanceof AuthenticatedApiError && cause.status === 409) {
        setReviewed(false);
        onUpdated();
      }
    } finally { setBusy(false); }
  }

  return <div className="mt-4 border-t pt-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl space-y-1">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {closed ? <LockKeyhole className="h-4 w-4" /> : <UnlockKeyhole className="h-4 w-4" />}
          {unitName ? closed ? "CMV congelado" : "CMV em aberto" : `CMV congelado em ${closedCount} de ${entries.length} unidade(s)`}
        </p>
        <p className="text-xs text-muted-foreground">O fechamento guarda somente o CMV por composição. As fichas técnicas continuam atualizadas; receitas e despesas seguem suas próprias regras.</p>
        {!unitName && <p className="text-xs text-muted-foreground">Selecione uma unidade para conferir e fechar o CMV do mês.</p>}
        {entry && !closed && <p className="text-xs text-muted-foreground">Enquanto aberto, o cálculo usa os custos atuais. {pastMonth ? "Confira as vendas antes de confirmar o fechamento." : "O fechamento fica disponível após o término do mês."}</p>}
        {entry?.closedAt && <p className="text-xs text-muted-foreground">Fechado em {displayDate(entry.closedAt)} · revisão {entry.revision}. Custos vigentes nessa confirmação.</p>}
        {entry?.sourceChanged && <p role="alert" className="text-sm font-medium text-amber-800">As vendas mudaram após o fechamento. O CMV permanece congelado; reabra para conferir e fechar novamente. Resultado e exportação ficam pendentes.</p>}
      </div>
      {entry && (closed ? capabilities.canReopen : capabilities.canClose) && <Button variant="outline"
        disabled={disabled || busy || (!closed && (!pastMonth || !entry.complete))}
        onClick={() => { setAction(closed ? "reopen" : "close"); setReviewed(false); setReason(""); setError(null); }}>
        {closed ? "Reabrir CMV" : "Fechar CMV do mês"}
      </Button>}
    </div>
    <Dialog open={action !== null} onOpenChange={open => { if (!open && !busy) setAction(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "reopen" ? "Reabrir CMV do mês" : "Confirmar fechamento do CMV"}</DialogTitle>
          <DialogDescription>{unitName} · {month.split("-").reverse().join("/")}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">CMV {closed ? "congelado" : "calculado"}: <strong>{value}</strong></p>
        {action === "close" ? <>
          <p className="text-sm text-muted-foreground">Serão guardadas as quantidades vendidas e os custos vigentes nesta confirmação, mesmo que o fechamento ocorra no mês seguinte. Alterações futuras de preço não mudarão este CMV.</p>
          <div className="flex items-start gap-2"><Checkbox id={confirmationId} checked={reviewed} onCheckedChange={value => setReviewed(value === true)} disabled={busy} />
            <label htmlFor={confirmationId} className="text-sm">Conferi a sincronização e as vendas desta unidade e competência.</label></div>
        </> : <>
          <p className="text-sm text-muted-foreground">O CMV voltará a usar as vendas e os custos atuais. A versão anterior continuará preservada no histórico.</p>
          <label htmlFor={reasonId} className="text-sm font-medium">Motivo da reabertura</label>
          <Textarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} disabled={busy} placeholder="Descreva o que precisa ser corrigido" />
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>Cancelar</Button>
          <Button onClick={() => void confirm()} disabled={disabled || busy || !entry || (action === "close" ? !reviewed || !entry.complete || !pastMonth : reason.trim().length < 5)}>
            {busy ? "Salvando…" : action === "close" ? "Confirmar fechamento" : "Confirmar reabertura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
