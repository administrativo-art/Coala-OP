"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "../../lib/utils";
import { materializeProjectCashPlan } from "../../budgets/project-cash-plan";
import type { FinancialBudgetProject, ProjectCashPlan } from "../../budgets/types";

type Period = Pick<FinancialBudgetProject, "startMonth" | "endMonth" | "startDate" | "endDate" | "budgetedAmountCents">;
export const projectDateLabel = (date: string) => date.split("-").reverse().join("/");

export function ProjectCashPlanEditor({ value, onChange, period, disabled = false }: {
  value: ProjectCashPlan; onChange: (value: ProjectCashPlan) => void; period: Period; disabled?: boolean;
}) {
  let preview: ProjectCashPlan | null = null;
  let error = "";
  try { preview = materializeProjectCashPlan(period, value); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Confira as datas e os valores."; }
  const total = value.stages.reduce((sum, stage) => sum + stage.amountCents, 0);
  return <fieldset disabled={disabled} className="space-y-3 rounded-xl border bg-muted/20 p-4">
    <legend className="px-1 text-sm font-semibold">Como distribuir a previsão de desembolso?</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      <Button type="button" variant={value.mode === "uniform" ? "default" : "outline"} aria-pressed={value.mode === "uniform"}
        onClick={() => onChange({ mode: "uniform", stages: [] })}>Distribuir pelo período</Button>
      <Button type="button" variant={value.mode === "custom" ? "default" : "outline"} aria-pressed={value.mode === "custom"}
        onClick={() => onChange({ mode: "custom", stages: value.mode === "custom" ? value.stages : [] })}>Informar datas e valores</Button>
    </div>
    <p className="text-xs text-muted-foreground">O limite vale para o período inteiro. Esta previsão não cria uma despesa nem agenda um pagamento. A competência continua sendo informada em cada despesa.</p>
    {value.mode === "uniform" ? <p className="text-sm">O valor é dividido pelos dias, incluindo início e fim. Cada mês terá uma etapa para conferir as despesas que substituem a previsão.</p>
      : <div className="space-y-3">
        {value.stages.map((stage, index) => <div key={stage.id} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
          <div className="space-y-1"><Label htmlFor={`stage-name-${stage.id}`}>Etapa {index + 1}</Label><Input id={`stage-name-${stage.id}`} value={stage.name} placeholder="Ex.: Entrada da reforma" onChange={(event) => onChange({ ...value, stages: value.stages.map((s) => s.id === stage.id ? { ...s, name: event.target.value } : s) })} /></div>
          <div className="space-y-1"><Label htmlFor={`stage-date-${stage.id}`}>Previsão de pagamento</Label><Input id={`stage-date-${stage.id}`} type="date" value={stage.startDate} onChange={(event) => onChange({ ...value, stages: value.stages.map((s) => s.id === stage.id ? { ...s, startDate: event.target.value, endDate: event.target.value } : s) })} /></div>
          <div className="space-y-1"><Label htmlFor={`stage-amount-${stage.id}`}>Valor (R$)</Label><CurrencyInput id={`stage-amount-${stage.id}`} value={stage.amountCents / 100} onChange={(amount) => onChange({ ...value, stages: value.stages.map((s) => s.id === stage.id ? { ...s, amountCents: Math.round(Number(amount) * 100) } : s) })} /></div>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover etapa ${index + 1}`} onClick={() => onChange({ ...value, stages: value.stages.filter((s) => s.id !== stage.id) })}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" disabled={value.stages.length >= 36} onClick={() => {
          const date = period.startDate ?? `${period.startMonth}-01`;
          onChange({ ...value, stages: [...value.stages, { id: crypto.randomUUID(), name: `Etapa ${value.stages.length + 1}`, startDate: date, endDate: date, amountCents: Math.max(0, period.budgetedAmountCents - total) }] });
        }}><Plus className="mr-2 h-4 w-4" />Adicionar etapa</Button>
        <p className="text-sm">Distribuído: {formatCurrency(total / 100)} · Falta distribuir: {formatCurrency((period.budgetedAmountCents - total) / 100)}</p>
      </div>}
    {error && <p role="status" className="text-sm text-amber-700">{error}</p>}
    {preview && <div className="space-y-2 border-t pt-3"><p className="text-sm font-semibold">Prévia no fluxo de caixa</p>
      {preview.stages.map((stage) => <div key={stage.id} className="flex flex-wrap justify-between gap-2 text-sm"><span>{stage.name} · {projectDateLabel(stage.startDate)}{stage.endDate !== stage.startDate ? ` a ${projectDateLabel(stage.endDate)}` : ""}</span><span className="font-mono">{formatCurrency(stage.amountCents / 100)}</span></div>)}
    </div>}
  </fieldset>;
}
