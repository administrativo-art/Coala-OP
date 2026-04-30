"use client";

import { useRef } from "react";
import SignatureCanvas from "react-signature-canvas";

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capturar assinatura</DialogTitle>
          <DialogDescription>
            Assine na área abaixo para anexar à execução.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-md border bg-white">
          <SignatureCanvas
            ref={signatureRef}
            canvasProps={{
              className: "h-56 w-full",
            }}
          />
        </div>
        <DialogFooter>
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
