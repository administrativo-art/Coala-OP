
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
import { FormGeneralSettings } from '@/components/form-general-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from '@/hooks/use-toast';
import { useForm as useFormHook } from '@/hooks/use-form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QuestionSettingsPanel } from '@/components/QuestionSettingsPanel';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';


const SortableQuestionItem = ({ id, question, onSelect, onDelete, selectedQuestionId }: { id: string, question: FormQuestion, onSelect: () => void, onDelete: () => void, selectedQuestionId: string | null }) => {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };

    return (
        <div 
            onClick={onSelect}
            className={cn("p-4 rounded-lg bg-card border cursor-pointer", selectedQuestionId === id && "ring-2 ring-primary border-primary")}
        >
             <div className="flex justify-between items-start">
                <div className="flex-1">
                    <p className="font-medium">{question.label}</p>
                    <p className="text-xs text-muted-foreground">{question.type}</p>
                </div>
                 <div className="flex items-center gap-1">
                    <Button {...listeners} {...attributes} variant="ghost" size="icon" className="cursor-grab h-8 w-8">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive h-8 w-8" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                        <Trash2 className="h-4 w-4"/>
                    </Button>
                 </div>
            </div>
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
    const [view, setView] = useState<'builder' | 'settings'>('builder');

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
                    setSelectedQuestionId(newTemplate.questions[0].id);
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
        const newQuestions = (internalTemplate.questions || []).map(q => q.id === updatedQuestion.id ? updatedQuestion : q);
        handleTemplateChange({ questions: newQuestions });
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
        setView('builder');
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
            const newSelectedId = newQuestions.length > 0 ? newQuestions[Math.max(0, newQuestions.findIndex(q => q.order >= (sortedQuestions.find(sq => sq.id === questionId)?.order || 0)) -1)].id : null;
            setSelectedQuestionId(newSelectedId);
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
    
    const selectedQuestion = useMemo(() => {
        if (!selectedQuestionId || !internalTemplate) return null;
        return internalTemplate.questions?.find(q => q.id === selectedQuestionId) || null;
    }, [selectedQuestionId, internalTemplate]);

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

    const renderRightPanel = () => {
        if (view === 'settings') {
            return (
                 <div className="w-[500px] bg-card border-l flex flex-col h-full shrink-0">
                    <div className="p-4 border-b">
                        <h3 className="font-semibold">Configurações Gerais</h3>
                    </div>
                    <ScrollArea className="flex-1">
                        <div className="p-4">
                            <FormGeneralSettings 
                                template={internalTemplate} 
                                onTemplateChange={(updates) => handleTemplateChange(updates)}
                            />
                        </div>
                    </ScrollArea>
                    <div className="mt-auto p-4 border-t">
                        <Button variant="outline" className="w-full" onClick={() => setView('builder')}>
                            Voltar para o editor
                        </Button>
                    </div>
                </div>
            );
        }

        if (selectedQuestion) {
            return (
                <QuestionSettingsPanel
                    key={selectedQuestion.id}
                    question={selectedQuestion}
                    allQuestions={internalTemplate?.questions || []}
                    onChange={handleQuestionChange}
                    onClose={() => setSelectedQuestionId(null)}
                    users={users}
                    profiles={profiles}
                />
            );
        }

        return (
            <div className="w-[500px] bg-card border-l flex flex-col h-full shrink-0">
                <div className="p-4 border-b">
                    <h3 className="font-semibold">Perguntas</h3>
                </div>
                <div className="p-4 space-y-2">
                    <Button variant="outline" className="w-full justify-start" onClick={handleAddQuestion}>
                        <PlusCircle className="mr-2 h-4 w-4"/> Adicionar Pergunta
                    </Button>
                </div>
                 <div className="mt-auto p-4 border-t">
                    <Button variant="ghost" className="w-full justify-start" onClick={() => setView('settings')}>
                        <Settings className="mr-2 h-4 w-4"/> Configurações Gerais
                    </Button>
                </div>
            </div>
        );
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
                    <h1 className="text-xl font-bold mt-2 truncate">{internalTemplate.name}</h1>
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
            
             <main className="flex-1 min-h-0 flex">
                <ScrollArea className="flex-1 bg-muted/40 p-6">
                    <div className="max-w-2xl mx-auto">
                        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={sortedQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                                <div className="space-y-4">
                                {sortedQuestions.map(q => (
                                    <SortableQuestionItem
                                        key={q.id}
                                        id={q.id}
                                        question={q}
                                        onSelect={() => { setSelectedQuestionId(q.id); setView('builder'); }}
                                        onDelete={() => handleDeleteQuestion(q.id)}
                                        selectedQuestionId={selectedQuestionId}
                                    />
                                ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    </div>
                </ScrollArea>
                {renderRightPanel()}
            </main>
        </div>
    );
}
