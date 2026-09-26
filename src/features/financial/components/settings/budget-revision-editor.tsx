"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBudgetSchema, updateBudgetSchema } from "@/features/financial/budgets/schemas";
import type { FinancialBudgetSummary } from "@/features/financial/budgets/types";
import { formatCurrency } from "@/features/financial/lib/utils";
import { budgetRequest, validateBudgetPeople } from "./budget-api";
import { BudgetCompositionEditor } from "./budget-composition-editor";
import { compositionTotal, draftFromSnapshot, revisedComposition, type BudgetAccountOption } from "./budget-ui-model";

export function BudgetRevisionEditor({ budget, accounts, onSaved, onCancel }: {
  budget: FinancialBudgetSummary; accounts: BudgetAccountOption[];
  onSaved: () => Promise<void>; onCancel: () => void;
}) {
  const [lines, setLines] = useState(() => (budget.composition ?? []).map(draftFromSnapshot));
  const [amount, setAmount] = useState(budget.budgetedAmountCents / 100);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composed = Boolean(budget.hasComposition || budget.composition?.length);
  const total = composed ? compositionTotal(lines) : Math.round(amount * 100);

  async function save() {
    setSaving(true); setError(null);
    try {
      const composition = composed ? revisedComposition(lines, budget.composition ?? []) : undefined;
      const candidate = createBudgetSchema.safeParse({ ...budget, budgetedAmountCents: total, composition });
      const patch = updateBudgetSchema.safeParse({ budgetedAmountCents: total, reason: reason.trim(), ...(composition ? { composition } : {}) });
      if (!candidate.success || !patch.success || reason.trim().length < 5) throw new Error("Confira as linhas, as datas, o total e o motivo da revisão (5 a 500 caracteres).");
      if (composition) await validateBudgetPeople(composition.map((line) => line.employeeId), budget.competenceMonth, budget.resultCenterId!);
      await budgetRequest(`/api/financial/budgets/${encodeURIComponent(budget.id)}`, "PATCH", patch.data);
      await onSaved(); onCancel();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar a revisão."); }
    finally { setSaving(false); }
  }

  return <fieldset disabled={saving} className="space-y-3 rounded-xl border p-4">
    <legend className="px-1 text-sm font-semibold">Revisão explícita · {budget.competenceMonth}</legend>
    <p className="text-sm text-muted-foreground">Esta revisão altera somente o snapshot deste mês. A regra automática e os meses anteriores são preservados. Mudanças na composição exigem nova conferência de cobertura.</p>
    {composed ? <BudgetCompositionEditor lines={lines} onChange={setLines} resultCenterId={budget.resultCenterId!} accounts={accounts.filter((account) => budget.accountPlanIds.includes(account.id))}
      month={budget.competenceMonth} centerName={budget.resultCenterName ?? "Centro do orçamento"} disabled={saving} lockedLineIds={(budget.composition ?? []).map((line) => line.id)} />
      : <div className="space-y-1"><Label htmlFor={`revision-amount-${budget.id}`}>Novo valor</Label><CurrencyInput id={`revision-amount-${budget.id}`} value={amount} onChange={setAmount} /></div>}
    <p className="text-sm">Antes: {formatCurrency(budget.budgetedAmountCents / 100)} · Após a revisão: <strong>{formatCurrency(total / 100)}</strong></p>
    <div className="space-y-1"><Label htmlFor={`revision-reason-${budget.id}`}>Motivo da revisão</Label><Textarea id={`revision-reason-${budget.id}`} value={reason} minLength={5} maxLength={500} onChange={(event) => setReason(event.target.value)} /></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" disabled={saving || reason.trim().length < 5} onClick={() => void save()}>{saving ? "Registrando…" : "Salvar revisão deste mês"}</Button><Button type="button" variant="outline" disabled={saving} onClick={onCancel}>Cancelar</Button></div>
  </fieldset>;
}
