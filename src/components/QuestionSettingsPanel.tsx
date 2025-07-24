
"use client";

import { useState, useEffect } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { type FormQuestion, type User, type Profile } from '@/types';
import { Button } from './ui/button';
import { X, PlusCircle, Trash2, GitBranch, AlertTriangle } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { nanoid } from 'nanoid';
import { ScrollArea } from './ui/scroll-area';
import { Alert, AlertTitle } from './ui/alert';


const ramificationSchema = z.object({
    id: z.string(),
    conditions: z.array(z.object({
        id: z.string(),
        value: z.string(),
        operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains']),
    })).min(1),
    action: z.enum(['show_question', 'create_task']).optional(),
    targetQuestionId: z.string().optional(),
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
  type: z.enum(['text', 'number', 'yes-no', 'single-choice', 'multiple-choice', 'file-attachment']),
  isRequired: z.boolean(),
  options: z.array(z.object({
      id: z.string(),
      value: z.string().min(1, "O valor da opção não pode ser vazio.")
  })).optional(),
  ramifications: z.array(ramificationSchema).optional(),
}).superRefine((data, ctx) => {
    if (data.ramifications) {
        data.ramifications.forEach((ram, index) => {
            if (ram.action === 'show_question' && !ram.targetQuestionId) {
                ctx.addIssue({
                    code: 'custom',
                    path: [`ramifications.${index}.targetQuestionId`],
                    message: "Selecione uma pergunta ou crie uma nova.",
                });
            }
        });
    }
});


type FormQuestionValues = z.infer<typeof formQuestionSchema>;

interface QuestionSettingsPanelProps {
  question: FormQuestion;
  allQuestions: FormQuestion[];
  users: User[];
  profiles: Profile[];
  onChange: (updatedQuestion: FormQuestion) => void;
  onClose: () => void;
}

