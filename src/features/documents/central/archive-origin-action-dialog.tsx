"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ArchiveOriginAction = {
  title: string;
  description: string;
  confirmation: string;
  confirmLabel: string;
  execute: () => Promise<void>;
};

export function ArchiveOriginActionDialog({ action, onClose }: { action: ArchiveOriginAction | null; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  function close() { setStep(1); setBusy(false); setError(""); onClose(); }
  async function confirm() {
    if (!action) return;
    setBusy(true); setError("");
    try { await action.execute(); close(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a ação."); }
    finally { setBusy(false); }
  }
  return <Dialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) close(); }}>
    <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
      <DialogHeader><DialogTitle>{action?.title}</DialogTitle><DialogDescription>{step === 1 ? action?.description : action?.confirmation}</DialogDescription></DialogHeader>
      {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <DialogFooter><Button ref={cancelRef} variant="outline" disabled={busy} onClick={close}>Cancelar</Button>{step === 1
        ? <Button variant="outline" disabled={busy} onClick={() => setStep(2)}>Continuar</Button>
        : <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? "Processando…" : action?.confirmLabel}</Button>}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
