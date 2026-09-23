"use client";

import { useState } from "react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { AuthenticatedApiError } from "@/lib/authenticated-api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { queryStoneWalletPosition } from "./wallet-position";

type Position = Awaited<ReturnType<typeof queryStoneWalletPosition>>;
const natures: Record<Position["rows"][number]["nature"], string> = {
  regular: "Carteira normal", warranty: "Garantia", ownership_assignment: "Cessão",
  stone_anticipation: "Antecipação Stone", unknown: "Natureza não reconhecida",
};

// Stone WalletTypeId: https://conciliacao.stone.com.br/reference/wallettypeid
const walletTypes: Record<string, string> = {
  "1": "Movimentos não transacionais",
  "2": "Visa débito", "3": "Visa crédito", "4": "Visa antecipação",
  "5": "Mastercard débito", "6": "Mastercard crédito", "7": "Mastercard antecipação",
  "8": "Hiper débito", "9": "Hiper crédito", "10": "Hiper antecipação",
  "11": "Elo débito", "12": "Elo crédito", "13": "Elo antecipação",
  "14": "American Express débito", "15": "American Express crédito", "16": "American Express antecipação",
  "17": "Boleto",
  "20": "Cabal débito", "21": "Cabal crédito", "22": "Cabal antecipação",
  "23": "UnionPay débito", "24": "UnionPay crédito", "25": "UnionPay antecipação",
  "26": "Visa débito antecipação", "27": "Mastercard débito antecipação",
  "28": "Elo débito antecipação", "29": "Cabal débito antecipação",
  "30": "UnionPay débito antecipação",
  "31": "Elo voucher crédito", "32": "Elo voucher antecipação",
  "33": "Mastercard voucher crédito", "34": "Mastercard voucher antecipação",
  "35": "Visa voucher crédito", "36": "Visa voucher antecipação",
};

export function WalletPositionPanel({ stoneCode }: { stoneCode: string }) {
  const api = useAuthenticatedApi();
  const [referenceDate, setReferenceDate] = useState("");
  const [result, setResult] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = async (offset = 0) => {
    if (busy || !stoneCode || !referenceDate) return;
    setBusy(true); setError("");
    if (!offset) setResult(null);
    try {
      const query = new URLSearchParams({ stoneCode, referenceDate, offset: String(offset), limit: "100" });
      const data = await api<Position>(`/api/financial/stone-wallet-position?${query}`);
      if (data.stoneCode.replace(/^0+(?=\d)/, "") !== stoneCode.replace(/^0+(?=\d)/, "") || data.referenceDate !== referenceDate
        || (offset > 0 && data.sourceHash !== result?.sourceHash)) {
        setResult(null);
        throw new AuthenticatedApiError("A posição mudou. Consulte novamente desde o início.", 409, null);
      }
      setResult(data);
    } catch (cause) {
      setError(cause instanceof AuthenticatedApiError ? cause.message : "Não foi possível consultar a posição da carteira.");
    } finally { setBusy(false); }
  };
  return <section aria-label="Posição diária da carteira Stone" className="space-y-3 rounded-lg border p-4">
    <h2 className="text-lg font-semibold">Posição diária da carteira Stone</h2>
    <p>Consulte os valores informados para o StoneCode selecionado, separados por natureza. Esta posição não confirma saldo bancário nem todos os vencimentos futuros.</p>
    <p className="text-sm">Saldo bancário disponível: não confirmado.</p>
    {!stoneCode && <p>Selecione um vínculo e um StoneCode acima para consultar.</p>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void read(); }}>
      <label>Data da posição<Input type="date" required aria-label="Data da posição da carteira" disabled={busy} value={referenceDate}
        onChange={event => { setReferenceDate(event.target.value); setResult(null); setError(""); }} /></label>
      <Button type="submit" disabled={busy || !stoneCode || !referenceDate}>{busy ? "Consultando carteira…" : "Consultar posição da carteira"}</Button>
    </form>
    <p className="text-sm text-muted-foreground">Disponível após as 05h do dia seguinte, horário de Brasília. Atualização somente ao consultar.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {result && <>
      <p>StoneCode: {result.stoneCode} · Posição: {result.referenceDate.split("-").reverse().join("/")} · Consultado em: {new Date(result.collectedAt).toLocaleString("pt-BR")}</p>
      {result.status !== "reported" ? <p role="status">{result.status === "not_provided" ? "A Stone não incluiu a posição de carteira neste arquivo." : "A seção de carteira veio vazia."} Isso não comprova saldo zero.</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Valores da carteira por natureza e categoria</caption>
          <thead><tr>{["Tipo de carteira", "Natureza", "Categoria informada", "Valor informado (R$)"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{result.rows.map(row => <tr className="border-t" key={`${row.walletTypeId}:${row.walletNatureId}:${row.category}`}>
            <td className="p-2">{walletTypes[row.walletTypeId] ?? "Arranjo não identificado"} ({row.walletTypeId})</td><td>{natures[row.nature]} ({row.walletNatureId})</td><td>{row.category}</td><td>{row.amount.replace(".", ",")}</td>
          </tr>)}</tbody></table></div>
        <p className="text-sm">{result.totalRowsInFile} posições no arquivo. Valores preservados com a precisão informada pela Stone.</p>
        {result.nextOffset !== null && <Button type="button" variant="outline" disabled={busy} onClick={() => void read(result.nextOffset!)}>Próxima página de posições</Button>}
      </>}
      <p className="text-sm text-muted-foreground">Fonte: Stone, posição diária de carteira · Arquivo: {result.fileId}. Garantias, cessões e antecipações não são somadas como dinheiro disponível.</p>
    </>}
  </section>;
}
