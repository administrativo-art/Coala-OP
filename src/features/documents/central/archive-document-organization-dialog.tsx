"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export type ArchiveOrganizationTarget = {
  ids: string[];
  name: string;
  path: string[];
  destinations: string[][];
};

export type ArchiveOrganizationRequest =
  | { ids: string[]; action: "rename"; name: string; expectedName: string }
  | { ids: string[]; action: "move"; path: string[]; expectedPath: string[] };

export function ArchiveDocumentOrganizationDialog({
  mode,
  target,
  onClose,
  onSave,
}: {
  mode: "rename" | "move" | null;
  target: ArchiveOrganizationTarget | null;
  onClose: () => void;
  onSave: (request: ArchiveOrganizationRequest) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = useMemo(() => target?.destinations.map((path) => ({ value: JSON.stringify(path), label: path.join(" › ") })) ?? [], [target]);

  useEffect(() => {
    setName(target?.name ?? "");
    setDestination(options[0]?.value ?? "");
    setError("");
  }, [mode, options, target]);

  async function submit() {
    if (!target || !mode || saving) return;
    const request: ArchiveOrganizationRequest = mode === "rename"
      ? { ids: target.ids, action: "rename", name: name.trim(), expectedName: target.name }
      : { ids: target.ids, action: "move", path: JSON.parse(destination) as string[], expectedPath: target.path };
    setSaving(true);
    setError("");
    try {
      await onSave(request);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível organizar o documento.");
    } finally {
      setSaving(false);
    }
  }

  const unchangedName = name.trim() === target?.name;
  return <Dialog open={Boolean(mode && target)} onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{mode === "rename" ? "Renomear documento" : "Mover documento"}</DialogTitle>
        <DialogDescription>
          {mode === "rename"
            ? "O nome muda somente no Acervo. O nome oficial do arquivo e o PDF permanecem iguais."
            : "A mudança organiza o Acervo sem alterar categoria, publicação, assinatura ou arquivo físico."}
        </DialogDescription>
      </DialogHeader>
      {mode === "rename" ? <label className="space-y-1.5">
        <span className="text-xs font-bold text-ds-ink-muted">Nome no Acervo</span>
        <Input value={name} onChange={(event) => { setName(event.target.value); setError(""); }} maxLength={160} autoFocus />
      </label> : <label className="space-y-1.5">
        <span className="text-xs font-bold text-ds-ink-muted">Pasta de destino</span>
        <span className="relative block">
          <select aria-label="Pasta de destino" value={destination} onChange={(event) => { setDestination(event.target.value); setError(""); }} className="h-10 w-full appearance-none rounded-ds-sm border border-ds-border bg-ds-input pl-3 pr-12 text-sm">
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <span className="pointer-events-none absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-ds-sm border border-ds-border bg-ds-surface shadow-xs"><ChevronDown className="h-4 w-4" strokeWidth={2.25} /></span>
        </span>
      </label>}
      {error ? <p role="alert" className="rounded-ds-sm border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button>
        <Button type="button" disabled={saving || (mode === "rename" ? name.trim().length < 2 || unchangedName : !destination)} onClick={() => void submit()}>
          {saving ? (mode === "rename" ? "Renomeando…" : "Movendo…") : mode === "rename" ? "Salvar nome" : "Mover documento"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
