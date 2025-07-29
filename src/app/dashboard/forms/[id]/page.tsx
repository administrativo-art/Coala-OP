
"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { FormProvider } from '@/components/ui/form';

import { useForms } from '@/hooks/use-form';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { type FormTemplate, type FormQuestion, type Ramification } from '@/types';
import { formTemplateSchema } from '@/lib/schemas';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormItem, FormLabel, FormControl, FormMessage, FormField } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, PlusCircle, Save, Settings, Trash2, Eye } from 'lucide-react';

import { QuestionTypeSelector } from '@/components/QuestionTypeSelector';
import { SortableQuestionItem } from '@/components/SortableQuestionItem';
import { QuestionSettingsPanel } from '@/components/QuestionSettingsPanel';
import { DeleteConfirmationDialog } from '@/components/delete-confirmation-dialog';

type FormBuilderValues = z.infer<typeof formTemplateSchema>;

const SubQuestionDisplay = ({
  question,
  allQuestions,
  onQuestionChange,
  onDuplicate,
  onDelete,
  onCreateSubQuestion,
  onDeleteSubQuestion,
  users,
  profiles,
}: {
  question: FormQuestion;
  allQuestions: FormQuestion[];
  onQuestionChange: (question: FormQuestion) => void;
  onDuplicate: (questionId: string) => void;
  onDelete: (questionId: string) => void;
  onCreateSubQuestion: (parentQuestionId: string, optionId: string) => void;
  onDeleteSubQuestion: (parentQuestionId: string, optionId: string, subQuestionId: string) => void;
  users: any[];
  profiles: any[];
}) => {
  const ramifiedOptions = question.options?.filter(opt => opt.ramification) || [];
  if (ramifiedOptions.length === 0) return null;

  return (
    <div className="pl-8 mt-4 space-y-4 border-l-2 border-dashed">
      {ramifiedOptions.map(option => {
        const subQuestion = allQuestions.find(q => q.id === option.ramification?.targetQuestionId);
        if (!subQuestion) return null;

        return (
          <div key={subQuestion.id} className="bg-muted/50 p-4 rounded-lg">
            <p className="text-sm font-semibold text-muted-foreground mb-2">
              Se a resposta para "{question.label}" for "{option.label}", mostrar:
            </p>
            <div id={subQuestion.id} className="bg-background/50 rounded-lg">
                 <QuestionSettingsPanel
                    question={subQuestion}
                    onChange={onQuestionChange}
                    onDuplicate={() => onDuplicate(subQuestion.id)}
                    onDelete={() => onDelete(subQuestion.id)}
                    allQuestions={allQuestions}
                    onCreateSubQuestion={onCreateSubQuestion}
                    onDeleteSubQuestion={onDeleteSubQuestion}
                    users={users}
                    profiles={profiles}
                />
            </div>
            {/* Recursive call for nested sub-questions */}
             <SubQuestionDisplay
                question={subQuestion}
                allQuestions={allQuestions}
                onQuestionChange={onQuestionChange}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                onCreateSubQuestion={onCreateSubQuestion}
                onDeleteSubQuestion={onDeleteSubQuestion}
                users={users}
                profiles={profiles}
            />
          </div>
        );
      })}
    </div>
  );
};

