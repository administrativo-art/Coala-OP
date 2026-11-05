"use client";

import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Exibe o PDF recebido do servidor. A URL do blob é revogada pelo dono do estado ao fechar.
 * O botão de fechar vem antes do quadro e recebe o foco inicial: o visualizador de PDF captura o
 * teclado (inclusive Esc) quando o foco entra no iframe.
 */
export function EditorPreviewDialog({ url, onClose, resolved = false }: { url: string | null; onClose: () => void; resolved?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={url !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        hideClose
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeRef.current?.focus();
        }}
        className="flex h-[90dvh] w-[calc(100%-2rem)] flex-col gap-3 sm:max-w-5xl"
      >
        <div className="flex items-start justify-between gap-3">
          <DialogHeader>
            <DialogTitle>Prévia timbrada</DialogTitle>
            <DialogDescription>
              {resolved
                ? "Gerada pelo servidor com os dados reais do titular escolhido e marca de prévia. Não é o documento final."
                : "Gerada pelo servidor com valores de exemplo e marca de prévia. Não é o documento final."}
            </DialogDescription>
          </DialogHeader>
          <Button ref={closeRef} type="button" variant="ds-secondary" size="md" onClick={onClose}>
            Fechar prévia
          </Button>
        </div>
        {url ? (
          <iframe title="Prévia timbrada do documento em PDF" src={url} className="min-h-0 w-full flex-1 rounded-ds-md border border-ds-border bg-ds-muted" />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
