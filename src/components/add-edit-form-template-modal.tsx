
"use client"

import React, { useEffect } from 'react';
import { useForm, useFieldArray, Control, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Trash2, GitBranchPlus } from 'lucide-react';
import { type FormTemplate } from '@/types';
import type { FormQuestion as FormQuestionType } from '@/types';

// Zod schema for a question, defined recursively
const baseQuestionSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "A pergunta não pode estar em branco."),
  type: z.enum(['yes-no', 'text', 'number', 'single-choice', 'multiple-choice']),
});

const questionSchema: z.ZodType<FormQuestionType> = z.lazy(() => 
  baseQuestionSchema.extend({
    options: z.array(z.object({
      id: z.string(),
      value: z.string().min(1, "O texto da opção é obrigatório."),
      subQuestions: z.array(questionSchema)
    })).optional()
  })
);

const templateSchema = z.object({
  name: z.string().min(1, 'O nome do modelo é obrigatório.'),
  questions: z.array(questionSchema).min(1, "O formulário precisa ter pelo menos uma pergunta."),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

// Helper to create a new question object
const createNewQuestion = (): FormQuestionType => ({
  id: new Date().toISOString() + Math.random(),
  label: '',
  type: 'text',
  options: []
});

// ==================== Question List Component (Recursive) ====================
type QuestionListProps = {
  control: Control<TemplateFormValues>;
  namePrefix: `questions` | `${string}.subQuestions`;
  level: number;
}

const QuestionList: React.FC<QuestionListProps> = ({ control, namePrefix, level }) => {
  const { fields, append, remove } = useFieldArray({ control, name: namePrefix });

  return (
    <div className={`space-y-4 ${level > 0 ? 'pl-4 border-l-2 border-dashed' : ''}`}>
      {fields.map((field, index) => (
        <QuestionItem
          key={field.id}
          control={control}
          index={index}
          remove={() => remove(index)}
          namePrefix={`${namePrefix}.${index}`}
          level={level}
        />
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={() => append(createNewQuestion())}>
        <PlusCircle className="mr-2" /> Adicionar pergunta {level > 0 ? 'na ramificação' : ''}
      </Button>
    </div>
  );
};

// ==================== Question Item Component ====================
type QuestionItemProps = {
  control: Control<TemplateFormValues>;
  index: number;
  remove: () => void;
  namePrefix: string;
  level: number;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ control, index, remove, namePrefix, level }) => {
  const questionType = useWatch({ control, name: `${namePrefix}.type` });
  const hasOptions = ['yes-no', 'single-choice', 'multiple-choice'].includes(questionType);

  const { fields: options, append: appendOption, remove: removeOption } = useFieldArray({
    control,
    name: `${namePrefix}.options`
  });

  // Effect to manage options based on question type
  useEffect(() => {
    if (hasOptions && options.length === 0) {
      if(questionType === 'yes-no') {
        appendOption({ id: new Date().toISOString() + Math.random(), value: 'Sim', subQuestions: [] });
        appendOption({ id: new Date().toISOString() + Math.random(), value: 'Não', subQuestions: [] });
      } else {
         appendOption({ id: new Date().toISOString() + Math.random(), value: '', subQuestions: [] });
      }
    }
  }, [hasOptions, questionType, options.length, appendOption]);


  return (
    <div className="p-4 border rounded-lg space-y-3 bg-secondary/30">
      <div className="flex items-start gap-2">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 flex-grow">
          <FormField control={control} name={`${namePrefix}.label`} render={({ field }) => (
            <FormItem><FormLabel>Texto da pergunta</FormLabel><FormControl><Input placeholder={`Pergunta ${index + 1}`} {...field} /></FormControl><FormMessage /></FormItem>
          )}/>
          <FormField control={control} name={`${namePrefix}.type`} render={({ field }) => (
            <FormItem><FormLabel>Tipo de resposta</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="number">Número</SelectItem>
                <SelectItem value="yes-no">Sim / não</SelectItem>
                <SelectItem value="single-choice">Escolha única</SelectItem>
                <SelectItem value="multiple-choice">Múltipla escolha</SelectItem>
              </SelectContent>
            </Select><FormMessage /></FormItem>
          )}/>
        </div>
        <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive mt-8" onClick={remove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      
      {hasOptions && (
        <div className="space-y-3 pt-2">
           <FormLabel>Opções de resposta e ramificações</FormLabel>
           {options.map((option, optionIndex) => (
             <div key={option.id} className="pl-4">
                <div className="flex items-center gap-2">
                     <FormField
                        control={control}
                        name={`${namePrefix}.options.${optionIndex}.value`}
                        render={({ field }) => (
                            <FormItem className="flex-grow">
                                <FormControl><Input placeholder={`Opção ${optionIndex + 1}`} {...field} disabled={questionType === 'yes-no'} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                        />
                    {questionType !== 'yes-no' && (
                       <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => removeOption(optionIndex)}>
                           <Trash2 className="h-4 w-4" />
                       </Button>
                    )}
                </div>
                <div className="pt-2">
                   <QuestionList control={control} namePrefix={`${namePrefix}.options.${optionIndex}.subQuestions`} level={level + 1} />
                </div>
             </div>
           ))}
           {['single-choice', 'multiple-choice'].includes(questionType) && (
              <Button type="button" variant="outline" size="sm" className="ml-4" onClick={() => appendOption({ id: new Date().toISOString() + Math.random(), value: '', subQuestions: [] })}>
                Adicionar opção
              </Button>
           )}
        </div>
      )}
    </div>
  );
}


// ==================== Main Modal Component ====================
type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
  addTemplate: (template: Omit<FormTemplate, 'id'>) => void;
  updateTemplate: (template: FormTemplate) => void;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit, addTemplate, updateTemplate }: AddEditFormTemplateModalProps) {
  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: '', questions: [] }
  });

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        form.reset(templateToEdit);
      } else {
        form.reset({ name: '', questions: [] });
      }
    }
  }, [templateToEdit, open, form]);

  const onSubmit = (values: TemplateFormValues) => {
    if (templateToEdit) {
      updateTemplate({ ...templateToEdit, ...values });
    } else {
      addTemplate(values);
    }
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{templateToEdit ? 'Editar modelo' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            Defina o nome e as perguntas que farão parte deste modelo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome do modelo</FormLabel>
                  <FormControl><Input placeholder="ex: Formulário de abertura de loja" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <h3 className="text-md font-medium">Perguntas</h3>
            <ScrollArea className="h-80 pr-4">
                <QuestionList control={form.control} namePrefix="questions" level={0} />
            </ScrollArea>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{templateToEdit ? 'Salvar alterações' : 'Criar modelo'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
