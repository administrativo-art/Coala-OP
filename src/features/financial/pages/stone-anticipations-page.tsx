"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { AnticipationWorkspace } from "@/features/financial/agent/anticipation-workspace";
import { formatStoneMoney } from "@/features/financial/agent/presentation";
import type { StoneAnticipationReview } from "@/lib/integrations/stone/anticipation-review";

const money = formatStoneMoney;
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "Não informada";
const statuses = { paid_early: "Pago antes do vencimento", regular_payment: "Pagamento no prazo ou posterior", needs_review: "Revisar vínculo" };

export function StoneAnticipationsPage({ agentEntry = false }: { agentEntry?: boolean }) {
  const { isDefaultAdmin } = useAuth();
  const [result, setResult] = useState<StoneAnticipationReview | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  if (!isDefaultAdmin) return <PageContainer><p role="alert">Consulta restrita à administração.</p></PageContainer>;
  const ordered = result ? result.rows.filter(row => filter === "all" || row.status === filter).sort((a, b) => {
    const rank = { paid_early: 0, needs_review: 1, regular_payment: 2 };
    return rank[a.status] - rank[b.status] || a.transactionId.localeCompare(b.transactionId);
  }) : [];
  return <PageContainer variant="wide" className="space-y-6 py-6">
    <header><h1 className="text-2xl font-semibold">{agentEntry ? "Coala Financeiro" : "Conferência de antecipações Stone"}</h1>
      {agentEntry && <p className="text-sm text-muted-foreground">Análise guiada de antecipações. Agenda futura completa, DRE e análise geral de caixa ainda não estão disponíveis neste agente.</p>}
      <p className="text-muted-foreground">Pagamentos comparados com as parcelas originais. Somente leitura, sem baixas ou lançamentos na DRE.</p></header>
    <AnticipationWorkspace onResult={value => { setResult(value); setPage(0); setFilter("all"); }} />
    <p className="text-sm text-muted-foreground">Consulta manual de até 31 datas de origem. Não representa o saldo total a receber. O vínculo oficial é validado no servidor em cada consulta.</p>
    {result && <section className="space-y-4" aria-label="Resultado da conferência">
      <p>StoneCode {result.stoneCode} · Pagamentos de {date(result.referenceDate)} · Consulta: {new Date(result.collectedAt).toLocaleString("pt-BR")}</p>
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950" role="status">
        Operação RAV/Registradora ainda não consultada. Entrada bancária não conciliada. Custo informado no XML e desconto adicional calculado são evidências distintas.
      </div>
      {(result.unavailableDates.length > 0 || result.skippedDates.length > 0) && <p role="alert">
        Cobertura incompleta. Datas indisponíveis: {result.unavailableDates.map(date).join(", ") || "nenhuma"}.
        Datas fora do limite: {result.skippedDates.map(date).join(", ") || "nenhuma"}. Não conclua ausência de antecipação nas parcelas pendentes.
      </p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Parcelas pagas antes do prazo", String(result.summary.earlyCount)], ["Bruto dessas parcelas", money(result.summary.gross)],
          ["Líquido informado pela Stone", money(result.summary.paidNet)], ["Desconto adicional calculado", money(result.summary.additionalDiscount)]].map(([title, value]) =>
          <div key={title} className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">{title}</p><p className="text-xl font-semibold">{value}</p></div>)}
      </div>
      <p>MDR informado das parcelas pagas antes do prazo: {money(result.summary.mdr)} · Vínculos pendentes: {result.summary.pendingCount} · Pagamentos no prazo ou posteriores: {result.summary.regularCount}</p>
      <p>Custo de antecipação informado no XML: {money(result.summary.anticipationFee)} · Parcelas com antecipação explícita validada: {result.summary.providerConfirmedCount} · Diferença não explicada pelas taxas: {money(result.summary.unexplainedDifference)}</p>
      <label className="block">Exibir parcelas <select aria-label="Filtrar parcelas" className="rounded-md border bg-background p-2" value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }}>
        <option value="all">Todas</option><option value="paid_early">Pagas antes do prazo</option><option value="needs_review">Pendentes de conferência</option><option value="regular_payment">No prazo ou posteriores</option>
      </select></label>
      {!ordered.length ? <p>{result.rows.length ? "Nenhuma parcela corresponde ao filtro selecionado." : "Nenhuma parcela com evento de pagamento neste arquivo. Isso não comprova ausência de antecipações em outros arquivos."}</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Parcelas e evidências do pagamento</caption>
          <thead><tr>{["Transação / parcela", "Venda", "Vencimento original", "Pagamento Stone", "Bruto", "Líquido original", "Líquido pago", "MDR", "Antecipação informada", "Desconto adicional calculado", "Situação / evidência"].map(t => <th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
          <tbody>{ordered.slice(page * 50, (page + 1) * 50).map(row => <tr key={`${row.transactionId}:${row.installment}`} className="border-t">
            <td className="p-2">{row.transactionId} / {row.installment}</td><td>{date(row.saleDate)}</td><td>{date(row.originalDueDate)}</td><td>{date(row.paymentDate)}</td>
            <td>{money(row.gross)}</td><td>{money(row.originalNet)}</td><td>{money(row.paidNet)}</td><td>{money(row.mdr)}</td><td>{money(row.anticipationFee)}</td><td>{money(row.additionalDiscount)}</td>
            <td className="p-2">{statuses[row.status]}{row.providerAnticipationConfirmed && <p>Antecipação explícita no XML</p>}{row.reason && <p>{row.reason}</p>}<p className="text-xs text-muted-foreground">Pagamento: {row.paymentId ?? "não informado"} · Origem: {row.originalFileId ?? "não localizada"} · Vencimento informado na antecipação: {date(row.providerOriginalDueDate)}</p></td>
          </tr>)}</tbody></table></div>
        <div className="flex items-center gap-4"><Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button>
          <span>Página {page + 1} de {Math.ceil(ordered.length / 50)}</span><Button variant="outline" disabled={(page + 1) * 50 >= ordered.length} onClick={() => setPage(page + 1)}>Próxima</Button></div>
      </>}
      <p className="text-xs text-muted-foreground">Arquivo de pagamento: {result.paymentFileId}. Totais somados na precisão original; linhas exibidas com duas casas decimais. Nenhuma alteração na agenda, no caixa ou na DRE.</p>
    </section>}
  </PageContainer>;
}
