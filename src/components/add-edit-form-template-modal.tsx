
"use client"

import React, { useEffect } from 'react';
import { useForm, useFieldArray, Control, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PlusCircle, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { type FormTemplate, type FormQuestion as FormQuestionType, type FormSection } from '@/types';

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

const sectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "O nome da seção é obrigatório."),
  questions: z.array(questionSchema).min(1, "A seção precisa ter pelo menos uma pergunta."),
});

const templateSchema = z.object({
  name: z.string().min(1, 'O nome do formulário é obrigatório.'),
  sections: z.array(sectionSchema).min(1, "O formulário precisa ter pelo menos uma seção."),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

// Helper to create new objects
const createNewQuestion = (): FormQuestionType => ({
  id: new Date().toISOString() + Math.random(),
  label: '',
  type: 'text',
  options: []
});

const createNewSection = (): FormSection => ({
  id: new Date().toISOString() + Math.random(),
  name: '',
  questions: [createNewQuestion()]
});

// ==================== Question List Component (Recursive) ====================
type QuestionListProps = {
  control: Control<TemplateFormValues>;
  namePrefix: `sections.${number}.questions` | `${string}.subQuestions`;
  level: number;
}

const QuestionList: React.FC<QuestionListProps> = ({ control, namePrefix, level }) => {
  const { fields, append, remove, move } = useFieldArray({ control, name: namePrefix });

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
          onMoveUp={() => move(index, index - 1)}
          onMoveDown={() => move(index, index + 1)}
          isFirst={index === 0}
          isLast={index === fields.length - 1}
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
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

const QuestionItem: React.FC<QuestionItemProps> = ({ control, index, remove, namePrefix, level, onMoveUp, onMoveDown, isFirst, isLast }) => {
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
    <div className="p-4 border rounded-lg space-y-3 bg-card">
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
        <div className="flex items-center shrink-0 mt-8">
            <Button type="button" variant="ghost" size="icon" onClick={onMoveUp} disabled={isFirst}>
                <ArrowUp className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onMoveDown} disabled={isLast}>
                <ArrowDown className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={remove}>
                <Trash2 className="h-4 w-4" />
            </Button>
        </div>
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
    defaultValues: { name: '', sections: [] }
  });

  const { fields: sections, append: appendSection, remove: removeSection, move: moveSection } = useFieldArray({
    control: form.control,
    name: "sections"
  });

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        form.reset(templateToEdit);
      } else {
        form.reset({ name: '', sections: [createNewSection()] });
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
          <DialogTitle>{templateToEdit ? 'Editar formulário' : 'Novo formulário'}</DialogTitle>
          <DialogDescription>
            Defina o nome, as seções e as perguntas que farão parte deste modelo.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="h-[60vh] p-4 -m-4 pr-6">
                <div className="space-y-4 p-2">
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
                    
                    <h3 className="text-md font-medium pt-2">Seções e perguntas</h3>
                    <Accordion type="multiple" defaultValue={sections.map(s => s.id)} className="w-full">
                        {sections.map((section, sectionIndex) => (
                        <AccordionItem value={section.id} key={section.id} className="border rounded-md mb-2 bg-muted">
                            <AccordionTrigger className="p-4 hover:no-underline [&[data-state=open]]:border-b [&>svg]:ml-auto">
                                <div className="flex items-center w-full gap-2 mr-4">
                                    <Controller
                                        control={form.control}
                                        name={`sections.${sectionIndex}.name`}
                                        render={({ field }) => (
                                        <Input
                                            {...field}
                                            placeholder={`Nome da seção ${sectionIndex + 1}`}
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
                                        {sections.length > 1 && (
                                            <Button asChild variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => removeSection(sectionIndex)}>
                                            <span><Trash2 className="h-4 w-4" /></span>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </AccordionTrigger>
                            <AccordionContent className="p-4">
                            <QuestionList control={form.control} namePrefix={`sections.${sectionIndex}.questions`} level={0} />
                            </AccordionContent>
                        </AccordionItem>
                        ))}
                    </Accordion>

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
