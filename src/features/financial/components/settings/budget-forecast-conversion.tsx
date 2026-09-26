"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { budgetRequest } from "./budget-api";
import { formatCurrency } from "../../lib/utils";
import type { FinancialBudgetSummary } from "../../budgets/types";
import type { ForecastConversionCandidate, ForecastConversionInput } from "../../budgets/forecast-conversion";

type Candidate = Partial<ForecastConversionCandidate> & { id: string; description: string; blocked: string | null };
type Preview = { fingerprint: string; preview: { forecastAmountCents: number; residualBeforeCents: number; residualAfterCents: number; dreEffect: string;
  rows: Array<ForecastConversionCandidate & { destinations: Array<{ budgetId: string; lineId: string; resultCenterName: string; amountCents: number }> }> } };

export function BudgetForecastConversion({ month, resultCenterId, onImport, onSaved }: {
  month: string; resultCenterId: string; onImport: (rows: ForecastConversionCandidate[]) => void; onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Candidate[]>([]);
  const [budgets, setBudgets] = useState<FinancialBudgetSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<(Preview & { input: ForecastConversionInput }) | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const chosen = rows.filter((row) => selected.includes(row.id) && !row.blocked) as ForecastConversionCandidate[];
  async function load() {
    setBusy(true); setPreview(null); setSelected([]); setMessage(null); setConfirmed(false);
    try {
      const [candidates, envelopes] = await Promise.all([
        budgetRequest<{ candidates: Candidate[] }>(`/api/financial/budgets/forecast-conversion?month=${month}`),
        budgetRequest<{ budgets: FinancialBudgetSummary[] }>(`/api/financial/budgets?month=${month}`),
      ]);
      setRows(candidates.candidates); setBudgets(envelopes.budgets);
      if (!candidates.candidates.length) setMessage("Nenhuma previsão de VT aberta nesta competência.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao consultar previsões."); }
    finally { setBusy(false); }
  }
  async function preflight() {
    setBusy(true); setMessage(null); setPreview(null); setConfirmed(false);
    try {
      const input: ForecastConversionInput = { month, reason, mappings: chosen.map((source) => ({ expenseId: source.id,
        destinations: budgets.filter((budget) => budget.active && budget.competenceMonth === month).flatMap((budget) => (budget.composition ?? [])
          .filter((line) => line.employeeId === source.employeeId && line.accountPlanId === source.accountPlanId)
          .map((line) => ({ budgetId: budget.id, lineId: line.id }))),
      })) };
      if (input.mappings.some((mapping) => !mapping.destinations.length)) throw new Error("Crie primeiro os orçamentos de destino com a composição das pessoas selecionadas.");
      const result = await budgetRequest<Preview>("/api/financial/budgets/forecast-conversion", "POST", { input });
      setPreview({ ...result, input });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Prévia bloqueada."); }
    finally { setBusy(false); }
  }
  async function convert() {
    if (!preview || !confirmed) return;
    setBusy(true); setMessage(null);
    try {
      await budgetRequest("/api/financial/budgets/forecast-conversion", "POST", { input: preview.input, confirmation: { fingerprint: preview.fingerprint, confirmed: true } });
      setRows([]); setSelected([]); setPreview(null); setConfirmed(false);
      setMessage("Previsões transferidas para os orçamentos. Histórico preservado; boleto e pagamentos não foram alterados.");
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Conversão bloqueada; atualize a prévia."); setPreview(null); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Transição das provisões antigas de VT · administrador</summary>
    <fieldset disabled={busy} className="mt-4 space-y-4"><p className="text-sm text-muted-foreground">1. Consulte as previsões. 2. Traga-as como rascunho ou crie os orçamentos por centro. 3. Confira a prévia de conversão. Consultar e importar rascunho não alteram despesas.</p>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>Consultar provisões de {month}</Button>
      {rows.map((row) => <label key={row.id} className="flex items-start gap-3 rounded-lg border p-3 text-sm"><Checkbox disabled={busy || Boolean(row.blocked)} checked={selected.includes(row.id)}
        onCheckedChange={(checked) => { setSelected((old) => checked === true ? [...old, row.id] : old.filter((id) => id !== row.id)); setPreview(null); setConfirmed(false); }} />
        <span>{row.description}{row.amountCents != null ? ` · ${formatCurrency(row.amountCents / 100)}` : ""}<span className="block text-xs text-muted-foreground">{row.blocked || `Compra prevista: ${row.expectedPurchaseDate}`}</span></span></label>)}
      {chosen.length > 0 && <><Button variant="outline" onClick={() => {
        if (!resultCenterId || chosen.some((row) => row.resultCenterId !== resultCenterId)) { setMessage("Para importar o rascunho, selecione um centro e apenas previsões já atribuídas a ele. Repartições diferentes exigem composição manual; não serão inventadas."); return; }
        onImport(chosen); setMessage("Rascunho preenchido. Confira e salve o orçamento; as previsões antigas continuam intactas.");
      }}>Trazer selecionadas para o rascunho do centro</Button>
        <div><Label htmlFor="forecast-conversion-reason">Motivo da transição</Label><Textarea id="forecast-conversion-reason" minLength={5} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setPreview(null); setConfirmed(false); }} /></div>
        <Button variant="outline" disabled={busy || reason.trim().length < 5 || chosen.length > 20} onClick={() => void preflight()}>Conferir antes e depois (sem alterar)</Button></>}
      {preview && <div className="space-y-3 rounded-lg border bg-muted/20 p-4"><p className="font-semibold">Confira os destinos e o efeito nos relatórios</p>
        {preview.preview.rows.map((row) => <div key={row.id} className="text-sm"><p>{row.description} · {formatCurrency(row.amountCents / 100)} · {row.expectedPurchaseDate}</p>
          {row.destinations.map((target) => <p key={`${target.budgetId}:${target.lineId}`} className="pl-3">{target.resultCenterName} · {formatCurrency(target.amountCents / 100)}</p>)}</div>)}
        <p className="text-sm">Previsões retiradas das despesas: {formatCurrency(preview.preview.forecastAmountCents / 100)}. Compra residual nos orçamentos: de {formatCurrency(preview.preview.residualBeforeCents / 100)} para {formatCurrency(preview.preview.residualAfterCents / 100)}.</p>
        <p className="text-sm">{preview.preview.dreEffect}</p>
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />Conferi pessoas, centros, valores e datas. Autorizo retirar estas previsões das despesas e manter a expectativa nos orçamentos. Nenhum pagamento será feito.</label>
        <Button disabled={busy || !confirmed} onClick={() => void convert()}>Confirmar transferência para orçamento</Button>
      </div>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </fieldset></details>;
}
