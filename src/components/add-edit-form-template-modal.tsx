

"use client"

import React, { useEffect, useState, useMemo } from 'react';
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
import { PlusCircle, Trash2, ArrowUp, ArrowDown, Wand2, Loader2, Save } from 'lucide-react';
import { type FormTemplate, type FormQuestion as FormQuestionType, type FormSection, type FormTaskAction } from '@/types';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { FormBuilder } from './form-builder';

const formTemplateSchema = z.object({
  name: z.string().min(1, "O nome do modelo é obrigatório."),
  type: z.enum(['standard', 'operational_checklist']),
  layout: z.enum(['continuous', 'stepped']),
  submissionTitleFormat: z.string().optional(),
  sections: z.array(z.object({
    id: z.string(),
    name: z.string().min(1, "O nome da seção é obrigatório"),
    questions: z.array(z.any()), // A validação das questões será feita internamente
  }))
});

type FormTemplateFormValues = z.infer<typeof formTemplateSchema>;

type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
  addTemplate: (template: Omit<FormTemplate, 'id'>) => void;
  updateTemplate: (template: FormTemplate) => void;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit, addTemplate, updateTemplate }: AddEditFormTemplateModalProps) {
  
  const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id'> | null>(null);

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        setInternalTemplate(JSON.parse(JSON.stringify(templateToEdit))); // Deep copy
      } else {
        // Create a new, blank template structure
        const newTemplate: Omit<FormTemplate, 'id'> = {
          name: 'Novo Formulário',
          type: 'standard',
          layout: 'continuous',
          submissionTitleFormat: '',
          sections: [
            { id: `section-${Date.now()}`, name: 'Seção 1', questions: [] }
          ],
        };
        setInternalTemplate(newTemplate);
      }
    } else {
      setInternalTemplate(null);
    }
  }, [open, templateToEdit]);
  
  const handleSave = () => {
    if (!internalTemplate) return;

    if ('id' in internalTemplate && internalTemplate.id) {
        updateTemplate(internalTemplate as FormTemplate);
    } else {
        addTemplate(internalTemplate as Omit<FormTemplate, 'id'>);
    }
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] h-[95vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            Construa seu formulário ou processo usando o editor visual abaixo.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 min-h-0 border-t pt-2">
            {internalTemplate && (
                 <FormBuilder 
                    key={('id' in internalTemplate) ? internalTemplate.id : 'new'}
                    initialTemplate={internalTemplate}
                    onTemplateChange={setInternalTemplate}
                />
            )}
        </div>
        
        <DialogFooter className="flex-shrink-0 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave}><Save className="mr-2 h-4 w-4" /> Salvar Modelo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
