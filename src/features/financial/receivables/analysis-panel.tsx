"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { receivableAnswer, receivableQuestions, type ReceivableEvidenceFilter, type ReceivableQuestion } from "./analysis";
import type { ReceivablePeriodResult } from "./period-review";

export function ReceivableAnalysisPanel({ result, unitName, accountName, onInspect }: {
  result: ReceivablePeriodResult;
  unitName: string;
  accountName: string;
  onInspect: (filter: ReceivableEvidenceFilter) => void;
}) {
  const [question, setQuestion] = useState<ReceivableQuestion>("future");
  const response = receivableAnswer(result, question);
  return <section className="space-y-3 rounded-lg border bg-muted p-4" aria-label="Coala Financeiro — recebíveis">
    <h2 className="text-lg font-semibold">Analisar com Coala Financeiro</h2>
    <label className="block">Sua pergunta
      <select aria-label="Pergunta sobre recebíveis" className="mt-1 w-full rounded-md border bg-background p-2" value={question}
        onChange={event => setQuestion(event.target.value as ReceivableQuestion)}>
        {Object.entries(receivableQuestions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <p aria-live="polite">{response.answer}</p>
    <p className="text-sm">Unidade: {unitName} · Conta vinculada: {accountName} · StoneCode: {result.scope.stoneCode}</p>
    <p className="text-sm">Fonte: Stone XML 2.2 · Consulta: {new Date(result.collectedAt).toLocaleString("pt-BR")}</p>
    <p className="text-sm text-muted-foreground">Análise por regras, sem modelo de IA. Trocar a pergunta reutiliza esta consulta. Para buscar eventos atualizados, consulte novamente o período.</p>
    <Button type="button" variant="outline" onClick={() => onInspect(response.filter)}>{response.evidenceLabel}</Button>
  </section>;
}
