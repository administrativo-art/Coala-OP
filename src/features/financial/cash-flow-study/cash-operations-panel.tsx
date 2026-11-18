"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { CASH_OPERATION_LABEL, CASH_PENDING_FROM, pendingCashOperations, type CashOperation } from "./cash-stages";
import { brl, Card, dmy } from "./study-ui";

/** Operational evidence is deliberately separate from cash-flow entries and their totals. */
export function CashOperationsPanel({ operations }: { operations: CashOperation[] }) {
  const [history, setHistory] = useState(false);
  const [all, setAll] = useState(false);
  const received = operations.filter(operation => operation.stage === "received");
  const pending = pendingCashOperations(operations);
  const rows = history ? received : pending;
  if (!operations.length) return null;
  return <Card title="Numerário: acompanhamento operacional" description="Estas pendências e referências históricas não somam entradas nem saldo previsto. Contagem e venda não comprovam crédito bancário. Moedas devolvidas ao fundo não geram nova entrada.">
    <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
      <Button aria-pressed={!history} variant={history ? "ds-secondary" : "primary-modal"} size="sm" onClick={() => { setHistory(false); setAll(false); }}>Pendências · {pending.length}</Button>
      <Button aria-pressed={history} variant={history ? "primary-modal" : "ds-secondary"} size="sm" onClick={() => { setHistory(true); setAll(false); }}>Recebidos · {received.length}</Button>
      <Button asChild variant="ds-ghost" size="sm"><Link href="/dashboard/financial/cash-deposits">Ver depósitos</Link></Button>
    </div>
    <p className="px-5 pb-3 text-xs text-ds-ink-muted">Pendências desde {dmy(CASH_PENDING_FROM)}. <Link href="/dashboard/financial/cash-closures" className="font-bold text-ds-accent-ink underline">Consultar períodos anteriores nos fechamentos</Link>.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
      <thead className="bg-ds-muted text-xs text-ds-ink-muted"><tr><th className="px-5 py-2">Unidade / origem</th><th className="px-4 py-2">Situação</th><th className="px-4 py-2">Referência do PDV</th><th className="px-4 py-2">Conferência</th></tr></thead>
      <tbody>{(all ? rows : rows.slice(0, 12)).map(operation => <tr key={operation.id} className="border-t border-ds-divider align-top">
        <td className="px-5 py-3"><strong>{operation.unitName}</strong><p className="text-xs text-ds-ink-muted">Vendas de {dmy(operation.originDate)}</p></td>
        <td className="px-4 py-3"><StatusPill variant={operation.stage === "received" ? "ok" : "warn"}>{CASH_OPERATION_LABEL[operation.stage]}</StatusPill>{operation.outsideDepositPolicy && operation.stage !== "received" ? <p className="mt-1 text-xs text-ds-ink-muted">Somente DRE; fora da previsão de depósito.</p> : null}</td>
        <td className="px-4 py-3 font-ds-mono">{brl(operation.referenceCents)}<p className="font-sans text-xs text-ds-ink-muted">Não é saldo a receber</p></td>
        <td className="px-4 py-3 text-xs text-ds-ink-muted">{operation.finalizedOperators} de {operation.totalOperators ?? "?"} contagens vinculadas{operation.allocatedOperators > 0 ? <p>{operation.allocatedOperators} contagens em malote validado.</p> : null}{operation.finalizedOperators > operation.allocatedOperators ? <p>{operation.finalizedOperators - operation.allocatedOperators} contagens ainda sem malote validado.</p> : null}{operation.receivedOperators ? <p>{operation.receivedOperators} em sessão com recebimento confirmado.</p> : null}{operation.stage === "partial" ? <p>Valor remanescente não apurado; não foi calculado por diferença.</p> : null}</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length ? <p className="px-5 py-4 text-sm text-ds-ink-muted">Nenhum item nesta situação no recorte consultado.</p> : null}
    {!all && rows.length > 12 ? <div className="px-5 py-3"><Button variant="ds-secondary" size="sm" onClick={() => setAll(true)}>Mostrar os {rows.length} itens carregados</Button></div> : null}
  </Card>;
}
