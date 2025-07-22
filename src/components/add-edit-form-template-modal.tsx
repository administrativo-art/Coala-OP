

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

// Zod schema for a question, defined recursively
const baseTaskActionSchema = z.object({
  title: z.string().min(1, "O título da tarefa é obrigatório."),
  assigneeType: z.enum(['user', 'profile']),
  assigneeId: z.string().min(1, "Selecione um responsável."),
  requiresApproval: z.boolean(),
  approverType: z.enum(['user', 'profile']).optional(),
  approverId: z.string().optional(),
  description: z.string().optional(),
  dueInDays: z.coerce.number().optional(),
});

const taskActionSchema: z.ZodType<FormTaskAction> = baseTaskActionSchema.superRefine((data, ctx) => {
    if (data.requiresApproval) {
        if (!data.approverType) {
            ctx.addIssue({ code: 'custom', message: 'Tipo de aprovador é obrigatório.', path: ['approverType'] });
        }
        if (!data.approverId) {
            ctx.addIssue({ code: 'custom', message: 'Selecione um aprovador.', path: ['approverId'] });
        }
    }
});

const baseQuestionSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "A pergunta não pode estar em branco."),
  type: z.enum(['yes-no', 'text', 'number', 'single-choice', 'multiple-choice', 'file-attachment']),
  isRequired: z.boolean(),
  position: z.object({ x: z.number(), y: z.number() }),
  attachmentConfig: z.object({
      allowMultiple: z.boolean(),
      allowedFileTypes: z.array(z.enum(['image', 'pdf', 'video'])),
      allowCamera: z.boolean(),
  }).optional(),
  description: z.string().optional(),
  ramifications: z.array(z.object({
    id: z.string(),
    conditions: z.array(z.object({
        id: z.string(),
        value: z.union([z.string(), z.number()]),
        operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']),
    })),
    action: z.enum(['show_question', 'create_task']),
    targetQuestionId: z.string().optional(),
    taskAction: taskActionSchema.optional(),
  })).optional(),
});

const questionSchema: z.ZodType<FormQuestionType> = z.lazy(() => 
  baseQuestionSchema.extend({
    options: z.array(z.object({
      id: z.string(),
      value: z.string().min(1, "O texto da opção é obrigatório."),
    })).optional()
  })
);

const sectionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  questions: z.array(questionSchema).min(1, "A seção precisa ter pelo menos uma pergunta."),
});

const templateSchema = z.object({
  name: z.string().min(1, 'O nome do formulário é obrigatório.'),
  sections: z.array(sectionSchema).min(1, "O formulário precisa ter pelo menos uma seção."),
  layout: z.enum(['continuous', 'stepped']),
  submissionTitleFormat: z.string().optional(),
  type: z.enum(['standard', 'operational_checklist']),
  moment: z.enum(['PRE_ABERTURA', 'ABERTURA', 'TROCA_FECHAMENTO', 'TROCA_ABERTURA', 'FECHAMENTO_FINAL']).nullable(),
}).refine((data) => {
    if(data.type === 'operational_checklist' && !data.moment) {
        return false;
    }
    return true;
}, {
    message: "O 'Momento' é obrigatório para checklists operacionais.",
    path: ["moment"],
});

type TemplateFormValues = z.infer<typeof templateSchema>;

// Helper to create new objects
const createNewQuestion = (): FormQuestionType => ({
  id: 'q-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2),
  label: '',
  type: 'text',
  isRequired: true,
  options: [],
  position: { x: 0, y: 0 },
  attachmentConfig: {
      allowMultiple: false,
      allowedFileTypes: ['image'],
      allowCamera: true,
  }
});

const createNewSection = (): FormSection => ({
  id: 's-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2),
  name: '',
  questions: [createNewQuestion()]
});

// ==================== Question List Component (Recursive) ====================
type QuestionListProps = {
  control: Control<TemplateFormValues>;
  namePrefix: `sections.${number}.questions`;
}

