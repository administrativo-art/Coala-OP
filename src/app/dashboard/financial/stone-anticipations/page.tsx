"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StoneAnticipationReview } from "@/lib/integrations/stone/anticipation-review";

const money = (value: string | null) => value === null ? "Não informado" :
  Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "Não informada";
const statuses = { paid_early: "Pago antes do vencimento", regular_payment: "Pagamento no prazo ou posterior", needs_review: "Revisar vínculo" };

export default function StoneAnticipationsPage() {
  const { isDefaultAdmin } = useAuth();
  const api = useAuthenticatedApi();
  const [stoneCode, setStoneCode] = useState("");
  const [referenceDate, setReferenceDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StoneAnticipationReview | null>(null);
  const [page, setPage] = useState(0);
  if (!isDefaultAdmin) return <PageContainer><p role="alert">Consulta restrita à administração.</p></PageContainer>;
  const ordered = result ? [...result.rows].sort((a, b) => {
    const rank = { paid_early: 0, needs_review: 1, regular_payment: 2 };
    return rank[a.status] - rank[b.status] || a.transactionId.localeCompare(b.transactionId);
  }) : [];
  return <PageContainer variant="wide" className="space-y-6 py-6">
    <header><h1 className="text-2xl font-semibold">Conferência de antecipações Stone</h1>
      <p className="text-muted-foreground">Pagamentos comparados com as parcelas originais. Somente leitura, sem baixas ou lançamentos na DRE.</p></header>
    <form className="flex flex-wrap items-end gap-4" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setError(""); setResult(null); setPage(0);
      try {
        const params = new URLSearchParams({ stoneCode, referenceDate });
        setResult(await api<StoneAnticipationReview>(`/api/financial/stone-anticipations?${params}`));
      } catch { setError("Não foi possível concluir a consulta. Verifique os filtros e tente novamente; nenhum valor foi lançado."); }
      finally { setBusy(false); }
    }}>
      <label className="space-y-2">StoneCode<Input aria-label="StoneCode" required pattern="[0-9]{1,20}" maxLength={20} value={stoneCode} disabled={busy} onChange={e => {setStoneCode(e.target.value); setResult(null);}} /></label>
      <label className="space-y-2">Dia do pagamento<Input aria-label="Dia do pagamento" type="date" required value={referenceDate} disabled={busy} onChange={e => {setReferenceDate(e.target.value); setResult(null);}} /></label>
      <Button type="submit" disabled={busy}>{busy ? "Conferindo origens…" : "Consultar pagamentos"}</Button>
    </form>
    <p className="text-sm text-muted-foreground">Consulta manual de até 31 datas de origem. Não representa o saldo total a receber. O StoneCode não é associado automaticamente a uma unidade.</p>
    {error && <p role="alert">{error}</p>}
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
      {!ordered.length ? <p>Nenhuma parcela com evento de pagamento neste arquivo. Isso não comprova ausência de antecipações em outros arquivos.</p> : <>
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
