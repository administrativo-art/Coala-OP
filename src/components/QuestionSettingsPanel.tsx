
"use client";

import { useState, useEffect } from 'react';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type FormQuestion, type User, type Profile, type FormSection } from '@/types';
import { Button } from './ui/button';
import { PlusCircle, Trash2, GitBranch, X, DollarSign, Percent } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { nanoid } from 'nanoid';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';


const ramificationSchema = z.object({
    id: z.string(),
    action: z.enum(['show_question', 'create_task', 'show_section']).optional(),
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
      max: z.coerce.number().min(2).max(10).optional(),
  }).optional(),
  ramifications: z.array(ramificationSchema).optional(),
}).superRefine((data, ctx) => {
    if (data.options) {
        data.options.forEach((option, index) => {
            if (option.ramification?.action === 'show_question' && !option.ramification.targetQuestionId) {
                ctx.addIssue({
                    code: 'custom',
                    path: [`options.${index}.ramification.targetQuestionId`],
                    message: "Selecione uma pergunta ou crie uma nova.",
                });
            }
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

interface QuestionSettingsPanelProps {
  question: FormQuestion;
  allQuestions: FormQuestion[];
  allSections: FormSection[];
  users: User[];
  profiles: Profile[];
  onChange: (updatedQuestion: FormQuestion) => void;
}

export function QuestionSettingsPanel({ question, allQuestions, allSections, users, profiles, onChange }: QuestionSettingsPanelProps) {
  
  const form = useForm<FormQuestionValues>({
    resolver: zodResolver(formQuestionSchema),
    defaultValues: {
      ...question,
      options: question.options || [],
      numberConfig: question.numberConfig || {},
      rangeConfig: question.rangeConfig || { minLabel: 'Mínimo', maxLabel: 'Máximo'},
      ratingConfig: question.ratingConfig || { max: 5 },
    }
  });

  useEffect(() => {
    form.reset({
        ...question,
        options: question.options || [],
        numberConfig: question.numberConfig || {},
        rangeConfig: question.rangeConfig || { minLabel: 'Mínimo', maxLabel: 'Máximo'},
        ratingConfig: question.ratingConfig || { max: 5 },
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
            const timeoutId = setTimeout(() => onSubmit(), 500);
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
                     <div className="p-3 border rounded-lg bg-muted/50">
                         <FormField control={form.control} name="ratingConfig.max" render={({ field }) => (
                            <FormItem><FormLabel>Valor máximo da escala (2 a 10)</FormLabel><FormControl><Input type="number" min="2" max="10" {...field} value={field.value ?? ''} /></FormControl><FormMessage/></FormItem>
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
                        return (
                        <div key={field.id} className="p-3 border rounded-lg bg-muted/50 space-y-3">
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
                                                    <SelectItem value="show_question">Mostrar outra pergunta</SelectItem>
                                                    <SelectItem value="show_section">Pular para seção</SelectItem>
                                                    <SelectItem value="create_task">Criar uma tarefa</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}/>
                                    
                                    {ramification.action === 'show_question' && (
                                        <FormField control={form.control} name={`options.${index}.ramification.targetQuestionId`} render={({field: targetField}) => (
                                            <FormItem>
                                                <Select onValueChange={targetField.onChange} value={targetField.value}>
                                                    <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Selecione a pergunta..."/></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="__CREATE_NEW__">
                                                            <span className="flex items-center"><PlusCircle className="mr-2 h-4 w-4" /> Criar nova pergunta...</span>
                                                        </SelectItem>
                                                        {allQuestions.filter(q => q.id !== question.id).map(q => (
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
