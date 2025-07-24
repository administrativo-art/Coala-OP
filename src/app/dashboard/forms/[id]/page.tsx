
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
        <div ref={setNodeRef} style={style} className={cn("border p-2 rounded-lg flex justify-between items-center bg-background", selectedQuestionId === id && "ring-2 ring-primary")}>
            <div className="flex items-center gap-2 flex-grow">
                 <button {...listeners} {...attributes} className="cursor-grab p-1">
                    <GripVertical className="h-5 w-5 text-muted-foreground" />
                </button>
                <button className="flex-1 text-left" onClick={onSelect}>
                    <p className="font-medium">{question.label}</p>
                    <p className="text-xs text-muted-foreground">{question.type}</p>
                </button>
            </div>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4"/>
            </Button>
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
    const { users } = useAuth();
    const { profiles } = useProfiles();
    const [activeTab, setActiveTab] = useState("builder");
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
                  sections: [], // Adicionado para consistência
              };
            setInternalTemplate(initialTemplate);
        } else {
            const templateToEdit = templates.find(t => t.id === templateId);
            if(templateToEdit) {
                 setInternalTemplate(JSON.parse(JSON.stringify(templateToEdit)));
            } else {
                // Handle not found case, maybe redirect
                // router.push('/dashboard/forms');
            }
        }
    }, [templateId, templates, loading, router]);
    
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
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        let newQuestions = (internalTemplate.questions || []).filter(q => q.id !== questionId)
        .map(q => {
            if (!q.ramifications) return q;
            const cleanedRamifications = q.ramifications.filter(r => r.targetQuestionId !== questionId);
            return { ...q, ramifications: cleanedRamifications };
        });

        // Re-order remaining questions
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
    
    const selectedQuestion = useMemo(() => {
        if (!selectedQuestionId || !internalTemplate) return null;
        return internalTemplate.questions?.find(q => q.id === selectedQuestionId) || null;
    }, [selectedQuestionId, internalTemplate]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            setInternalTemplate(prev => {
                if (!prev || !prev.questions) return prev;
                const oldIndex = sortedQuestions.findIndex(q => q.id === active.id);
                const newIndex = sortedQuestions.findIndex(q => q.id === over!.id);
                const reorderedQuestions = arrayMove(prev.questions, oldIndex, newIndex);
                const finalQuestions = reorderedQuestions.map((q, index) => ({...q, order: index}));
                return {...prev, questions: finalQuestions };
            });
        }
    };

    if (loading || !internalTemplate) {
        return (
             <div className="p-6">
                <Skeleton className="h-8 w-48 mb-6" />
                <Skeleton className="h-[60vh] w-full" />
             </div>
        )
    }

    return (
        <div className="w-full h-full flex flex-col p-6 gap-4">
             <header className="flex items-center justify-between">
                <div>
                    <Button variant="outline" asChild>
                        <Link href="/dashboard/forms">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Voltar para formulários
                        </Link>
                    </Button>
                    <h1 className="text-2xl font-bold mt-4">{internalTemplate.name}</h1>
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
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
                <div className="pb-4 border-b">
                    <TabsList>
                        <TabsTrigger value="builder">Editor de Perguntas</TabsTrigger>
                        <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/> Configurações Gerais</TabsTrigger>
                    </TabsList>
                </div>
                <TabsContent value="builder" className="flex-1 min-h-0 pt-4">
                    <div className="flex-1 min-h-0 flex h-full">
                        <div className="flex-1 pr-4 space-y-2">
                            <Button onClick={handleAddQuestion} className="w-full">
                                <PlusCircle className="mr-2"/> Adicionar Pergunta
                            </Button>
                            <ScrollArea className="h-[calc(100vh-20rem)]">
                                <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                    <SortableContext items={sortedQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                                        <div className="space-y-2 pr-4">
                                        {sortedQuestions.map(q => (
                                            <SortableQuestionItem
                                                key={q.id}
                                                id={q.id}
                                                question={q}
                                                onSelect={() => setSelectedQuestionId(q.id)}
                                                onDelete={() => handleDeleteQuestion(q.id)}
                                                selectedQuestionId={selectedQuestionId}
                                            />
                                        ))}
                                        </div>
                                    </SortableContext>
                                </DndContext>
                            </ScrollArea>
                        </div>
                        {selectedQuestion && (
                            <QuestionSettingsPanel
                                key={selectedQuestion.id}
                                question={selectedQuestion}
                                allQuestions={internalTemplate?.questions || []}
                                onChange={handleQuestionChange}
                                onClose={() => setSelectedQuestionId(null)}
                                users={users}
                                profiles={profiles}
                            />
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="settings" className="flex-1 overflow-auto p-6">
                    {internalTemplate && (
                        <FormGeneralSettings 
                            template={internalTemplate} 
                            onTemplateChange={(updates) => handleTemplateChange(updates)}
                        />
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

