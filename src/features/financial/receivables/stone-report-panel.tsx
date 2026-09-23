"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatStoneReportMoney, parseStoneReceivablesReportCsv, type StoneReportPreview } from "./stone-report-csv";

const displayDate = (value: string) => value.split("-").reverse().join("/");
const pageSize = 50;

export function StoneReportPanel({ stoneCode }: { stoneCode: string }) {
  const [preview, setPreview] = useState<StoneReportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);

  async function readFile(file?: File) {
    setPreview(null); setFileName(""); setError(""); setPage(0);
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setError("O CSV excede 8 MiB."); return; }
    try {
      const parsed = parseStoneReceivablesReportCsv(await file.text(), stoneCode);
      setPreview(parsed); setFileName(file.name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível ler o CSV da Stone.");
    }
  }

  return <section aria-label="Recebíveis abertos do relatório Stone" className="space-y-4 rounded-lg border p-4">
    <div><h2 className="text-lg font-semibold">Recebíveis abertos · relatório Stone</h2>
      <p className="text-sm text-muted-foreground">Selecione a “Lista de recebimentos” em CSV, exportada para esta conta. A prévia é calculada neste navegador; o arquivo não é enviado ao Coala nem cria lançamentos.</p></div>
    {!stoneCode ? <p>Selecione um vínculo e StoneCode para conferir o relatório.</p> : <>
      <label className="block space-y-1 text-sm"><span>CSV da Stone</span><input aria-label="CSV de recebimentos Stone" type="file" accept=".csv,text/csv" className="block w-full rounded-md border p-2" onChange={event => void readFile(event.target.files?.[0])} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {preview && <div className="space-y-4">
        <p className="text-sm">Arquivo: {fileName} · StoneCode: {stoneCode} · {preview.totalRows} registros no CSV, dos quais {preview.paidRows} pagos e {preview.openRows.length} abertos.</p>
        <p className="text-xl font-semibold">Líquido aberto no relatório: {formatStoneReportMoney(preview.totalOpenMicros)}</p>
        <p className="text-sm">Precisão original da soma: {formatStoneReportMoney(preview.totalOpenMicros, 6)}. Esta é a posição do CSV selecionado, conforme o período filtrado ao exportar na Stone; o arquivo não informa esse filtro nem comprova saldo bancário ou recebíveis de outros adquirentes.</p>
        {!preview.openRows.length ? <p role="status">Nenhuma parcela aberta neste arquivo. Confirme o período usado na exportação antes de interpretar como carteira zerada.</p> : <>
          <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="mb-2 text-left font-medium">Vencimentos informados no CSV</caption>
            <thead><tr><th className="p-2 text-left">Vencimento</th><th className="p-2 text-right">Parcelas</th><th className="p-2 text-right">Líquido</th></tr></thead>
            <tbody>{preview.byDueDate.map(row => <tr key={row.date} className="border-t"><td className="p-2">{displayDate(row.date)}</td><td className="p-2 text-right">{row.count}</td><td className="p-2 text-right">{formatStoneReportMoney(row.netMicros, 6)}</td></tr>)}</tbody>
          </table></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="mb-2 text-left font-medium">Parcelas abertas no CSV</caption>
            <thead><tr>{["Stone ID / parcela", "Venda", "Vencimento", "Bandeira / produto", "Bruto", "Líquido"].map(label => <th className="p-2 text-left" key={label}>{label}</th>)}</tr></thead>
            <tbody>{preview.openRows.slice(page * pageSize, (page + 1) * pageSize).map(row => <tr key={`${row.transactionId}:${row.installment}`} className="border-t">
              <td className="p-2">{row.transactionId} / {row.installment}</td><td className="p-2">{row.saleDate}</td><td className="p-2">{displayDate(row.dueDate)}</td><td className="p-2">{row.brand} / {row.product}</td><td className="p-2">{formatStoneReportMoney(row.grossMicros, 6)}</td><td className="p-2">{formatStoneReportMoney(row.netMicros, 6)}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="flex items-center gap-3"><Button type="button" variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Anterior</Button><span>Página {page + 1} de {Math.ceil(preview.openRows.length / pageSize)}</span><Button type="button" variant="outline" disabled={(page + 1) * pageSize >= preview.openRows.length} onClick={() => setPage(value => value + 1)}>Próxima</Button></div>
        </>}
      </div>}
    </>}
  </section>;
}
