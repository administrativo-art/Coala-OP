
"use client"

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type DeleteConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  itemName: string;
}

export function DeleteConfirmationDialog({ open, onOpenChange, onConfirm, itemName }: DeleteConfirmationDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault(); // Prevent dialog from closing immediately
    setIsDeleting(true);
    try {
      await onConfirm();
    } catch (error) {
      console.error("Confirmation action failed", error);
    } finally {
      // The loading state is set to false before closing,
      // but the parent component will unmount this dialog,
      // so it might not be visible. It's good practice regardless.
      setIsDeleting(false);
      onOpenChange(false); // Manually close the dialog
    }
  }

  // Handle case where dialog is closed by user (ESC, overlay click)
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setIsDeleting(false); // Reset loading state if dialog is closed
    }
    onOpenChange(isOpen);
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Você tem certeza absoluta?</AlertDialogTitle>
          <AlertDialogDescription>
            Essa ação não pode ser desfeita. Isso excluirá permanentemente {itemName}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleConfirmClick}
            disabled={isDeleting}
            className={buttonVariants({ variant: "destructive" })}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isDeleting ? "Excluindo..." : "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
