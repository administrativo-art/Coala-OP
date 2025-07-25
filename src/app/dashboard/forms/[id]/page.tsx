
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type FormTemplate, type FormQuestion } from '@/types';
import { Settings, PlusCircle, Trash2, Save, FileUp, GripVertical, ArrowLeft } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from '@/hooks/use-toast';
import { useForm as useFormHook } from '@/hooks/use-form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QuestionSettingsPanel } from '@/components/QuestionSettingsPanel';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { FormGeneralSettings } from '@/components/form-general-settings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';


const SortableQuestionItem = ({
    id,
    question,
    onDelete,
    selectedQuestionId,
    allQuestions,
    onQuestionChange,
    users,
    profiles
}: {
    id: string,
    question: FormQuestion,
    onDelete: () => void,
    selectedQuestionId: string | null,
    allQuestions: FormQuestion[],
    onQuestionChange: (updatedQuestion: FormQuestion) => void,
    users: User[],
    profiles: Profile[],
}) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };

    return (
        <div ref={setNodeRef} style={style} className="bg-card border rounded-lg overflow-hidden">
            <div className="flex items-center p-2 pr-3">
                 <Button {...listeners} {...attributes} variant="ghost" size="icon" className="cursor-grab h-10 w-10">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                </Button>
                <AccordionTrigger className="p-2 text-left hover:no-underline flex-1">
                    <div>
                        <p className="font-semibold">{question.label}</p>
                        <p className="text-xs text-muted-foreground uppercase">{question.type}</p>
                    </div>
                </AccordionTrigger>
                <Button variant="ghost" size="icon" className="text-destructive h-10 w-10" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                    <Trash2 className="h-4 w-4"/>
                </Button>
            </div>
             <AccordionContent>
                <div className="border-t">
                    <QuestionSettingsPanel
                        key={question.id}
                        question={question}
                        allQuestions={allQuestions}
                        onChange={onQuestionChange}
                        users={users}
                        profiles={profiles}
                    />
                </div>
             </AccordionContent>
        </div>
    );
}

