"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/features/financial/lib/utils";
import { compositionTotal, purchaseDatePreview, type BudgetAccountOption, type BudgetLineDraft, type BudgetPersonOption } from "./budget-ui-model";
import { budgetRequest } from "./budget-api";

type Props = {
  lines: BudgetLineDraft[];
  onChange: (lines: BudgetLineDraft[]) => void;
  resultCenterId: string;
  accounts: BudgetAccountOption[];
  month: string;
  centerName: string;
  repeating?: boolean;
  disabled?: boolean;
  lockedLineIds?: string[];
};

export function BudgetCompositionEditor({ lines, onChange, resultCenterId, accounts, month, centerName, repeating = false, disabled = false, lockedLineIds = [] }: Props) {
  const [people, setPeople] = useState<BudgetPersonOption[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const loadPeople = useCallback(async (nextCursor?: string) => {
    const version = ++requestVersion.current;
    setLoadingPeople(true); setPeopleError(null);
    try {
      const params = new URLSearchParams({ resultCenterId });
      if (nextCursor) params.set("cursor", nextCursor);
      const result = await budgetRequest<{ people: Array<{ employeeId: string; employeeName: string }>; nextCursor: string | null }>(`/api/financial/budgets/person-references?${params}`);
      if (version !== requestVersion.current) return;
      setPeople((previous) => [...new Map([...(nextCursor ? previous : []), ...result.people.map((person) => ({ id: person.employeeId, name: person.employeeName }))].map((person) => [person.id, person])).values()]);
      setCursor(result.nextCursor);
    } catch (cause) { if (version === requestVersion.current) setPeopleError(cause instanceof Error ? cause.message : "Não foi possível carregar as opções de colaboradores."); }
    finally { if (version === requestVersion.current) setLoadingPeople(false); }
  }, [resultCenterId]);
  useEffect(() => {
    setPeople([]); setCursor(null);
    if (resultCenterId) void loadPeople();
    return () => { requestVersion.current += 1; };
  }, [loadPeople, resultCenterId]);
  function update(id: string, change: Partial<BudgetLineDraft>) {
    onChange(lines.map((line) => line.id === id ? { ...line, ...change } : line));
  }
  const duplicate = new Set(lines.map((line) => JSON.stringify([line.employeeId, line.accountPlanId]))).size !== lines.length;
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border p-4" data-testid="budget-composition-editor">
    <legend className="px-1 text-sm font-semibold">Composição por colaborador · {centerName}</legend>
    <p className="text-sm text-muted-foreground">Selecione pessoa, conta e valor. A data de compra é independente da competência. Para repartir uma pessoa entre centros, use um orçamento em cada centro.</p>
    {loadingPeople && <p role="status" className="text-sm">Carregando colaboradores autorizados…</p>}
    {peopleError && <p role="alert" className="text-sm text-destructive">{peopleError}</p>}
    {!loadingPeople && !peopleError && people.length === 0 && <p role="status" className="text-sm text-muted-foreground">Nenhum colaborador disponível nas referências autorizadas deste perfil.</p>}
    {(cursor || peopleError) && <Button type="button" variant="outline" disabled={loadingPeople || disabled} onClick={() => void loadPeople(cursor ?? undefined)}>{peopleError ? "Tentar carregar colaboradores novamente" : "Carregar mais colaboradores"}</Button>}
    {lines.map((line, index) => {
      const personOptions = people.some((person) => person.id === line.employeeId) || !line.employeeId
        ? people : [...people, { id: line.employeeId, name: line.employeeName || "Colaborador do snapshot" }];
      return <div key={line.id} className="space-y-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Linha {index + 1}</p>
          <Button type="button" variant="ghost" size="icon" disabled={disabled} aria-label={`Remover linha ${index + 1}`} onClick={() => onChange(lines.filter((item) => item.id !== line.id))}><Trash2 className="h-4 w-4" /></Button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1"><Label htmlFor={`person-${line.id}`}>Colaborador</Label>
            <Select disabled={disabled || lockedLineIds.includes(line.id)} value={line.employeeId} onValueChange={(employeeId) => update(line.id, { employeeId, employeeName: personOptions.find((person) => person.id === employeeId)?.name ?? "" })}>
              <SelectTrigger id={`person-${line.id}`}><SelectValue placeholder="Selecione o colaborador" /></SelectTrigger><SelectContent>
                {personOptions.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
              </SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor={`account-${line.id}`}>Conta</Label>
            <Select disabled={disabled || lockedLineIds.includes(line.id)} value={line.accountPlanId} onValueChange={(accountPlanId) => update(line.id, { accountPlanId })}>
              <SelectTrigger id={`account-${line.id}`}><SelectValue placeholder="Selecione a conta" /></SelectTrigger><SelectContent>
                {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}
              </SelectContent></Select>
            {line.accountPlanId && !accounts.some((account) => account.id === line.accountPlanId) && <p role="alert" className="text-xs text-destructive">Escolha uma conta que pertença ao orçamento.</p>}</div>
          <div className="space-y-1"><Label htmlFor={`amount-${line.id}`}>Valor previsto</Label>
            <CurrencyInput id={`amount-${line.id}`} disabled={disabled} value={line.amountCents / 100} onChange={(value) => update(line.id, { amountCents: Math.round(value * 100) })} /></div>
          {repeating ? <>
            <div className="space-y-1"><Label htmlFor={`day-${line.id}`}>Dia da compra</Label><Input id={`day-${line.id}`} type="number" min={1} max={31} value={line.purchaseDay || ""} onChange={(event) => update(line.id, { purchaseDay: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor={`offset-${line.id}`}>Mês da compra</Label>
              <Select disabled={disabled} value={String(line.purchaseMonthOffset)} onValueChange={(value) => update(line.id, { purchaseMonthOffset: value === "-1" ? -1 : 0 })}>
                <SelectTrigger id={`offset-${line.id}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="-1">Anterior à competência</SelectItem><SelectItem value="0">Da competência</SelectItem></SelectContent></Select></div>
            <p className="self-end text-sm text-muted-foreground">Neste mês: {purchaseDatePreview(month, line.purchaseDay, line.purchaseMonthOffset) || "Revise a data"}. Dias inexistentes usam o último dia do mês.</p>
          </> : <div className="space-y-1"><Label htmlFor={`date-${line.id}`}>Data esperada de compra</Label><Input id={`date-${line.id}`} type="date" value={line.expectedPurchaseDate} onChange={(event) => update(line.id, { expectedPurchaseDate: event.target.value, estimateSource: "manual" })} /></div>}
        </div>
      </div>;
    })}
    {duplicate && <p role="alert" className="text-sm text-destructive">Não repita a mesma pessoa e conta neste centro.</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Button type="button" variant="outline" disabled={disabled || !people.length || !accounts.length || lines.length >= 100} onClick={() => onChange([...lines, {
        id: crypto.randomUUID(), employeeId: "", employeeName: "", accountPlanId: accounts.length === 1 ? accounts[0].id : "", amountCents: 0,
        expectedPurchaseDate: `${month}-01`, estimateSource: "manual", purchaseDay: 1, purchaseMonthOffset: 0,
      }])}><Plus className="mr-2 h-4 w-4" />Adicionar colaborador</Button>
      <p aria-live="polite" className="text-sm">Total derivado de {lines.length}/100 linhas: <strong>{formatCurrency(compositionTotal(lines) / 100)}</strong></p>
    </div>
    <p className="text-xs text-muted-foreground">{repeating ? "Repetição fixa dos valores informados; não calcula escala, tarifa ou dias úteis. Cada mês terá seu próprio snapshot." : "Estimativa manual deste mês. Alterações futuras exigem uma revisão com motivo."}</p>
  </fieldset>;
}
