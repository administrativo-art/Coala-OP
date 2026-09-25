"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { formatStoneMoney } from "@/features/financial/agent/presentation";
import type { parseStoneWalletPosition } from "@/lib/integrations/stone/wallet-position-parser";
import type { StonePortfolioRow } from "./portfolio-projection";
import { walletNatureLabels, walletTypeLabels } from "./wallet-position-labels";

type RightsPosition = Pick<ReturnType<typeof parseStoneWalletPosition>,
  "referenceDate" | "status" | "rows" | "unknownNatureCount">;

type PortfolioResult = {
  status: "synchronized" | "not_synchronized";
  stoneCode: string; firstCaptureDate: string; asOf: string | null; updatedAt?: string;
  latestAvailableDate: string; stale: boolean;
  summary: { openCount: number; openNet: string | null; paidCount: number;
    reviewCount: number; unsupportedCaptureCount: number; paymentsWithoutOriginCount: number } | null;
  rows: StonePortfolioRow[];
  rightsPosition?: RightsPosition | null;
  missingDates?: string[];
};
const date = (value: string | null) => value ? value.split("-").reverse().join("/") : "—";

export function StonePortfolioPanel({ stoneCode }: { stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [result, setResult] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!stoneCode) return;
    let active = true;
    setLoading(true);
    setError("");
    api<PortfolioResult>(`/api/financial/stone-portfolio?stoneCode=${encodeURIComponent(stoneCode)}`)
      .then(value => { if (active) setResult(value); })
      .catch(cause => { if (active) setError(cause instanceof AuthenticatedApiError ? cause.message : "Não foi possível ler a carteira."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, stoneCode]);
  if (!stoneCode) return null;
  const open = result?.rows.filter(row => row.status === "open") ?? [];
  const summary = result?.summary;
  return <section aria-label="Carteira Stone automática" className="space-y-3 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold">Carteira Stone automática</h2>
        <p className="text-sm text-muted-foreground">Arquivos diários da Stone; atualização automática após a publicação do dia anterior.</p></div>
    </div>
    {loading && <p role="status">Carregando carteira…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {result?.status === "not_synchronized" && <p role="status">A primeira sincronização ainda não foi concluída.</p>}
    {result?.status === "synchronized" && summary && <>
      <p>Posição até {date(result.asOf)} · origem das vendas desde {date(result.firstCaptureDate)}.</p>
      {result.stale && <p role="alert">A atualização diária está atrasada. O último arquivo esperado é de {date(result.latestAvailableDate)}.</p>}
      <p className="text-xl font-semibold">{summary.openCount} parcelas abertas · {summary.openNet === null
        ? "total em conferência" : formatStoneMoney(summary.openNet)}</p>
      {(summary.reviewCount > 0 || summary.unsupportedCaptureCount > 0 || (result.missingDates?.length ?? 0) > 0) &&
        <p role="alert">Há {summary.reviewCount} parcelas em revisão, {summary.unsupportedCaptureCount} capturas sem parcelas e {result.missingDates?.length ?? 0} arquivos ausentes. O total não foi confirmado.</p>}
      <p className="text-sm text-muted-foreground">{summary.paidCount} parcelas com pagamento informado pela Stone foram retiradas da carteira. Isso não confirma crédito bancário nem posição da registradora.</p>
      <div className="space-y-2 rounded-md border p-3">
        <h3 className="font-semibold">Garantias, cessões e antecipações informadas pela Stone</h3>
        <p className="text-sm">Posição diária do arquivo 2.4, separada por natureza. Esta fonte não identifica quais parcelas da lista abaixo estão vinculadas a cada negociação nem confirma valor disponível para antecipar.</p>
        {!result.rightsPosition && <p role="status">A primeira leitura automática dessa posição ainda não foi concluída.</p>}
        {result.rightsPosition?.status === "not_provided" && <p role="status">A Stone não incluiu a posição neste arquivo. Isso não comprova saldo zero.</p>}
        {result.rightsPosition?.status === "empty" && <p role="status">A posição veio vazia neste arquivo. Isso não comprova saldo zero.</p>}
        {result.rightsPosition?.status === "reported" && <>
          <p className="text-sm">Posição informada em {date(result.rightsPosition.referenceDate)}.</p>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <caption className="sr-only">Posição Stone por carteira, natureza e categoria</caption>
            <thead><tr>{["Carteira", "Natureza", "Categoria", "Valor informado"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
            <tbody>{result.rightsPosition.rows.map(row => <tr className="border-t" key={`${row.walletTypeId}:${row.walletNatureId}:${row.category}`}>
              <td className="p-2">{walletTypeLabels[row.walletTypeId] ?? `Arranjo ${row.walletTypeId}`}</td>
              <td>{walletNatureLabels[row.nature]}</td><td>{row.category}</td><td>R$ {row.amount.replace(".", ",")}</td>
            </tr>)}</tbody>
          </table></div>
          {result.rightsPosition.unknownNatureCount > 0 && <p role="alert">A Stone informou {result.rightsPosition.unknownNatureCount} natureza(s) ainda não reconhecida(s).</p>}
        </>}
      </div>
      {open.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Parcelas em aberto da carteira Stone</caption>
        <thead><tr>{["Stone ID / parcela", "Venda", "Vencimento", "Bruto", "Líquido"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
        <tbody>{open.slice(page * 50, (page + 1) * 50).map(row => <tr key={`${row.transactionId}:${row.installment}`} className="border-t">
          <td className="p-2">{row.transactionId} / {row.installment}</td><td>{date(row.saleDate)}</td>
          <td>{date(row.dueDate)}</td><td>{formatStoneMoney(row.gross)}</td><td>{formatStoneMoney(row.net)}</td>
        </tr>)}</tbody>
      </table></div>}
      {open.length > 50 && <div className="flex items-center gap-3"><Button variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button>
        <span>Página {page + 1} de {Math.ceil(open.length / 50)}</span>
        <Button variant="outline" disabled={(page + 1) * 50 >= open.length} onClick={() => setPage(page + 1)}>Próxima</Button></div>}
    </>}
  </section>;
}
