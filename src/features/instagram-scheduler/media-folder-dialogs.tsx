"use client";

import { useMemo, useState } from "react";
import { Folder, FolderOpen, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { InstagramMediaFolder } from "./contracts";
import {
  INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH,
  buildFolderTree,
  folderDepth,
  folderSubtreeHeight,
  isFolderDescendant,
  type InstagramMediaFolderNode,
} from "./media-folders";

const primaryButton =
  "flex items-center justify-center gap-2 rounded-lg bg-[#F462A7] px-4 py-2.5 text-[13px] font-extrabold text-[#4A1A04] disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton =
  "rounded-lg border border-[#EADFD3] bg-white px-4 py-2.5 text-[13px] font-bold disabled:opacity-50";

type NameDialogProps = {
  title: string;
  description?: string;
  confirmLabel: string;
  initialName?: string;
  onConfirm: (name: string) => Promise<boolean>;
  onClose: () => void;
};

export function FolderNameDialog({
  title,
  description,
  confirmLabel,
  initialName = "",
  onConfirm,
  onClose,
}: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const invalid = !trimmed || trimmed.length > 80 || /[/\\\u0000-\u001f]/.test(trimmed);

  async function submit() {
    if (invalid || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(trimmed)) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="block text-[12px] font-bold text-[#7A5646]">
            Nome da pasta
            <input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-[9px] border border-[#EADFD3] bg-white px-3 text-[14px] font-semibold text-[#4A1A04] outline-none focus:border-[#F462A7]"
            />
          </label>
          {trimmed && invalid && (
            <p className="mt-1.5 text-[12px] text-[#A52E24]">Use até 80 caracteres, sem “/” nem “\”.</p>
          )}
          <DialogFooter className="mt-5 gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancelar</button>
            <button type="submit" disabled={invalid || busy} className={primaryButton}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type MoveDialogProps = {
  title: string;
  folders: InstagramMediaFolder[];
  /** Pasta que está sendo movida; ela e suas descendentes não aceitam o destino. */
  movingFolderId?: string;
  currentLocationId: string | null;
  onConfirm: (folderId: string | null) => Promise<boolean>;
  onClose: () => void;
};

export function MoveToFolderDialog({
  title,
  folders,
  movingFolderId,
  currentLocationId,
  onConfirm,
  onClose,
}: MoveDialogProps) {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const movingHeight = movingFolderId ? folderSubtreeHeight(folders, movingFolderId) : 0;

  function disabledReason(folderId: string | null): string | null {
    if (folderId === currentLocationId) return "Já está aqui";
    if (movingFolderId && folderId !== null) {
      if (folderId === movingFolderId || isFolderDescendant(folders, movingFolderId, folderId)) {
        return "Dentro da própria pasta";
      }
    }
    if (movingFolderId) {
      const depth = folderDepth(folders, folderId) ?? 0;
      if (depth + movingHeight > INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH) return "Profundidade máxima";
    }
    return null;
  }

  async function submit() {
    if (target === undefined || busy) return;
    setBusy(true);
    try {
      if (await onConfirm(target)) onClose();
    } finally {
      setBusy(false);
    }
  }

  function renderNode(node: InstagramMediaFolderNode) {
    const reason = disabledReason(node.id);
    return (
      <li key={node.id}>
        <button
          type="button"
          disabled={Boolean(reason) || busy}
          aria-pressed={target === node.id}
          onClick={() => setTarget(node.id)}
          className={`flex w-full items-center gap-2 rounded-lg py-2 pr-2 text-left text-[13px] disabled:opacity-45 ${target === node.id ? "bg-[#FCE3EF] font-extrabold" : "hover:bg-[#F4ECE2]"}`}
          style={{ paddingLeft: 8 + (node.depth - 1) * 16 }}
        >
          <Folder className="h-4 w-4 shrink-0 text-[#7A5646]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {reason && <span className="text-[11px] font-semibold text-[#7A5646]">{reason}</span>}
        </button>
        {node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  }

  const rootReason = disabledReason(null);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Escolha a pasta de destino.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[340px] overflow-y-auto rounded-xl border border-[#EADFD3] bg-white p-1.5">
          <li>
            <button
              type="button"
              disabled={Boolean(rootReason) || busy}
              aria-pressed={target === null}
              onClick={() => setTarget(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] disabled:opacity-45 ${target === null ? "bg-[#FCE3EF] font-extrabold" : "hover:bg-[#F4ECE2]"}`}
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-[#7A5646]" aria-hidden="true" />
              <span className="flex-1">Biblioteca (raiz)</span>
              {rootReason && <span className="text-[11px] font-semibold text-[#7A5646]">{rootReason}</span>}
            </button>
            <ul>{tree.map(renderNode)}</ul>
          </li>
        </ul>
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Cancelar</button>
          <button type="button" onClick={() => void submit()} disabled={target === undefined || busy} className={primaryButton}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Mover aqui
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmDeleteProps = {
  folderName: string;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
};

export function DeleteFolderDialog({ folderName, onConfirm, onClose }: ConfirmDeleteProps) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (await onConfirm()) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Excluir a pasta “{folderName}”?</DialogTitle>
          <DialogDescription>
            Nenhum arquivo é apagado: as mídias e as subpastas sobem para a pasta de cima.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>Manter</button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#A52E24] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Excluir pasta
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