const QuestionList: React.FC<QuestionListProps> = ({ control, namePrefix }) => {
  const { fields, append, remove, move } = useFieldArray({ control, name: namePrefix, keyName: 'rhfId' });

  return (
    <div className={`space-y-4`}>
      {fields.map((field, index) => (
        <QuestionItem
          key={field.rhfId}
          control={control}
          index={index}
          remove={() => remove(index)}
          namePrefix={`${namePrefix}.${index}`}
          questionId={field.id}
          onMoveUp={() => move(index, index - 1)}
          onMoveDown={() => move(index, index + 1)}
          isFirst={index === 0}
          isLast={index === fields.length - 1}
        />
      ))}
      <Button type="button" variant="outline" className="w-full" onClick={() => append(createNewQuestion())}>
        <PlusCircle className="mr-2" /> Adicionar pergunta
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
  questionId: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ control, index, remove, namePrefix, questionId, onMoveUp, onMoveDown, isFirst, isLast }) => {
  const questionType = useWatch({ control, name: `${namePrefix}.type` as any });
  const hasOptions = ['yes-no', 'single-choice', 'multiple-choice'].includes(questionType);

  const { fields: options, append: appendOption, remove: removeOption } = useFieldArray({
    control,
    name: `${namePrefix}.options` as any,
    keyName: 'rhfId'
  });

  useEffect(() => {
    if (hasOptions && options.length === 0) {
      if(questionType === 'yes-no') {
        appendOption({ id: 'opt-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2), value: 'Sim' });
        appendOption({ id: 'opt-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2), value: 'Não' });
      } else {
         appendOption({ id: 'opt-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2), value: '' });
      }
    }
  }, [hasOptions, questionType, options.length, appendOption]);


  return (
    <div className="p-4 border rounded-lg space-y-3 bg-card">
      <div className="flex items-start gap-2">
        <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 flex-grow">
          <FormField control={control} name={`${namePrefix}.label` as any} render={({ field }) => (
            <FormItem>
                <FormLabel>Texto da pergunta</FormLabel>
                <FormControl><Input placeholder={`Pergunta ${index + 1}`} {...field} /></FormControl>
                 <p className="text-xs text-muted-foreground pt-1">
                    ID para título: <code className="bg-muted text-foreground font-mono p-1 rounded">{`{${questionId}}`}</code>
                </p>
                <FormMessage />
            </FormItem>
          )}/>
          <FormField control={control} name={`${namePrefix}.type` as any} render={({ field }) => (
            <FormItem><FormLabel>Tipo de resposta</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="number">Número</SelectItem>
                <SelectItem value="yes-no">Sim / não</SelectItem>
                <SelectItem value="single-choice">Escolha única</SelectItem>
                <SelectItem value="multiple-choice">Múltipla escolha</SelectItem>
                 <SelectItem value="file-attachment">Anexo de arquivo</SelectItem>
              </SelectContent>
            </Select><FormMessage /></FormItem>
          )}/>
        </div>
        <div className="flex items-center shrink-0 mt-8">
            <FormField
                control={control}
                name={`${namePrefix}.isRequired` as any}
                render={({ field }) => (
                    <FormItem className="flex flex-col items-center justify-center space-y-2 pr-2">
                        <FormLabel className="text-xs">Obrigatória</FormLabel>
                        <FormControl>
                            <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                        </FormControl>
                    </FormItem>
                )}
            />
            <div className="flex flex-col">
                <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst}>
                    <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast}>
                    <ArrowDown className="h-4 w-4" />
                </Button>
            </div>
            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive self-center" onClick={remove}>
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
      </div>
      
      {hasOptions && (
        <div className="space-y-3 pt-2">
           <FormLabel>Opções de resposta e ramificações</FormLabel>
           {options.map((option, optionIndex) => (
             <div key={option.rhfId} className="pl-4">
                <div className="flex items-center gap-2">
                     <FormField
                        control={control}
                        name={`${namePrefix}.options.${optionIndex}.value` as any}
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
             </div>
           ))}
           {['single-choice', 'multiple-choice'].includes(questionType) && (
              <Button type="button" variant="outline" size="sm" className="ml-4" onClick={() => appendOption({ id: 'opt-' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2), value: '' })}>
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
    defaultValues: {
        name: '', 
        sections: [],
        layout: 'continuous',
        submissionTitleFormat: '',
        type: 'standard',
        moment: null,
    }
  });

  const { fields: sections, append: appendSection, remove: removeSection, move: moveSection } = useFieldArray({
    control: form.control,
    name: "sections",
    keyName: 'rhfId',
  });

  const formType = useWatch({ control: form.control, name: 'type' });

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        form.reset({
            ...templateToEdit,
            layout: templateToEdit.layout || 'continuous',
            submissionTitleFormat: templateToEdit.submissionTitleFormat || '',
            type: templateToEdit.type || 'standard',
            moment: templateToEdit.moment || null,
        });
      } else {
        form.reset({
            name: '',
            sections: [createNewSection()],
            layout: 'continuous',
            submissionTitleFormat: '',
            type: 'standard',
            moment: null,
        });
      }
    }
  }, [templateToEdit, open, form]);

  const onSubmit = (values: TemplateFormValues) => {
    const finalValues = { ...values };
    if (values.type === 'standard') {
        finalValues.moment = null;
    }

    if (templateToEdit) {
      updateTemplate({ ...templateToEdit, ...finalValues });
    } else {
      addTemplate(finalValues);
    }
    onOpenChange(false);
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            Defina o nome, as seções e as perguntas que farão parte deste modelo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="h-[65vh] p-4 -m-4 pr-6">
                <div className="space-y-6 p-2">
                    <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Nome do formulário</FormLabel>
                        <FormControl><Input placeholder="ex: Formulário de abertura de loja" {...field} /></FormControl>
                        <FormMessage />
                        </FormItem>
                    )}
                    />

                    <div className="space-y-4 rounded-lg border p-4">
                        <h3 className="text-md font-medium">Configurações do Formulário</h3>
                        <FormField
                            control={form.control}
                            name="type"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Tipo de Formulário</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        <SelectItem value="standard">Padrão (On-Demand)</SelectItem>
                                        <SelectItem value="operational_checklist">Checklist Operacional (Automático)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormDescription>
                                    Padrão é usado para tarefas avulsas. Checklist operacional é usado para rotinas diárias automáticas.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                         {formType === 'operational_checklist' && (
                             <FormField
                                control={form.control}
                                name="moment"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Momento do Checklist</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value || ''}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Selecione um momento..." /></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="PRE_ABERTURA">Pré-Abertura</SelectItem>
                                            <SelectItem value="ABERTURA">Abertura</SelectItem>
                                            <SelectItem value="TROCA_FECHAMENTO">Troca (Fechamento)</SelectItem>
                                            <SelectItem value="TROCA_ABERTURA">Troca (Abertura)</SelectItem>
                                            <SelectItem value="FECHAMENTO_FINAL">Fechamento Final</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />
                         )}
                        <FormField
                            control={form.control}
                            name="layout"
                            render={({ field }) => (
                                <FormItem className="space-y-3">
                                <FormLabel>Apresentação do formulário</FormLabel>
                                <FormControl>
                                    <RadioGroup
                                    onValueChange={field.onChange}
                                    value={field.value}
                                    className="flex flex-col space-y-1"
                                    >
                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                        <FormControl>
                                            <RadioGroupItem value="continuous" />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Página única (Todas as seções em uma tela)
                                        </FormLabel>
                                    </FormItem>
                                    <FormItem className="flex items-center space-x-3 space-y-0">
                                        <FormControl>
                                            <RadioGroupItem value="stepped" />
                                        </FormControl>
                                        <FormLabel className="font-normal">
                                            Passo a passo (Uma seção por tela)
                                        </FormLabel>
                                    </FormItem>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="submissionTitleFormat"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Formato do título da resposta (Opcional)</FormLabel>
                                <FormControl><Textarea placeholder="ex: Checklist de Abertura - Quiosque {kioskName}" {...field} /></FormControl>
                                <FormDescription>
                                    Crie um título dinâmico. Variáveis disponíveis: <code className="bg-muted p-1 rounded-sm text-xs">{'{kioskName}'}</code>, <code className="bg-muted p-1 rounded-sm text-xs">{'{username}'}</code>, <code className="bg-muted p-1 rounded-sm text-xs">{'{date}'}</code>. Para usar a resposta de uma pergunta, copie o ID dela, que aparece abaixo de cada pergunta criada.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    
                    <h3 className="text-md font-medium pt-2">Perguntas do formulário</h3>

                    {sections.length > 1 ? (
                        <Accordion type="multiple" defaultValue={sections.map(s => s.id)} className="w-full">
                            {sections.map((section, sectionIndex) => (
                            <AccordionItem value={section.id} key={section.rhfId} className="border rounded-md mb-2 bg-muted/50">
                                <AccordionTrigger className="p-4 hover:no-underline [&[data-state=open]]:border-b [&>svg]:ml-auto">
                                    <div className="flex items-center w-full gap-2 mr-4">
                                        <Controller
                                            control={form.control}
                                            name={`sections.${sectionIndex}.name`}
                                            render={({ field }) => (
                                            <Input
                                                {...field}
                                                placeholder={`Seção ${sectionIndex + 1} (Nome opcional)`}
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-lg font-semibold flex-grow border-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto bg-transparent"
                                            />
                                            )}
                                        />
                                        <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
                                            <Button asChild variant="ghost" size="icon" onClick={() => moveSection(sectionIndex, sectionIndex - 1)} disabled={sectionIndex === 0}>
                                            <span><ArrowUp className="h-4 w-4" /></span>
                                            </Button>
                                            <Button asChild variant="ghost" size="icon" onClick={() => moveSection(sectionIndex, sectionIndex + 1)} disabled={sectionIndex === sections.length - 1}>
                                            <span><ArrowDown className="h-4 w-4" /></span>
                                            </Button>
                                            <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => removeSection(sectionIndex)}>
                                            <span><Trash2 className="h-4 w-4" /></span>
                                            </Button>
                                        </div>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent className="p-4">
                                    <QuestionList control={form.control} namePrefix={`sections.${sectionIndex}.questions`} />
                                </AccordionContent>
                            </AccordionItem>
                            ))}
                        </Accordion>
                    ) : (
                         <div className="border rounded-lg p-4 bg-muted/50">
                            {sections[0] && <QuestionList control={form.control} namePrefix={`sections.0.questions`} />}
                         </div>
                    )}


                    <Button type="button" variant="outline" className="w-full" onClick={() => appendSection(createNewSection())}>
                        <PlusCircle className="mr-2" /> Adicionar seção
                    </Button>
                </div>
            </ScrollArea>
            <DialogFooter className="pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{templateToEdit ? 'Salvar alterações' : 'Criar formulário'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
