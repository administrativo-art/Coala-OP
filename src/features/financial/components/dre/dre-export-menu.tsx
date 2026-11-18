"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { formatDrePeriod } from "../../dre/report";
import type { DreReportMode } from "../../dre/report";
export function DreExportMenu({ month, kioskIds, disabled }: { month: string; kioskIds: string[]; disabled?: boolean }) {
  const api = useAuthenticatedApi(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function download(mode: DreReportMode, format: "pdf" | "xlsx") {
    setBusy(true); setError(null);
    try { const blob = await api<Blob>("/api/financial/dre/export", { method: "POST", json: { month, kioskIds, mode, format }, responseType: "blob", fallbackError: "Não foi possível exportar a DRE." });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `dre-${month}-${mode}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível exportar a DRE."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-end gap-1"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="on-dark-secondary" disabled={disabled || busy || !kioskIds.length} aria-label="Exportar relatório da DRE"><Download className="mr-2 h-4 w-4" />{busy ? "Gerando relatório…" : "Exportar"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>CMV por movimentação de estoque</DropdownMenuLabel>
    <DropdownMenuItem onSelect={() => void download("monthly", "pdf")}>Mensal · PDF timbrado</DropdownMenuItem><DropdownMenuItem onSelect={() => void download("monthly", "xlsx")}>Mensal · Excel</DropdownMenuItem><DropdownMenuSeparator />
    <DropdownMenuItem onSelect={() => void download("twelve_months", "pdf")}>12 meses até {formatDrePeriod(month)} · PDF timbrado</DropdownMenuItem><DropdownMenuItem onSelect={() => void download("twelve_months", "xlsx")}>12 meses até {formatDrePeriod(month)} · Excel</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>{error && <p role="alert" className="max-w-80 text-sm text-ds-danger">{error}</p>}</div>;
}
