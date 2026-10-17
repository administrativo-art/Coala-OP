"use client";

import { useMemo, useState } from "react";
import { Check, Landmark, PackagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBRL } from "../money";
import {
  cashSupplyClassificationForMovement,
  cashSupplyClassificationSummary,
  cashSupplyMovements,
  requiresCashSupplyClassification,
} from "../supply-classification";
import type { CashClosureWithLines, CashSupplyClassificationKind } from "../types";

type Props = {
  data: CashClosureWithLines;
  operatorId: string;
  editable: boolean;
  onClassify: (input: {
    lineId: string;
    movementId: string;
    classification: CashSupplyClassificationKind;
  }) => Promise<void>;
};

function movementDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CashSuppliesPanel({ data, operatorId, editable, onClassify }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const lines = useMemo(
    () => data.lines.filter((line) => line.operatorId === operatorId),
    [data.lines, operatorId],
  );
  const operator = data.operators.find((item) => item.operatorId === operatorId);
  const finalized = operator?.status === "approved";
  const summary = cashSupplyClassificationSummary(lines, { operatorStatus: operator?.status });
  const items = lines.flatMap((line) => cashSupplyMovements(line).map((movement) => ({
    line,
    movement,
    classification: cashSupplyClassificationForMovement(line, movement),
  })));
  const protectedHistory = finalized && items.some((item) => !item.classification);

  if (!requiresCashSupplyClassification(data.closure.date)) return null;

  const classify = async (
    lineId: string,
    movementId: string,
    classification: CashSupplyClassificationKind,
  ) => {
    const key = `${lineId}:${movementId}`;
    if (busy) return;
    setBusy(key);
    setError("");
    try {
      await onClassify({ lineId, movementId, classification });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível classificar o suprimento.");
    } finally {
      setBusy(null);
    }
  };

  return <Card className="border-ds-border bg-white">
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Suprimentos deste operador</CardTitle>
          <CardDescription className="mt-1 max-w-2xl">
            Classifique cada entrada do PDV. Fundo de caixa permanece na unidade e sai do esperado do malote; suprimento comum continua no valor que o Financeiro deve contar.
          </CardDescription>
        </div>
        <span className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-black",
          protectedHistory
            ? "bg-ds-muted text-ds-ink-muted"
            : summary.pending > 0 ? "bg-ds-warn-bg text-ds-warn-ink" : "bg-ds-ok-bg text-ds-ok",
        )}>
          {protectedHistory
            ? "Finalizado · histórico preservado"
            : summary.pending > 0 ? `${summary.pending} pendente(s)` : "Classificação concluída"}
        </span>
      </div>
    </CardHeader>
    <CardContent className="space-y-3">
      {items.length === 0 ? <p className="rounded-xl border border-dashed border-ds-border px-4 py-5 text-sm text-ds-ink-muted">Nenhum suprimento registrado no PDV para este operador.</p> : items.map(({ line, movement, classification }) => {
        const key = `${line.id}:${movement.id}`;
        const saving = busy === key;
        return <div key={key} className={cn(
          "rounded-2xl border p-4",
          classification ? "border-ds-border bg-ds-muted" : "border-ds-alert-border bg-ds-warn-bg",
        )}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <strong className="block text-sm text-ds-ink">{movement.pdvDescription ?? `Suprimento ${movement.id}`}</strong>
              <span className="mt-1 block text-xs text-ds-ink-muted">{movementDateTime(movement.occurredAt)} · registro {movement.id}</span>
            </div>
            <strong className="font-mono text-base tabular-nums text-ds-ink">{formatBRL(movement.amountCents)}</strong>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="group" aria-label={`Classificação do suprimento ${movement.id}`}>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-auto min-h-16 justify-start whitespace-normal px-3 py-3 text-left",
                classification?.kind === "cash_fund" && "border-ds-modal bg-ds-modal-soft text-ds-modal-ink",
              )}
              disabled={!editable || finalized || !!busy}
              aria-pressed={classification?.kind === "cash_fund"}
              onClick={() => void classify(line.id, movement.id, "cash_fund")}
            >
              {classification?.kind === "cash_fund" ? <Check className="mr-2 h-4 w-4 shrink-0" /> : <Landmark className="mr-2 h-4 w-4 shrink-0" />}
              <span><strong className="block">Fundo de caixa</strong><span className="mt-0.5 block text-[11px] font-medium opacity-80">Permanece na unidade; não vai no malote.</span></span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-auto min-h-16 justify-start whitespace-normal px-3 py-3 text-left",
                classification?.kind === "supply" && "border-ds-modal bg-ds-modal-soft text-ds-modal-ink",
              )}
              disabled={!editable || finalized || !!busy}
              aria-pressed={classification?.kind === "supply"}
              onClick={() => void classify(line.id, movement.id, "supply")}
            >
              {classification?.kind === "supply" ? <Check className="mr-2 h-4 w-4 shrink-0" /> : <PackagePlus className="mr-2 h-4 w-4 shrink-0" />}
              <span><strong className="block">Suprimento</strong><span className="mt-0.5 block text-[11px] font-medium opacity-80">Continua compondo o esperado do malote.</span></span>
            </Button>
          </div>
          {saving && <p role="status" className="mt-2 text-xs font-semibold text-ds-ink-muted">Salvando classificação…</p>}
          {finalized && <p className="mt-2 text-xs font-semibold text-ds-ink-muted">
            {classification
              ? "Reabra este operador para corrigir a classificação."
              : "Este operador já estava finalizado e não foi alterado pela nova regra. Reabra-o somente se precisar revisar a contagem."}
          </p>}
        </div>;
      })}
      {summary.cashFundCents > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ds-ok/20 bg-ds-ok-bg px-4 py-3 text-sm text-ds-ok">
        <span className="font-bold">Fundo de caixa que permanecerá na unidade</span>
        <strong className="font-mono">{formatBRL(summary.cashFundCents)}</strong>
      </div>}
      {error && <p role="alert" className="text-sm font-semibold text-ds-danger">{error}</p>}
    </CardContent>
  </Card>;
}