export function QuestionSettingsPanel({ question, allQuestions, users, profiles, onChange, onClose }: QuestionSettingsPanelProps) {
  
  const form = useForm<FormQuestionValues>({
    resolver: zodResolver(formQuestionSchema),
    defaultValues: {
      ...question,
      options: question.options || [],
      ramifications: question.ramifications || [],
    }
  });

  const { fields: optionFields, append: appendOption, remove: removeOption, replace: replaceOptions } = useFieldArray({
    control: form.control,
    name: "options"
  });
  
  const { fields: ramificationFields, append: appendRamification, remove: removeRamification } = useFieldArray({
      control: form.control,
      name: "ramifications"
  });

  const questionType = form.watch('type');
  const showOptions = ['single-choice', 'multiple-choice'].includes(questionType);

  const onSubmit = () => {
    form.trigger().then(isValid => {
      if (isValid) {
        onChange({ ...question, ...form.getValues() });
      }
    });
  };
  
  // Debounced submit on form change
  useEffect(() => {
    const subscription = form.watch((value, { name, type }) => {
        if (type === 'change') {
            const timeoutId = setTimeout(() => onSubmit(), 500);
            return () => clearTimeout(timeoutId);
        }
    });
    return () => subscription.unsubscribe();
  }, [form.watch, onSubmit]);


  useEffect(() => {
    if (questionType === 'yes-no') {
        const yesNoOptions = [{ id: 'yes', value: 'Sim' }, { id: 'no', value: 'Não' }];
        if (JSON.stringify(form.getValues('options')) !== JSON.stringify(yesNoOptions)) {
           replaceOptions(yesNoOptions);
        }
    } else if (!showOptions) {
        replaceOptions([]);
    }
  }, [questionType, replaceOptions, showOptions, form]);

  const handleAddNewRamification = () => {
    appendRamification({
        id: nanoid(),
        conditions: [{ id: nanoid(), operator: 'eq', value: '' }],
        action: undefined,
    });
  };

  const isRamificationEnabled = ['yes-no', 'single-choice', 'multiple-choice', 'text', 'number'].includes(questionType);

  return (
    <div className="w-[500px] h-full border-l bg-card flex flex-col shrink-0">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="font-semibold text-lg">Editar Card</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
        </Button>
      </div>

      <Form {...form}>
        <form className="flex-1 overflow-hidden flex flex-col">
          <ScrollArea className="flex-1 pr-4">
              <div className="p-4 space-y-4">
                  <FormField control={form.control} name="label" render={({ field }) => (
                    <FormItem><FormLabel>Rótulo da pergunta</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                  )}/>
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem><FormLabel>Descrição (opcional)</FormLabel><FormControl><Textarea {...field} rows={2} /></FormControl><FormMessage/></FormItem>
                  )}/>
                  <div className="flex items-center justify-between">
                    <FormField control={form.control} name="type" render={({ field }) => (
                        <FormItem className="flex-grow mr-4"><FormLabel>Tipo de Resposta</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                                <SelectItem value="text">Texto</SelectItem>
                                <SelectItem value="number">Número</SelectItem>
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

                  {showOptions && (
                    <div className="space-y-2 p-3 border rounded-md">
                        <FormLabel>Opções de Resposta</FormLabel>
                        {optionFields.map((field, index) => (
                            <div key={field.id} className="flex items-center gap-2">
                                <FormField control={form.control} name={`options.${index}.value`} render={({ field }) => (
                                    <FormItem className="flex-grow"><FormControl><Input {...field} /></FormControl><FormMessage/></FormItem>
                                )}/>
                                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeOption(index)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" onClick={() => appendOption({ id: nanoid(), value: '' })}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Opção
                        </Button>
                    </div>
                  )}
                  
                  <div className="space-y-2 pt-4 border-t">
                     <h4 className="font-semibold flex items-center gap-2 text-muted-foreground"><GitBranch className="h-4 w-4" /> Ramificações e Ações</h4>
                     
                     {ramificationFields.map((field, index) => {
                         const ramification = form.watch(`ramifications.${index}`);
                         return (
                            <div key={field.id} className="p-3 border rounded-lg space-y-3 bg-muted/50">
                                <div className="flex justify-between items-center">
                                    <p className="font-medium text-sm">SE a resposta for...</p>
                                    <Button type="button" variant="ghost" size="icon" className="text-destructive h-7 w-7" onClick={() => removeRamification(index)}><Trash2 className="h-4 w-4"/></Button>
                                </div>
                                <div className="grid grid-cols-[1fr_1fr] gap-2 items-center">
                                    <FormField control={form.control} name={`ramifications.${index}.conditions.0.operator`} render={({field}) => (
                                        <FormItem>
                                             <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent>
                                                    <SelectItem value="eq">igual a</SelectItem>
                                                    <SelectItem value="neq">diferente de</SelectItem>
                                                    <SelectItem value="gt">maior que</SelectItem>
                                                    <SelectItem value="lt">menor que</SelectItem>
                                                    <SelectItem value="contains">contém</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}/>
                                    <FormField control={form.control} name={`ramifications.${index}.conditions.0.value`} render={({field}) => (
                                        <FormItem><FormControl><Input {...field} className="h-8" /></FormControl></FormItem>
                                    )}/>
                                </div>
                                
                                <p className="font-medium text-sm mt-2">ENTÃO...</p>

                                <FormField control={form.control} name={`ramifications.${index}.action`} render={({field}) => (
                                    <FormItem>
                                        <Select onValueChange={(v) => field.onChange(v === 'none' ? undefined : v)} value={field.value ?? 'none'}>
                                            <FormControl><SelectTrigger className="h-9"><SelectValue placeholder="Nenhuma ação"/></SelectTrigger></FormControl>
                                            <SelectContent>
                                                <SelectItem value="none">Nenhuma ação</SelectItem>
                                                <SelectItem value="show_question">Mostrar outra pergunta</SelectItem>
                                                <SelectItem value="create_task">Criar uma tarefa</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}/>
                                
                                {ramification.action === 'show_question' && (
                                  <>
                                    <FormField control={form.control} name={`ramifications.${index}.targetQuestionId`} render={({field}) => (
                                        <FormItem>
                                            <Select onValueChange={field.onChange} value={field.value}>
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
                                  </>
                                )}
                                
                                {ramification.action === 'create_task' && (
                                     <div className="p-2 border rounded-md bg-background space-y-2">
                                        <FormField control={form.control} name={`ramifications.${index}.taskAction.title`} render={({field}) => (
                                            <FormItem><FormLabel className="text-xs">Título da tarefa</FormLabel><FormControl><Input className="h-8" {...field} /></FormControl><FormMessage/></FormItem>
                                        )}/>
                                        <FormField control={form.control} name={`ramifications.${index}.taskAction.assigneeType`} render={({field}) => (
                                            <FormItem><FormLabel className="text-xs">Atribuir para</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="h-8"><SelectValue /></SelectTrigger></FormControl>
                                                <SelectContent><SelectItem value="user">Usuário</SelectItem><SelectItem value="profile">Perfil</SelectItem></SelectContent></Select>
                                            </FormItem>
                                        )}/>
                                        {ramification.taskAction?.assigneeType && (
                                            <FormField control={form.control} name={`ramifications.${index}.taskAction.assigneeId`} render={({field}) => (
                                                <FormItem>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl><SelectTrigger className="h-8"><SelectValue placeholder="Selecione..." /></SelectTrigger></FormControl>
                                                        <SelectContent>
                                                            {(ramification.taskAction.assigneeType === 'user' ? users : profiles).map(item => (
                                                                <SelectItem key={item.id} value={item.id}>{(item as any).username || (item as any).name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select><FormMessage/>
                                                </FormItem>
                                            )}/>
                                        )}
                                     </div>
                                )}
                            </div>
                         )
                     })}
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleAddNewRamification} disabled={!isRamificationEnabled}>
                          <PlusCircle className="mr-2 h-4 w-4" /> Adicionar Regra
                      </Button>
                      {!isRamificationEnabled && 
                        <p className="text-xs text-muted-foreground text-center">
                            Ramificações não estão disponíveis para o tipo de pergunta "Anexo".
                        </p>
                      }
                  </div>
              </div>
          </ScrollArea>
        </form>
      </Form>
    </div>
  );
}
