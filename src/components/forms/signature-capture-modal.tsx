"use client";

import { useRef } from "react";
import SignatureCanvas from "react-signature-canvas";
import { PenLine } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type SignatureCaptureModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignatureCaptured: (dataUrl: string) => void;
};

export function SignatureCaptureModal({
  open,
  onOpenChange,
  onSignatureCaptured,
}: SignatureCaptureModalProps) {
  const signatureRef = useRef<SignatureCanvas | null>(null);

  function handleClear() {
    signatureRef.current?.clear();
  }

  function handleSave() {
    if (!signatureRef.current || signatureRef.current.isEmpty()) {
      return;
    }

    onSignatureCaptured(signatureRef.current.toDataURL("image/png"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm">
              <PenLine className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Capturar assinatura</DialogTitle>
              <DialogDescription>
                Assine na área abaixo para anexar à execução.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5">
          <div className="overflow-hidden rounded-xl border bg-white shadow-inner">
            <SignatureCanvas
              ref={signatureRef}
              canvasProps={{
                className: "h-64 w-full",
              }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A assinatura será salva como evidência do preenchimento.
          </p>
        </div>
        <DialogFooter className="border-t bg-background px-6 py-4">
          <Button variant="outline" onClick={handleClear}>
            Limpar
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave}>Salvar assinatura</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
