

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
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { Loader2 } from "lucide-react";


type DeleteConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCancel?: () => void;
  itemName?: string;
  title?: string;
  description?: React.ReactNode;
  confirmButtonText?: string;
  cancelButtonText?: string;
  confirmButtonVariant?: ButtonProps['variant'];
  isDeleting?: boolean;
  triggerButton?: React.ReactNode;
}

export function DeleteConfirmationDialog({ 
  open: controlledOpen, 
  onOpenChange: setControlledOpen, 
  onConfirm, 
  onCancel,
  itemName,
  title = "Você tem certeza absoluta?",
  description,
  confirmButtonText = "Excluir",
  cancelButtonText = "Cancelar",
  confirmButtonVariant = "destructive",
  isDeleting = false,
  triggerButton,
}: DeleteConfirmationDialogProps) {

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    setControlledOpen(false);
  };
  
  const handleConfirm = () => {
    onConfirm();
    setControlledOpen(false);
  }

  const content = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          {description || `Essa ação não pode ser desfeita. Isso excluirá permanentemente ${itemName}.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={handleCancel} disabled={isDeleting}>
            {cancelButtonText}
        </AlertDialogCancel>
        <AlertDialogAction
          onClick={handleConfirm}
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
      <AlertDialog open={controlledOpen} onOpenChange={setControlledOpen}>
        <AlertDialogTrigger asChild>
          {triggerButton}
        </AlertDialogTrigger>
        {content}
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={controlledOpen} onOpenChange={setControlledOpen}>
      {content}
    </AlertDialog>
  );
}
