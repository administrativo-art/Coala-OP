
"use client"

import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { PlusCircle, Trash2, ArrowRight } from 'lucide-react';
import { type FormTemplate, type FormQuestion } from '@/types';

const questionConditionSchema = z.object({
  questionId: z.string(),
  value: z.string(),
}).nullable();

const questionSchema = z.object({
  id: z.string(),
  label: z.string().min(1, "A pergunta não pode estar em branco."),
  type: z.enum(['yes-no', 'text', 'number', 'single-choice', 'multiple-choice']),
  options: z.array(z.string()).optional(),
  condition: questionConditionSchema,
});

const templateSchema = z.object({
  name: z.string().min(1, 'O nome do modelo é obrigatório.'),
  questions: z.array(questionSchema).min(1, "O formulário precisa ter pelo menos uma pergunta."),
});

type TemplateFormValues = z.infer<typeof templateSchema>;

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

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "questions"
  });
  
  const watchedQuestions = form.watch('questions');

  useEffect(() => {
    if (open) {
      if (templateToEdit) {
        form.reset({
          name: templateToEdit.name,
          questions: templateToEdit.questions.map(q => ({ ...q, condition: q.condition || null, options: q.options || [] })),
        });
      } else {
        form.reset({ name: '', questions: [] });
      }
    }
  }, [templateToEdit, open, form]);

  const onSubmit = (values: TemplateFormValues) => {
    const finalValues = {
        ...values,
        questions: values.questions.map(q => ({
            ...q,
            // Remove empty strings from options
            options: q.options?.filter(opt => opt.trim() !== ''),
            // If not a choice type, remove options array
            ...(!['single-choice', 'multiple-choice'].includes(q.type) && { options: undefined })
        }))
    }
    if (templateToEdit) {
      updateTemplate({ ...templateToEdit, ...finalValues });
    } else {
      addTemplate(finalValues);
    }
    onOpenChange(false);
  };
  
  const handleAddQuestion = () => {
    append({ id: new Date().toISOString(), label: '', type: 'yes-no', options: [], condition: null });
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{templateToEdit ? 'Editar Modelo' : 'Criar Novo Modelo de Formulário'}</DialogTitle>
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
                  <FormLabel>Nome do Modelo</FormLabel>
                  <FormControl><Input placeholder="ex: Formulário de Abertura de Loja" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <h3 className="text-md font-medium">Perguntas</h3>
            <ScrollArea className="h-80">
              <div className="space-y-4 pr-4">
                {fields.map((field, index) => {
                  const currentQuestion = watchedQuestions[index];
                  const potentialConditions = watchedQuestions.slice(0, index).filter(q => ['yes-no', 'single-choice'].includes(q.type));
                  const sourceQuestionForCondition = potentialConditions.find(q => q.id === currentQuestion?.condition?.questionId);
                  const conditionValueOptions = sourceQuestionForCondition?.type === 'yes-no' 
                    ? ['Sim', 'Não'] 
                    : sourceQuestionForCondition?.options ?? [];

                  return (
                    <div key={field.id} className="p-4 border rounded-lg space-y-3 bg-secondary/30">
                        <div className="flex items-start gap-2">
                            <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2 flex-grow">
                                <FormField control={form.control} name={`questions.${index}.label`} render={({ field }) => (
                                    <FormItem><FormLabel>Texto da Pergunta</FormLabel><FormControl><Input placeholder={`Pergunta ${index + 1}`} {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name={`questions.${index}.type`} render={({ field }) => (
                                    <FormItem><FormLabel>Tipo de Resposta</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                        <SelectContent>
                                            <SelectItem value="yes-no">Sim / Não</SelectItem>
                                            <SelectItem value="text">Texto</SelectItem>
                                            <SelectItem value="number">Número</SelectItem>
                                            <SelectItem value="single-choice">Escolha Única</SelectItem>
                                            <SelectItem value="multiple-choice">Múltipla Escolha</SelectItem>
                                        </SelectContent>
                                    </Select><FormMessage /></FormItem>
                                )}/>
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="text-destructive hover:text-destructive mt-8" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                        
                        {['single-choice', 'multiple-choice'].includes(currentQuestion?.type) && (
                            <FormField
                                control={form.control}
                                name={`questions.${index}.options`}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Opções de Resposta</FormLabel>
                                        <FormControl>
                                            <Textarea 
                                                placeholder="Uma opção por linha..."
                                                value={Array.isArray(field.value) ? field.value.join('\n') : ''}
                                                onChange={e => field.onChange(e.target.value.split('\n'))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {potentialConditions.length > 0 && (
                             <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                                <FormField control={form.control} name={`questions.${index}.condition.questionId`} render={({ field }) => (
                                    <FormItem>
                                       <FormLabel className="text-xs">Exibir se a pergunta...</FormLabel>
                                       <Select onValueChange={field.onChange} value={field.value || ''}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="Sempre exibir..." /></SelectTrigger></FormControl>
                                            <SelectContent>{potentialConditions.map((q, i) => <SelectItem key={q.id} value={q.id}>{`[${i+1}] ${q.label}`}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </FormItem>
                                )}/>
                                <div className="pt-5 flex flex-col items-center">
                                    <p className="text-xs text-muted-foreground">for</p>
                                    <ArrowRight className="h-4 w-4" />
                                </div>
                                <FormField control={form.control} name={`questions.${index}.condition.value`} render={({ field }) => (
                                    <FormItem>
                                         <FormLabel className="text-xs">...</FormLabel>
                                         <Select onValueChange={field.onChange} value={field.value || ''} disabled={!currentQuestion?.condition?.questionId}>
                                            <FormControl><SelectTrigger><SelectValue placeholder="Valor..." /></SelectTrigger></FormControl>
                                            <SelectContent>
                                                {conditionValueOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </FormItem>
                                )}/>
                            </div>
                        )}
                    </div>
                  );
                })}
                 {fields.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">Nenhuma pergunta adicionada ainda.</p>
                 )}
              </div>
            </ScrollArea>
             <Button type="button" variant="outline" className="w-full" onClick={handleAddQuestion}>
                <PlusCircle className="mr-2" /> Adicionar Pergunta
            </Button>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit">{templateToEdit ? 'Salvar Alterações' : 'Criar Modelo'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
