
"use client"

import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Loader2 } from "lucide-react";


type DeleteConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  itemName?: string;
  title?: string;
  description?: React.ReactNode;
  confirmButtonText?: string;
  confirmButtonVariant?: ButtonProps['variant'];
  isDeleting?: boolean;
  triggerButton?: React.ReactNode;
}

export function DeleteConfirmationDialog({ 
  open, 
  onOpenChange, 
  onConfirm, 
  itemName,
  title = "Você tem certeza absoluta?",
  description,
  confirmButtonText = "Excluir",
  confirmButtonVariant = "destructive",
  isDeleting = false,
  triggerButton,
}: DeleteConfirmationDialogProps) {

  const content = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          {description || `Essa ação não pode ser desfeita. Isso excluirá permanentemente ${itemName}.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          disabled={isDeleting}
          className={buttonVariants({ variant: confirmButtonVariant })}
        >
          {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {confirmButtonText}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  if (triggerButton) {
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          {triggerButton}
        </AlertDialogTrigger>
        {content}
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {content}
    </AlertDialog>
  );
}