export default function FormBuilderPage() {
    const { addTemplate, updateTemplate, templates, loading } = useFormHook();
    const router = useRouter();
    const params = useParams();
    const { id: templateId } = params;

    const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id' | 'status'> | null>(null);
    const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const { users } = useAuth();
    const { profiles } = useProfiles();
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();
    
    useEffect(() => {
        if(loading) return;

        if (templateId === 'new') {
             const initialTemplate = {
                  name: 'Novo Formulário',
                  type: 'standard',
                  layout: 'continuous',
                  moment: null,
                  submissionTitleFormat: '',
                  questions: [],
                  sections: [],
              };
            setInternalTemplate(initialTemplate);
            if (initialTemplate.questions.length > 0) {
              setSelectedQuestionId(initialTemplate.questions[0].id)
            }
        } else {
            const templateToEdit = templates.find(t => t.id === templateId);
            if(templateToEdit) {
                 const newTemplate = JSON.parse(JSON.stringify(templateToEdit));
                 setInternalTemplate(newTemplate);
                 if (newTemplate.questions.length > 0 && !selectedQuestionId) {
                     setSelectedQuestionId(newTemplate.questions[0].id)
                 }
            }
        }
    }, [templateId, templates, loading, router, selectedQuestionId]);
    
    const sortedQuestions = useMemo(() => {
        if (!internalTemplate?.questions) return [];
        return [...internalTemplate.questions].sort((a,b) => a.order - b.order);
    }, [internalTemplate]);

    const handleTemplateChange = (updates: Partial<FormTemplate>) => {
        if (!internalTemplate) return;
        setInternalTemplate(prev => ({ ...prev!, ...updates }));
    };

    const handleQuestionChange = (updatedQuestion: FormQuestion) => {
        if (!internalTemplate) return;

        const isCreatingNewQuestionFromRamification = updatedQuestion.ramifications?.some(r => r.targetQuestionId === '__CREATE_NEW__');

        if (isCreatingNewQuestionFromRamification) {
            const newQuestion: FormQuestion = {
                id: `question-${nanoid()}`,
                label: 'Nova Pergunta',
                type: 'text',
                isRequired: false,
                order: (internalTemplate.questions || []).length
            };
            
            const newQuestions = [...(internalTemplate.questions || []), newQuestion];

            const newRamifications = updatedQuestion.ramifications!.map(r => 
                r.targetQuestionId === '__CREATE_NEW__' ? { ...r, targetQuestionId: newQuestion.id } : r
            );

            const finalUpdatedQuestion = { ...updatedQuestion, ramifications: newRamifications };

            handleTemplateChange({ questions: newQuestions.map(q => q.id === finalUpdatedQuestion.id ? finalUpdatedQuestion : q) });
        } else {
            const newQuestions = (internalTemplate.questions || []).map(q => q.id === updatedQuestion.id ? updatedQuestion : q);
            handleTemplateChange({ questions: newQuestions });
        }
    };

    const handleAddQuestion = () => {
        if (!internalTemplate) return;
        const currentQuestions = internalTemplate.questions || [];
        const newQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: "Nova Pergunta",
            type: 'text',
            isRequired: false,
            order: currentQuestions.length
        };
        const newQuestions = [...currentQuestions, newQuestion];
        handleTemplateChange({ questions: newQuestions });
        setSelectedQuestionId(newQuestion.id);
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        let newQuestions = (internalTemplate.questions || []).filter(q => q.id !== questionId)
        .map(q => {
            if (!q.ramifications) return q;
            const cleanedRamifications = q.ramifications.filter(r => r.targetQuestionId !== questionId);
            return { ...q, ramifications: cleanedRamifications };
        });

        newQuestions = newQuestions.sort((a,b) => a.order - b.order).map((q, index) => ({...q, order: index}));
        handleTemplateChange({ questions: newQuestions });
        
        if (selectedQuestionId === questionId) {
            setSelectedQuestionId(null);
        }
    };

    const handleSave = async (publish: boolean) => {
        if (!internalTemplate) return;
        setIsSaving(true);
        const status = publish ? 'published' : 'draft';

        try {
            if ('id' in internalTemplate && internalTemplate.id) {
                await updateTemplate({ ...internalTemplate, status } as FormTemplate);
            } else {
                const newId = await addTemplate({ ...internalTemplate, status });
                if (newId) {
                    router.replace(`/dashboard/forms/${newId}`);
                }
            }
            toast({ title: publish ? 'Formulário publicado!' : 'Rascunho salvo!' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setInternalTemplate(prev => {
                if (!prev || !prev.questions) return prev;
                const oldIndex = prev.questions.findIndex(q => q.id === active.id);
                const newIndex = prev.questions.findIndex(q => q.id === over.id);
                if (oldIndex === -1 || newIndex === -1) return prev;
                
                const reorderedQuestions = arrayMove(prev.questions, oldIndex, newIndex);
                const finalQuestions = reorderedQuestions.map((q, index) => ({...q, order: index}));
                return {...prev, questions: finalQuestions };
            });
        }
    };

    if (loading || !internalTemplate) {
        return (
             <div className="p-6 h-full">
                <Skeleton className="h-10 w-48 mb-6" />
                <div className="flex h-[calc(100vh-12rem)] gap-4">
                    <Skeleton className="flex-1" />
                    <Skeleton className="w-[350px]" />
                </div>
             </div>
        )
    }

    return (
        <div className="w-full h-full flex flex-col">
             <header className="flex items-center justify-between p-4 border-b bg-card">
                <div>
                    <Button variant="outline" asChild>
                        <Link href="/dashboard/forms">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Voltar
                        </Link>
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                     <h1 className="text-xl font-bold truncate">{internalTemplate.name}</h1>
                     <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)}>
                         <Settings className="h-5 w-5 text-muted-foreground"/>
                     </Button>
                </div>
                <div className="flex gap-2">
                     <Button onClick={() => handleSave(false)} variant="secondary" disabled={isSaving}>
                        <Save className="mr-2 h-4 w-4"/>
                        {isSaving ? 'Salvando...' : 'Salvar Rascunho'}
                    </Button>
                    <Button onClick={() => handleSave(true)} disabled={isSaving}>
                        <FileUp className="mr-2 h-4 w-4" />
                        {isSaving ? 'Publicando...' : 'Publicar'}
                    </Button>
                </div>
            </header>
            
             <main className="flex-1 min-h-0 bg-muted/40 p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    <Accordion type="single" collapsible value={selectedQuestionId ?? undefined} onValueChange={setSelectedQuestionId}>
                        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={sortedQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                                <div className="space-y-4">
                                {sortedQuestions.map(q => (
                                    <AccordionItem value={q.id} key={q.id} className="border-none bg-transparent">
                                        <SortableQuestionItem
                                            id={q.id}
                                            question={q}
                                            onDelete={() => handleDeleteQuestion(q.id)}
                                            selectedQuestionId={selectedQuestionId}
                                            allQuestions={internalTemplate.questions || []}
                                            onQuestionChange={handleQuestionChange}
                                            users={users}
                                            profiles={profiles}
                                        />
                                    </AccordionItem>
                                ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </Accordion>

                    <Button variant="outline" className="w-full" onClick={handleAddQuestion}>
                        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Pergunta
                    </Button>
                </div>
            </main>
            
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Configurações Gerais</DialogTitle>
                        <DialogDescription>Defina o nome e o comportamento do formulário.</DialogDescription>
                    </DialogHeader>
                    <FormGeneralSettings
                        template={internalTemplate}
                        onTemplateChange={handleTemplateChange}
                    />
                    <DialogFooter>
                        <Button onClick={() => setIsSettingsOpen(false)}>Concluir</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}

    

    