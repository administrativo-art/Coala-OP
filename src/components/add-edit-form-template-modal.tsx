

"use client"

import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray, Control, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PlusCircle, Trash2, ArrowUp, ArrowDown, Wand2 } from 'lucide-react';
import { type FormTemplate, type FormQuestion as FormQuestionType, type FormSection, type FormTaskAction } from '@/types';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';

// This component is being prepared for the new node-based visual builder.
// The content has been temporarily cleared.

type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
  addTemplate: (template: Omit<FormTemplate, 'id'>) => void;
  updateTemplate: (template: FormTemplate) => void;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit, addTemplate, updateTemplate }: AddEditFormTemplateModalProps) {
  
  // The content of this modal will be replaced by the React Flow builder in the next steps.
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh]">
        <DialogHeader>
          <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            A nova interface do construtor de formulários será implementada aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground">Carregando construtor visual...</p>
        </div>
        <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
