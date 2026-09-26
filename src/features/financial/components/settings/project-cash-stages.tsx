"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { budgetRequest } from "./budget-api";
import { formatCurrency } from "../../lib/utils";
import type { FinancialBudgetProjectSummary } from "../../budgets/types";
import { projectDateLabel } from "./project-cash-plan-editor";

export function ProjectCashStages({ project, canManage, onSaved }: { project: FinancialBudgetProjectSummary; canManage: boolean; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function confirm() {
    const stage = project.cashStages?.find((entry) => entry.id === editing);
    if (!stage) return;
    setSaving(true);
    try {
      await budgetRequest(`/api/financial/budget-projects/${encodeURIComponent(project.id)}/stages`, "POST", {
        stageId: stage.id, closed: !stage.closed, reason, evidence: stage.evidence, confirmed: true,
      });
      setEditing(""); setReason(""); await onSaved();
      toast({ title: stage.closed ? "Expectativa reaberta." : "Expectativa encerrada. Nenhum pagamento foi alterado." });
    } catch (cause) { toast({ variant: "destructive", title: cause instanceof Error ? cause.message : "Não foi possível conferir a etapa." }); }
    finally { setSaving(false); }
  }
  return <div className="space-y-3"><h4 className="text-sm font-semibold">Cronograma e gasto ainda esperado</h4>
    <p className="text-xs text-muted-foreground">A despesa real substitui a previsão da etapa escolhida. Pagar a despesa não desconta novamente. Encerre a expectativa quando não houver mais compras nessa etapa.</p>
    {!project.cashPlan && <p className="rounded-lg border border-dashed p-3 text-sm">Este projeto ainda não tem previsão no fluxo. Use “Configurar cronograma”; os dados existentes serão preservados.</p>}
    {project.cashStages?.map((stage) => <div key={stage.id} className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">{stage.name} · {projectDateLabel(stage.startDate)}{stage.startDate !== stage.endDate ? ` a ${projectDateLabel(stage.endDate)}` : ""}{stage.closed ? " · expectativa encerrada" : ""}</p>
      <div className="grid gap-2 sm:grid-cols-3"><span>Previsto: {formatCurrency(stage.amountCents / 100)}</span><span>Despesas vinculadas: {formatCurrency(stage.committedAmountCents / 100)}</span><span>Ainda esperado: {formatCurrency(stage.residualAmountCents / 100)}</span></div>
      {stage.requiresReview && <p className="text-amber-700">O cronograma ou as despesas mudaram após a conferência. Confira novamente o que ainda falta gastar.</p>}
      {canManage && project.active && <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => { setEditing(stage.id); setReason(""); }}>{stage.closed ? "Reabrir expectativa" : "Não haverá mais gastos nesta etapa"}</Button>}
      {editing === stage.id && <div className="space-y-2 rounded-lg bg-muted/30 p-3">
        <p>{stage.closed ? "O saldo ainda não coberto voltará à previsão." : `Retirar ${formatCurrency(stage.residualAmountCents / 100)} da previsão restante? As despesas existentes continuam a pagar ou pagas, sem alteração.`}</p>
        <Label htmlFor={`closure-${stage.id}`}>Motivo da conferência</Label><Input id={`closure-${stage.id}`} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: Etapa concluída, nenhuma compra adicional" />
        <div className="flex gap-2"><Button disabled={saving || reason.trim().length < 5} onClick={() => void confirm()}>Confirmar</Button><Button disabled={saving} variant="ghost" onClick={() => setEditing("")}>Cancelar</Button></div>
      </div>}
    </div>)}
    {project.originalCashPlan && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Planejamento original (referência preservada)</summary>
      <div className="mt-2 space-y-1">{project.originalCashPlan.stages.map((stage) => <p key={stage.id}>{stage.name} · {projectDateLabel(stage.startDate)} a {projectDateLabel(stage.endDate)} · {formatCurrency(stage.amountCents / 100)}</p>)}</div>
    </details>}
  </div>;
}
