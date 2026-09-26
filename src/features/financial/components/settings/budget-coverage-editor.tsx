"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BudgetPersonSummary, FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { budgetRequest } from "./budget-api";
import { canDispensePurchase, coveragePayload, type CoverageChoice } from "./budget-ui-model";

export function BudgetCoverageEditor({ budget, line, onSaved, onCancel }: {
  budget: FinancialBudgetSummary; line: BudgetPersonSummary; onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const [state, setState] = useState<CoverageChoice>(canDispensePurchase(line) ? "not_required" : "partial");
  const [residual, setResidual] = useState<number | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const payload = coveragePayload(line, state, reason, confirmed, residual);
      await budgetRequest(`/api/financial/budgets/${encodeURIComponent(budget.id)}/coverage`, "POST", payload);
      await onSaved(); onCancel();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a cobertura. Atualize a apuração e confira novamente."); }
    finally { setSaving(false); }
  }

  return <fieldset disabled={saving} className="space-y-3 rounded-xl border bg-muted/20 p-4">
    <legend className="px-1 text-sm font-semibold">Conferir cobertura · {line.employeeName}</legend>
    <p className="text-sm">Competência {budget.competenceMonth} · {budget.resultCenterName}. A cobertura registra a expectativa de compra; não altera pagamentos.</p>
    <div className="space-y-1"><Label htmlFor={`coverage-state-${line.id}`}>O que esta conferência confirma?</Label>
      <Select disabled={saving} value={state} onValueChange={(value) => { setState(value as CoverageChoice); setConfirmed(false); }}>
        <SelectTrigger id={`coverage-state-${line.id}`}><SelectValue /></SelectTrigger><SelectContent>
          {line.documentIds.length > 0 && <><SelectItem value="partial">Cobertura parcial: ainda pode haver compra</SelectItem><SelectItem value="final">Cobertura final: documentos encerram a compra</SelectItem></>}
          {canDispensePurchase(line) && <SelectItem value="not_required">Não haverá compra neste mês</SelectItem>}
        </SelectContent></Select></div>
    {state === "partial" && <div className="space-y-1"><Label htmlFor={`coverage-residual-${line.id}`}>Revisar compra ainda esperada (opcional)</Label>
      <CurrencyInput id={`coverage-residual-${line.id}`} value={residual === undefined ? "" : residual / 100} onChange={(value) => { setResidual(Math.round(value * 100)); setConfirmed(false); }} />
      <p className="text-xs text-muted-foreground">Sem revisão, o servidor mantém o cálculo. Apurado agora: {formatCurrency(line.residualAmountCents / 100)}.</p>
      {residual !== undefined && <Button type="button" size="sm" variant="ghost" onClick={() => { setResidual(undefined); setConfirmed(false); }}>Usar cálculo da apuração</Button>}</div>}
    {state !== "partial" && <p className="text-sm">Compra ainda esperada após confirmar: {formatCurrency(0)}. O orçamento original e o saldo continuam registrados.</p>}
    <div className="space-y-1"><p className="text-sm font-medium">Documentos conferidos ({line.documentIds.length})</p>
      {line.documentIds.length ? <ul className="space-y-1 text-sm">{line.documentIds.map((id) => {
        const document = budget.expenses.find((expense) => expense.id === id);
        return <li key={id}>{document?.description || "Documento vinculado"} · <span className="break-all font-mono text-xs">{id}</span></li>;
      })}</ul> : <p className="text-sm text-muted-foreground">Nenhum documento vinculado. A dispensa exige motivo explícito; a ausência em um boleto, sozinha, não encerra a previsão.</p>}
    </div>
    <div className="space-y-1"><Label htmlFor={`coverage-reason-${line.id}`}>Motivo da conferência</Label><Textarea id={`coverage-reason-${line.id}`} minLength={5} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmed(false); }} /></div>
    <label className="flex items-start gap-2 text-sm"><Checkbox disabled={saving} checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
      <span>{state === "not_required" ? "Confirmo que não haverá compra para esta pessoa e conta nesta competência." : "Conferi todos os documentos listados e confirmo esta situação de cobertura."}</span></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={saving || !confirmed || reason.trim().length < 5} onClick={() => void save()}>{saving ? "Registrando…" : "Confirmar cobertura"}</Button><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancelar</Button></div>
  </fieldset>;
}
