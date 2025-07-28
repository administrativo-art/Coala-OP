
"use client";

import { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type FormQuestion, type User, type Profile, type FormSection } from '@/types';
import { Button } from './ui/button';
import { PlusCircle, Trash2, GitBranch, X, DollarSign, Percent, Star, MoveHorizontal, Text, Hash, ToggleRight, List, CheckSquare, FileIcon, MessageSquareQuestion } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nanoid } from 'nanoid';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';


const ramificationSchema = z.object({
    id: z.string(),
    action: z.enum(['show_question', 'create_task', 'show_section', 'add_question']).optional(),
    targetQuestionId: z.string().optional(),
    targetSectionId: z.string().optional(),
    taskAction: z.object({
        title: z.string(),
        assigneeType: z.enum(['user', 'profile']),
        assigneeId: z.string(),
        requiresApproval: z.boolean(),
        approverType: z.enum(['user', 'profile']).optional(),
        approverId: z.string().optional(),
        description: z.string().optional(),
        dueInDays: z.coerce.number().optional(),
    }).optional(),
});

const formQuestionSchema = z.object({
  label: z.string().min(1, "O rótulo é obrigatório."),
  description: z.string().optional(),
  type: z.enum(['text', 'number', 'yes-no', 'single-choice', 'multiple-choice', 'file-attachment', 'range', 'rating']),
  isRequired: z.boolean(),
  options: z.array(z.object({
      id: z.string(),
      value: z.string().min(1, "O valor da opção não pode ser vazio."),
      ramification: ramificationSchema.optional(),
  })).optional(),
  numberConfig: z.object({
      format: z.enum(['default', 'currency', 'percentage']).optional(),
      min: z.coerce.number().optional(),
      max: z.coerce.number().optional(),
      step: z.coerce.number().optional(),
  }).optional(),
  rangeConfig: z.object({
      minLabel: z.string().optional(),
      maxLabel: z.string().optional(),
  }).optional(),
  ratingConfig: z.object({
      min: z.coerce.number().optional(),
      max: z.coerce.number().min(2).max(10).optional(),
  }).optional(),
  attachmentConfig: z.object({
      allowMultiple: z.boolean().optional(),
      allowedFileTypes: z.array(z.enum(['image', 'pdf', 'video'])).optional(),
      allowCamera: z.boolean().optional(),
  }).optional(),
  ramifications: z.array(ramificationSchema).optional(),
}).superRefine((data, ctx) => {
    if (data.options) {
        data.options.forEach((option, index) => {
             if (option.ramification?.action === 'show_section' && !option.ramification.targetSectionId) {
                ctx.addIssue({
                    code: 'custom',
                    path: [`options.${index}.ramification.targetSectionId`],
                    message: "Selecione uma seção.",
                });
            }
        });
    }
});


type FormQuestionValues = z.infer<typeof formQuestionSchema>;

const questionIcons: Record<FormQuestion['type'], React.ElementType> = {
  text: Text,
  number: Hash,
  'yes-no': ToggleRight,
  'single-choice': List,
  'multiple-choice': CheckSquare,
  'file-attachment': FileIcon,
  range: MoveHorizontal,
  rating: Star,
};

const SubQuestionItem = ({ question, parentQuestionId, onDeleteSubQuestion, ...props }: any) => {
    const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: question.id, data: { type: 'question', question } });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition: transition || 'transform 250ms ease',
    };

    return (
        <div ref={setNodeRef} style={style} className="bg-card border rounded-lg overflow-hidden">
             <Accordion type="single" collapsible className="w-full">
                <AccordionItem value={question.id} className="border-b-0">
                    <div className="flex items-center p-2 pr-3">
                         <AccordionTrigger className="p-2 text-left flex-1 hover:no-underline">
                             <div className="flex-1 flex items-center gap-3">
                                <div className="flex-1">
                                    <Input
                                        value={question.label}
                                        onChange={(e) => props.onQuestionChange({...question, label: e.target.value})}
                                        className="font-semibold border-none focus-visible:ring-1 bg-transparent p-1 h-auto"
                                        onClick={e => e.stopPropagation()}
                                    />
                                    <p className="text-xs text-muted-foreground uppercase">{props.questionTypeLabels[question.type] || question.type}</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <Button variant="ghost" size="icon" className="text-destructive h-10 w-10" onClick={(e) => { e.stopPropagation(); onDeleteSubQuestion(parentQuestionId, question.id);}}>
                            <Trash2 className="h-4 w-4"/>
                        </Button>
                    </div>
                    <AccordionContent className="px-4 pb-4">
                        <QuestionSettingsPanel
                            {...props}
                            question={question}
                        />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
};


