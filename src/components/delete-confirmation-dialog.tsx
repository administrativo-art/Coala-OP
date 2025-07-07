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
import { buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";


type DeleteConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  itemName?: string;
  showForceDeleteOption?: boolean;
  onForceDeleteChange?: (isForced: boolean) => void;
  title?: string;
  description?: React.ReactNode;
  confirmButtonText?: string;
  confirmButtonVariant?: ButtonProps['variant'];
  isDeleting?: boolean;
}

export function DeleteConfirmationDialog({ 
  open, 
  onOpenChange, 
  onConfirm, 
  itemName,
  showForceDeleteOption = false,
  onForceDeleteChange,
  title = "Você tem certeza absoluta?",
  description,
  confirmButtonText = "Excluir",
  confirmButtonVariant = "destructive",
  isDeleting = false,
}: DeleteConfirmationDialogProps) {
  
  const handleCheckedChange = (checked: boolean | 'indeterminate') => {
      onForceDeleteChange?.(!!checked);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description || `Essa ação não pode ser desfeita. Isso excluirá permanentemente ${itemName}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {showForceDeleteOption && (
            <div className="pt-2">
                <div className="flex items-center space-x-2">
                    <Checkbox id="force-delete" onCheckedChange={handleCheckedChange} />
                    <Label htmlFor="force-delete" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Forçar exclusão
                    </Label>
                </div>
                <p className="text-xs text-muted-foreground pt-2 pl-1">
                    Use esta opção se o lote estiver corrompido ou não puder ser excluído normalmente.
                </p>
            </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className={buttonVariants({ variant: confirmButtonVariant })}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isDeleting ? "Processando..." : confirmButtonText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