export default function FormBuilderPage() {
  const router = useRouter();
  const params = useParams();
  const { templates, addTemplate, updateTemplate, loading } = useForms();
  const { users } = useAuth();
  const { profiles } = useProfiles();
  const [internalTemplate, setInternalTemplate] = useState<FormTemplate | null>(null);
  const [questionToDelete, setQuestionToDelete] = useState<FormQuestion | null>(null);

  const form = useForm<FormBuilderValues>({
    resolver: zodResolver(formTemplateSchema),
    defaultValues: {
      name: '',
      description: '',
      questions: [],
    },
  });

  const { fields, append, remove, move, update } = useFieldArray({
    control: form.control,
    name: "questions",
  });
  
  const watchedQuestions = useWatch({ control: form.control, name: 'questions' });

  useEffect(() => {
    const templateId = params.id as string;
    if (templateId === 'new') {
      const newTemplateData = { id: '', name: 'Novo formulário', description: '', questions: [] };
      setInternalTemplate(newTemplateData);
      form.reset(newTemplateData);
    } else {
      const foundTemplate = templates.find(t => t.id === templateId);
      if (foundTemplate) {
        setInternalTemplate(foundTemplate);
        form.reset(foundTemplate);
      }
    }
  }, [params.id, templates, form]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = fields.findIndex(q => q.id === active.id);
      const newIndex = fields.findIndex(q => q.id === over!.id);
      move(oldIndex, newIndex);
    }
  };
  
  const reorderQuestions = useCallback((questions: FormQuestion[]) => {
      const questionMap = new Map(questions.map(q => [q.id, q]));
      const orderedQuestions: FormQuestion[] = [];
      const visited = new Set<string>();

      const visit = (question: FormQuestion) => {
          if (visited.has(question.id)) return;
          visited.add(question.id);
          
          const questionWithOptions = questions.find(q => q.id === question.id);
          orderedQuestions.push({ ...questionWithOptions, order: orderedQuestions.length });

          if (questionWithOptions?.options) {
              for (const option of questionWithOptions.options) {
                  if (option.ramification?.targetQuestionId) {
                      const subQuestion = questionMap.get(option.ramification.targetQuestionId);
                      if (subQuestion) {
                          visit(subQuestion);
                      }
                  }
              }
          }
      };

      questions.filter(q => !q.excluidaDoSumario).forEach(visit);
      
      const orphanedQuestions = questions.filter(q => !visited.has(q.id));
      orphanedQuestions.forEach(visit);
      
      return orderedQuestions;
  }, []);

  const handleQuestionChange = (updatedQuestion: FormQuestion) => {
    const index = fields.findIndex(q => q.id === updatedQuestion.id);
    if (index !== -1) {
      update(index, updatedQuestion);
    }
  };

  const handleDuplicateQuestion = (questionId: string) => {
    const questionToDuplicate = fields.find(q => q.id === questionId);
    if (questionToDuplicate) {
      const newQuestion = {
        ...questionToDuplicate,
        id: `q-${new Date().getTime()}`,
        label: `${questionToDuplicate.label} (cópia)`,
      };
      const index = fields.findIndex(q => q.id === questionId);
      append(newQuestion, { shouldFocus: false });
    }
  };
  
  const handleAddQuestion = (questionType: FormQuestion['type']) => {
    if (!questionType) questionType = 'text'; // Fallback
    append({
        id: `q-${new Date().getTime()}`,
        label: "Nova Pergunta",
        type: questionType,
        options: [],
        ramifications: []
    });
  };

  const handleCreateSubQuestion = (parentQuestionId: string, optionId: string) => {
    const newSubQuestion: FormQuestion = {
      id: `q-${new Date().getTime()}`,
      label: 'Nova sub-pergunta',
      type: 'text',
      options: [],
      ramifications: [],
      excluidaDoSumario: true,
      order: 0, 
    };

    const currentTemplate = form.getValues();
    let questions = [...currentTemplate.questions];
    let parentQuestionIndex = -1;

    // Deep find and update
    const findAndUpdate = (qs: FormQuestion[]): FormQuestion[] => {
        return qs.map((q, index) => {
            if (q.id === parentQuestionId) {
                parentQuestionIndex = index;
                const updatedOptions = (q.options || []).map(opt => {
                    if (opt.id === optionId) {
                        return { ...opt, ramification: { targetQuestionId: newSubQuestion.id } };
                    }
                    return opt;
                });
                return { ...q, options: updatedOptions };
            }
            return q;
        });
    };

    questions = findAndUpdate(questions);
    
    if (parentQuestionIndex !== -1) {
        questions.splice(parentQuestionIndex + 1, 0, newSubQuestion);
        const reordered = reorderQuestions(questions);
        form.setValue('questions', reordered, { shouldDirty: true });
    }
  };

  const handleDeleteSubQuestion = (parentQuestionId: string, optionId: string, subQuestionId: string) => {
      let currentQuestions = [...form.getValues().questions];
      
      // Remove a ramificação da pergunta-mãe
      currentQuestions = currentQuestions.map(q => {
          if (q.id === parentQuestionId) {
              return {
                  ...q,
                  options: (q.options || []).map(opt => {
                      if (opt.id === optionId) {
                          const { ramification, ...rest } = opt;
                          return rest;
                      }
                      return opt;
                  })
              };
          }
          return q;
      });

      // Remove a sub-pergunta (e suas sub-perguntas aninhadas recursivamente)
      const idsToDelete = new Set<string>([subQuestionId]);
      let changed = true;
      while(changed) {
          changed = false;
          currentQuestions.forEach(q => {
              if (idsToDelete.has(q.id) && q.options) {
                  q.options.forEach(opt => {
                      if (opt.ramification?.targetQuestionId && !idsToDelete.has(opt.ramification.targetQuestionId)) {
                          idsToDelete.add(opt.ramification.targetQuestionId);
                          changed = true;
                      }
                  });
              }
          });
      }

      const finalQuestions = currentQuestions.filter(q => !idsToDelete.has(q.id));
      const reordered = reorderQuestions(finalQuestions);
      form.setValue('questions', reordered, { shouldDirty: true });
  };
  
  const onDeleteQuestion = (question: FormQuestion) => {
    // Check if this question is a sub-question of another
    const parentInfo = findParentQuestion(question.id, fields);

    if (parentInfo) {
      handleDeleteSubQuestion(parentInfo.parentId, parentInfo.optionId, question.id);
    } else {
      const index = fields.findIndex(q => q.id === question.id);
      if (index !== -1) {
        remove(index);
      }
    }
  };
  
  const findParentQuestion = (childQuestionId: string, allQuestions: FormQuestion[]): { parentId: string, optionId: string } | null => {
      for (const question of allQuestions) {
          if (question.options) {
              for (const option of question.options) {
                  if (option.ramification?.targetQuestionId === childQuestionId) {
                      return { parentId: question.id, optionId: option.id };
                  }
              }
          }
      }
      return null;
  };
  
  const onSubmit = async (data: FormBuilderValues) => {
    if (!internalTemplate) return;

    const finalData = {
      ...internalTemplate,
      ...data,
      questions: reorderQuestions(data.questions),
      updatedAt: new Date().toISOString()
    };
    
    if (params.id === 'new') {
        const { id, ...dataToSave } = finalData;
        const newId = await addTemplate(dataToSave);
        if(newId) router.push(`/dashboard/forms/${newId}`);
    } else {
        await updateTemplate(finalData);
    }
  };

  if (loading || !internalTemplate) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-24" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  
  const mainQuestions = watchedQuestions.filter(q => !q.excluidaDoSumario)
    .sort((a,b) => (a.order || 0) - (b.order || 0));

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col md:flex-row gap-8">
          <div className="md:w-1/3 lg:w-1/4 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Configurações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do formulário</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}/>
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}/>
                <div className="flex justify-between items-center pt-2">
                   <Button type="button" variant="outline" onClick={() => router.push('/dashboard/forms')}>
                        <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                    </Button>
                    <Button type="submit">
                      <Save className="mr-2 h-4 w-4" /> Salvar
                    </Button>
                </div>
              </CardContent>
            </Card>

            <QuestionTypeSelector onAddQuestion={handleAddQuestion} />
          </div>

          <div className="md:w-2/3 lg:w-3/4">
            <Card>
              <CardHeader className="flex flex-row justify-between items-center">
                <div>
                    <CardTitle>Estrutura do formulário</CardTitle>
                    <CardDescription>Arraste e solte para reordenar as perguntas.</CardDescription>
                </div>
                <Button variant="outline" size="icon" onClick={() => router.push(`/dashboard/forms/${params.id}/view`)}>
                    <Eye />
                </Button>
              </CardHeader>
              <CardContent>
                  <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCenter}>
                      <SortableContext items={fields} strategy={verticalListSortingStrategy}>
                          <div className="space-y-4">
                            {mainQuestions.map((question) => (
                                <div key={question.id}>
                                  <SortableQuestionItem
                                    id={question.id}
                                    question={question}
                                    allQuestions={watchedQuestions}
                                    onQuestionChange={handleQuestionChange}
                                    onDuplicate={handleDuplicateQuestion}
                                    onDelete={onDeleteQuestion}
                                    onCreateSubQuestion={handleCreateSubQuestion}
                                    onDeleteSubQuestion={handleDeleteSubQuestion}
                                    users={users}
                                    profiles={profiles}
                                  />
                                   <SubQuestionDisplay
                                        question={question}
                                        allQuestions={watchedQuestions}
                                        onQuestionChange={handleQuestionChange}
                                        onDuplicate={handleDuplicateQuestion}
                                        onDelete={onDeleteQuestion}
                                        onCreateSubQuestion={handleCreateSubQuestion}
                                        onDeleteSubQuestion={handleDeleteSubQuestion}
                                        users={users}
                                        profiles={profiles}
                                    />
                                </div>
                            ))}
                          </div>
                      </SortableContext>
                  </DndContext>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>

      {questionToDelete && (
        <DeleteConfirmationDialog
          open={!!questionToDelete}
          onOpenChange={() => setQuestionToDelete(null)}
          onConfirm={() => {
            onDeleteQuestion(questionToDelete);
            setQuestionToDelete(null);
          }}
          itemName={`a pergunta "${questionToDelete.label}"`}
          description="Esta ação não pode ser desfeita. Todos os dados associados a esta pergunta, incluindo sub-perguntas, serão perdidos."
        />
      )}
    </FormProvider>
  );
}