interface QuestionSettingsPanelProps {
  question: FormQuestion;
  allQuestions: FormQuestion[];
  allSections: FormSection[];
  users: User[];
  profiles: Profile[];
  onChange: (updatedQuestion: FormQuestion) => void;
  onCreateSubQuestion: (parentQuestion: FormQuestion, optionId: string, type: FormQuestion['type']) => void;
  onDeleteSubQuestion: (parentQuestionId: string, subQuestionId: string) => void;
}

export function QuestionSettingsPanel({ question, allQuestions, allSections, users, profiles, onChange, onCreateSubQuestion, onDeleteSubQuestion }: QuestionSettingsPanelProps) {
  
  const form = useForm<FormQuestionValues>({
    resolver: zodResolver(formQuestionSchema),
    defaultValues: {
      ...question,
      options: question.options || [],
      numberConfig: question.numberConfig || {},
      rangeConfig: question.rangeConfig || { minLabel: 'Mínimo', maxLabel: 'Máximo'},
      ratingConfig: question.ratingConfig || { min: 1, max: 5 },
      attachmentConfig: question.attachmentConfig || { allowMultiple: false, allowedFileTypes: [], allowCamera: false }
    }
  });

  useEffect(() => {
    form.reset({
        ...question,
        options: question.options || [],
        numberConfig: question.numberConfig || {},
        rangeConfig: question.rangeConfig || { minLabel: 'Mínimo', maxLabel: 'Máximo'},
        ratingConfig: question.ratingConfig || { min: 1, max: 5 },
        attachmentConfig: question.attachmentConfig || { allowMultiple: false, allowedFileTypes: [], allowCamera: false }
    });
  }, [question, form]);

  const { fields: optionFields, append: appendOption, remove: removeOption, replace: replaceOptions } = useFieldArray({
    control: form.control,
    name: "options"
  });

  const questionType = form.watch('type');
  const numberFormat = form.watch('numberConfig.format');
  const watchedOptions = form.watch('options');
  const showOptions = ['single-choice', 'multiple-choice', 'yes-no'].includes(questionType);
  const allQuestionsMap = useMemo(() => new Map(allQuestions.map(q => [q.id, q])), [allQuestions]);

  const onSubmit = () => {
    form.trigger().then(isValid => {
      if (isValid) {
        onChange({ ...question, ...form.getValues() });
      }
    });
  };
  
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
        if (type === 'change') {
            const timeoutId = setTimeout(onSubmit, 500);
            return () => clearTimeout(timeoutId);
        }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.watch, onChange, question]);


  useEffect(() => {
    if (questionType === 'yes-no') {
        const yesNoOptions = [{ id: 'yes', value: 'Sim' }, { id: 'no', value: 'Não' }];
        if (JSON.stringify(form.getValues('options')) !== JSON.stringify(yesNoOptions)) {
           replaceOptions(yesNoOptions);
        }
    } else if (questionType !== 'single-choice' && questionType !== 'multiple-choice') {
        replaceOptions([]);
    }
  }, [questionType, replaceOptions, form]);

  return (
    <Form {...form}>
        <form className="space-y-6">
            <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem><FormLabel>Descrição (opcional)</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
            )}/>
            <div className="flex items-center justify-between">
                <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem className="flex-grow mr-4"><FormLabel>Tipo de Resposta</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="text">Texto</SelectItem>
                            <SelectItem value="number">Número</SelectItem>
                            <SelectItem value="range">Intervalo (numérico)</SelectItem>
                            <SelectItem value="rating">Avaliação (escala)</SelectItem>
                            <SelectItem value="yes-no">Sim/Não</SelectItem>
                            <SelectItem value="single-choice">Escolha Única</SelectItem>
                            <SelectItem value="multiple-choice">Múltipla Escolha</SelectItem>
                            <SelectItem value="file-attachment">Anexo</SelectItem>
                        </SelectContent>
                        </Select><FormMessage/>
                    </FormItem>
                )}/>
                <FormField control={form.control} name="isRequired" render={({ field }) => (
                    <FormItem className="flex flex-col"><FormLabel>Obrigatório</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} className="mt-2"/></FormControl></FormItem>
                )}/>
            </div>
            
            {questionType === 'file-attachment' && (
                <div className="space-y-4 pt-4 border-t">
                    <FormLabel>Configuração de anexo</FormLabel>
                     <div className="p-3 border rounded-lg bg-muted/50 space-y-4">
                        <FormField control={form.control} name="attachmentConfig.allowMultiple" render={({ field }) => (
                           <FormItem className="flex items-center gap-2"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel>Permitir múltiplos arquivos</FormLabel></FormItem>
                        )}/>
                         <FormField control={form.control} name="attachmentConfig.allowCamera" render={({ field }) => (
                           <FormItem className="flex items-center gap-2"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange}/></FormControl><FormLabel>Permitir captura de foto pela câmera</FormLabel></FormItem>
                        )}/>
                     </div>
                </div>
            )}
            
            {questionType === 'range' && (
                <div className="space-y-4 pt-4 border-t">
                    <FormLabel>Configuração do intervalo</FormLabel>
                     <div className="p-3 border rounded-lg bg-muted/50 grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="rangeConfig.minLabel" render={({ field }) => (
                            <FormItem><FormLabel>Rótulo Mínimo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                        )}/>
                        <FormField control={form.control} name="rangeConfig.maxLabel" render={({ field }) => (
                            <FormItem><FormLabel>Rótulo Máximo</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                        )}/>
                     </div>
                </div>
            )}
            
            {questionType === 'rating' && (
                <div className="space-y-4 pt-4 border-t">
                    <FormLabel>Configuração da avaliação</FormLabel>
                    <div className="p-3 border rounded-lg bg-muted/50 grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="ratingConfig.min" render={({ field }) => (
                            <FormItem><FormLabel>Valor Mínimo</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                        )}/>
                        <FormField control={form.control} name="ratingConfig.max" render={({ field }) => (
                            <FormItem><FormLabel>Valor Máximo</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                        )}/>
                    </div>
                </div>
            )}

            {questionType === 'number' && (
                <div className="space-y-4 pt-4 border-t">
                    <FormLabel>Configuração do número</FormLabel>
                    <div className="p-3 border rounded-lg bg-muted/50 space-y-4">
                        <FormField control={form.control} name="numberConfig.format" render={({ field }) => (
                             <FormItem><FormLabel>Formato</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || 'default'}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="default">Padrão</SelectItem>
                                    <SelectItem value="currency">Moeda (R$)</SelectItem>
                                    <SelectItem value="percentage">Percentual (%)</SelectItem>
                                </SelectContent>
                                </Select><FormMessage/>
                            </FormItem>
                        )}/>
                        {numberFormat !== 'default' && (
                             <div className="grid grid-cols-3 gap-2">
                                <FormField control={form.control} name="numberConfig.min" render={({ field }) => (
                                    <FormItem><FormLabel>Mínimo</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                                )}/>
                                <FormField control={form.control} name="numberConfig.max" render={({ field }) => (
                                    <FormItem><FormLabel>Máximo</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                                )}/>
                                <FormField control={form.control} name="numberConfig.step" render={({ field }) => (
                                    <FormItem><FormLabel>Incremento</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
                                )}/>
                            </div>
                        )}
                    </div>
                </div>
            )}


            {showOptions && (
                <div className="space-y-4 pt-4 border-t">
                    <FormLabel>Opções e Ramificações</FormLabel>
                    {optionFields.map((field, index) => {
                       const ramification = watchedOptions?.[index]?.ramification;
                       const subQuestion = ramification?.targetQuestionId ? allQuestionsMap.get(ramification.targetQuestionId) : null;
                        return (
                        <div key={field.id} className="relative">
                             <div className="p-3 border rounded-lg bg-muted/50 space-y-3">
                                <div className="flex items-center gap-2">
                                    <FormField control={form.control} name={`options.${index}.value`} render={({ field: optionField }) => (
                                        <FormItem className="flex-grow">
                                            <FormControl><Input {...optionField} disabled={questionType === 'yes-no'} /></FormControl>
                                            <FormMessage/>
                                        </FormItem>
                                    )}/>
                                    {questionType !== 'yes-no' && (
                                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeOption(index)}><Trash2 className="h-4 w-4" /></Button>
                                    )}
                                </div>
                                
                                {ramification ? (
                                    <div className="p-3 border rounded-lg space-y-3 bg-card">
                                        <div className="flex justify-between items-center">
                                            <p className="font-medium text-sm flex items-center gap-2"><GitBranch className="h-4 w-4"/> Ramificação</p>
                                            <Button type="button" variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => form.setValue(`options.${index}.ramification`, undefined)}><X className="h-4 w-4"/></Button>
                                        </div>
                                        <p className="font-medium text-sm">ENTÃO...</p>

                                        <FormField control={form.control} name={`options.${index}.ramification.action`} render={({field: actionField}) => (
                                            <FormItem>
                                                <Select onValueChange={(v) => actionField.onChange(v === 'none' ? undefined : v)} value={actionField.value ?? 'none'}>
                                                    <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma ação"/></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="none">Nenhuma ação</SelectItem>
                                                        <SelectItem value="add_question">Criar sub-pergunta</SelectItem>
                                                        <SelectItem value="show_question">Pular para outra pergunta</SelectItem>
                                                        <SelectItem value="show_section">Pular para seção</SelectItem>
                                                        <SelectItem value="create_task">Criar uma tarefa</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}/>
                                        
                                        {ramification.action === 'add_question' && !subQuestion && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button type="button" variant="outline" size="sm" className="w-full">
                                                        <MessageSquareQuestion className="mr-2" />
                                                        Adicionar sub-pergunta
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent>
                                                    {Object.entries(questionIcons).map(([type, Icon]) => (
                                                        <DropdownMenuItem key={type} onSelect={() => onCreateSubQuestion(question, field.id, type as FormQuestion['type'])}>
                                                            <Icon className="mr-2 h-4 w-4" />
                                                            <span>{(type.charAt(0).toUpperCase() + type.slice(1)).replace('-', ' ')}</span>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                        
                                        {ramification.action === 'show_question' && (
                                            <FormField control={form.control} name={`options.${index}.ramification.targetQuestionId`} render={({field: targetField}) => (
                                                <FormItem>
                                                    <Select
                                                        onValueChange={targetField.onChange}
                                                        value={targetField.value}
                                                        >
                                                        <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione a pergunta..."/></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {allQuestions.filter(q => q.id !== question.id && !q.excluidaDoSumario).map(q => (
                                                                <SelectItem key={q.id} value={q.id}>{q.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select><FormMessage/>
                                                </FormItem>
                                            )}/>
                                        )}

                                        {ramification.action === 'show_section' && (
                                            <FormField control={form.control} name={`options.${index}.ramification.targetSectionId`} render={({field: targetField}) => (
                                                <FormItem>
                                                    <Select onValueChange={targetField.onChange} value={targetField.value}>
                                                        <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione a seção..."/></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {allSections.map(s => (
                                                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select><FormMessage/>
                                                </FormItem>
                                            )}/>
                                        )}
                                    </div>
                                ) : (
                                    <Button type="button" variant="outline" size="sm" onClick={() => form.setValue(`options.${index}.ramification`, { id: nanoid() })}>
                                        <GitBranch className="mr-2 h-4 w-4" /> Adicionar ramificação
                                    </Button>
                                )}
                            </div>
                            
                             {subQuestion && (
                                <div className="relative pl-8 pt-4">
                                    <div className="absolute left-4 top-0 bottom-2 w-px bg-border/70 border-dashed -translate-x-1/2"></div>
                                    <div className="absolute left-4 top-8 h-px w-4 bg-border/70 border-dashed -translate-x-1/2"></div>
                                    <SubQuestionItem
                                        question={subQuestion}
                                        parentQuestionId={question.id}
                                        onQuestionChange={onChange}
                                        onDeleteSubQuestion={onDeleteSubQuestion}
                                        onCreateSubQuestion={onCreateSubQuestion}
                                        allQuestions={allQuestions}
                                        allSections={allSections}
                                        users={users}
                                        profiles={profiles}
                                        questionTypeLabels={questionIcons}
                                        {...props}
                                    />
                                </div>
                            )}
                        </div>
                    )})}
                    {questionType !== 'yes-no' && (
                        <Button type="button" variant="outline" size="sm" onClick={() => appendOption({ id: nanoid(), value: '' })}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Opção
                        </Button>
                    )}
                </div>
            )}
        </form>
    </Form>
  );
}
