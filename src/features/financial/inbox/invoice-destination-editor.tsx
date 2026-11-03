"use client";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FinancialInboxAttachment } from "./types";

type AssetChoice = { id: string; code?: string; name?: string };
export function InvoiceDestinationEditor({ messageId, attachment, api, canLinkAsset, canDiscard, canDelete, onApplied }: {
  messageId: string; attachment: FinancialInboxAttachment;
  api: (path: string, init?: RequestInit) => Promise<unknown>;
  canLinkAsset: boolean; canDiscard: boolean; canDelete: boolean;
  onApplied: (destination: NonNullable<FinancialInboxAttachment["destination"]>) => void;
}) {
  const [open, setOpen] = useState(false);
  const assetCodeInputId = useId();
  const [selected, setSelected] = useState<AssetChoice[]>([]);
  const [assetCode, setAssetCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteStep, setDeleteStep] = useState(0);
  const endpoint = `/api/financial/inbox/${encodeURIComponent(messageId)}/files/${encodeURIComponent(attachment.id)}/destination`;
  function openEditor() { setOpen(true); setError(""); }
  async function addAsset() {
    setBusy(true); setError("");
    try {
      const found = await api(`/api/assets/lookup?code=${encodeURIComponent(assetCode.trim().toUpperCase())}`) as AssetChoice[];
      if (found.length !== 1) throw new Error("Etiqueta não encontrada neste workspace. Confira o patrimônio.");
      setSelected((current) => current.some((item) => item.id === found[0].id) ? current : [...current, found[0]]);
      setAssetCode("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao consultar patrimônio."); }
    finally { setBusy(false); }
  }
  async function confirm(kind: "asset_invoice" | "non_asset_invoice") {
    if (!attachment.sha256) return;
    setBusy(true); setError("");
    try {
      const result = await api(endpoint, { method: "POST", body: JSON.stringify({ kind, assetIds: kind === "asset_invoice" ? selected.map((asset) => asset.id) : [], expectedSha256: attachment.sha256 }) }) as { destination: NonNullable<FinancialInboxAttachment["destination"]> };
      onApplied(result.destination); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível registrar o destino."); }
    finally { setBusy(false); }
  }
  async function deleteReceivedFile() {
    if (!attachment.sha256 || !attachment.destination) return;
    setBusy(true); setError("");
    try {
      const result = await api(endpoint, { method: "DELETE", body: JSON.stringify({ expectedSha256: attachment.sha256, expectedVersion: attachment.destination.version, confirmed: true }) }) as { destination: NonNullable<FinancialInboxAttachment["destination"]> };
      onApplied(result.destination); setDeleteStep(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir o arquivo recebido."); }
    finally { setBusy(false); }
  }
  const destination = attachment.destination;
  async function repairAssetLink() {
    if (!attachment.sha256 || destination?.kind !== "asset_invoice") return;
    setBusy(true); setError("");
    try {
      const result = await api(endpoint, { method: "POST", body: JSON.stringify({ kind: "asset_invoice", assetIds: destination.assetIds, expectedSha256: attachment.sha256 }) }) as { destination: NonNullable<FinancialInboxAttachment["destination"]> };
      onApplied(result.destination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível conferir o vínculo patrimonial."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-lg border p-3 text-xs">
    <p className="break-all font-semibold">Arquivo recebido: {attachment.filename}</p>
    {destination ? <p>{destination.kind === "asset_invoice" ? `Vinculada a ${destination.assetIds.length} patrimônio(s).` : destination.deletionState === "deleted" ? "Arquivo recebido excluído; histórico preservado." : "Destino sem patrimônio confirmado. Conclua a exclusão do arquivo recebido."}</p>
      : <><p>Se este arquivo for uma nota fiscal, confirme seu destino. A sugestão da cobrança não define patrimônio.</p><Button type="button" variant="ds-secondary" size="sm" onClick={openEditor}>Tratar como nota fiscal</Button></>}
    {canLinkAsset && destination?.kind === "asset_invoice" ? <Button type="button" variant="ds-secondary" size="sm" disabled={busy} onClick={() => void repairAssetLink()}>Conferir vínculo no patrimônio</Button> : null}
    {destination?.kind === "asset_invoice" && error ? <p role="alert" className="text-rose-700">{error}</p> : null}
    {open && !destination ? <div className="space-y-2">
      {canLinkAsset ? <><label htmlFor={assetCodeInputId}>Código do patrimônio</label><div className="flex gap-2"><input id={assetCodeInputId} className="h-10 min-w-0 flex-1 rounded-md border px-3" value={assetCode} onChange={(event) => setAssetCode(event.target.value)} placeholder="PAT-000123" /><Button type="button" variant="ds-secondary" size="sm" disabled={busy || !assetCode.trim()} onClick={() => void addAsset()}>Adicionar patrimônio</Button></div><div className="space-y-1">{selected.map((asset) => <div key={asset.id} className="flex items-center justify-between gap-2"><span>{asset.code} · {asset.name}</span><Button type="button" variant="ds-ghost" size="sm" aria-label={`Remover patrimônio ${asset.code} ${asset.name ?? ""}`} onClick={() => setSelected((current) => current.filter((item) => item.id !== asset.id))}>Remover</Button></div>)}</div><Button type="button" variant="primary-page" size="sm" disabled={busy || selected.length === 0} onClick={() => void confirm("asset_invoice")}>Confirmar vínculo ao patrimônio</Button></> : null}
      {canDiscard ? <Button type="button" variant="ds-secondary" size="sm" disabled={busy} onClick={() => void confirm("non_asset_invoice")}>Confirmar NF sem patrimônio</Button> : null}
      <Button type="button" variant="ds-ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
      {error ? <p role="alert" className="text-rose-700">{error}</p> : null}
    </div> : null}
    {canDelete && destination?.kind === "non_asset_invoice" && destination.deletionState !== "deleted" ? <div className="space-y-2 border-t pt-2">
      {deleteStep === 0 ? <Button type="button" variant="ds-secondary" size="sm" onClick={() => setDeleteStep(1)}>Excluir arquivo recebido</Button> : <><p>Confirmação final: excluir somente este anexo da recepção? A despesa e o histórico permanecem. Se a recuperação temporária estiver indisponível, a exclusão será interrompida.</p><div className="flex gap-2"><Button type="button" variant="ds-secondary" size="sm" autoFocus onClick={() => setDeleteStep(0)}>Cancelar</Button><Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void deleteReceivedFile()}>Confirmar exclusão deste arquivo</Button></div></>}
      {error ? <p role="alert" className="text-rose-700">{error}</p> : null}
    </div> : null}
  </div>;
}
