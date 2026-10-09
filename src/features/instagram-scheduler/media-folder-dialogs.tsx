"use client";

import { useMemo, useState } from "react";

import { Field, fieldInputClass } from "@/components/patterns/field";
import { SidePanel } from "@/components/patterns/side-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { InstagramMediaFolder } from "./contracts";
import {
  INSTAGRAM_MEDIA_FOLDER_MAX_DEPTH,
  buildFolderTree,
  folderDepth,
  folderSubtreeHeight,
  isFolderDescendant,
  type InstagramMediaFolderNode,
} from "./media-folders";

type NameDialogProps = {
  title: string;
  description?: string;
  confirmLabel: string;
  initialName?: string;
  onConfirm: (name: string) => Promise<boolean>;
  onClose: () => void;
};

/** Nome da pasta num painel lateral (docs/design/painel-lateral.md); a falha da gravação aparece no banner da tela. */
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
    <SidePanel
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      kicker="Biblioteca de mídia"
      title={title}
      subtitle={description ?? "Use até 80 caracteres, sem “/” nem “\\”."}
    >
      <form className="flex flex-1 flex-col gap-5" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field label="Nome da pasta" htmlFor="media-folder-name" error={trimmed && invalid ? "Use até 80 caracteres, sem “/” nem “\\”." : null}>
          <input
            id="media-folder-name"
            autoFocus
            value={name}
            maxLength={80}
            aria-invalid={Boolean(trimmed && invalid)}
            onChange={(event) => setName(event.target.value)}
            className={fieldInputClass}
          />
        </Field>
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
          <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary-modal" size="md" loading={busy} disabled={invalid}>{confirmLabel}</Button>
        </div>
      </form>
    </SidePanel>
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
          className={cn("flex w-full items-center gap-2 rounded-ds-btn py-2 pr-2 text-left text-[13px] disabled:opacity-45", target === node.id ? "bg-ds-accent-row font-extrabold" : "hover:bg-ds-muted")}
          style={{ paddingLeft: 8 + (node.depth - 1) * 16 }}
        >
          <span aria-hidden="true" className="shrink-0 text-ds-ink-faint">▸</span>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {reason && <span className="text-[11px] font-semibold text-ds-ink-muted">{reason}</span>}
        </button>
        {node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  }

  const rootReason = disabledReason(null);
  return (
    <SidePanel
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      kicker="Biblioteca de mídia"
      title={title}
      subtitle="Escolha a pasta de destino."
    >
      <div className="flex flex-1 flex-col gap-5">
        <ul className="max-h-[480px] overflow-y-auto rounded-ds-btn-lg border border-ds-border bg-white p-1.5">
          <li>
            <button
              type="button"
              disabled={Boolean(rootReason) || busy}
              aria-pressed={target === null}
              onClick={() => setTarget(null)}
              className={cn("flex w-full items-center gap-2 rounded-ds-btn px-2 py-2 text-left text-[13px] disabled:opacity-45", target === null ? "bg-ds-accent-row font-extrabold" : "hover:bg-ds-muted")}
            >
              <span aria-hidden="true" className="shrink-0 text-ds-ink-faint">▾</span>
              <span className="flex-1">Biblioteca (raiz)</span>
              {rootReason && <span className="text-[11px] font-semibold text-ds-ink-muted">{rootReason}</span>}
            </button>
            <ul>{tree.map(renderNode)}</ul>
          </li>
        </ul>
        <div className="mt-auto grid grid-cols-2 gap-2 border-t border-ds-divider pt-4">
          <Button type="button" variant="ds-secondary" size="md" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="primary-modal" size="md" loading={busy} disabled={target === undefined} onClick={() => void submit()}>Mover aqui</Button>
        </div>
      </div>
    </SidePanel>
  );
}

