
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type FormTemplate, type FormQuestion } from '@/types';
import { Settings, PlusCircle, Trash2, Save, FileUp, GripVertical, ArrowLeft, Eye } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { useToast } from '@/hooks/use-toast';
import { useForm as useFormHook } from '@/hooks/use-form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QuestionSettingsPanel } from '@/components/QuestionSettingsPanel';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { FormBuilderSidebar } from '@/components/form-builder-sidebar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FormGeneralSettings } from '@/components/form-general-settings';
import { useDebounce } from 'use-debounce';
import { FillFormModal } from '@/components/fill-form-modal';


const SortableQuestionItem = ({
    question,
    allQuestions,
    onDelete,
    onQuestionChange,
    users,
    profiles,
}: {
    question: FormQuestion,
    allQuestions: FormQuestion[],
    onDelete: () => void,
    onQuestionChange: (updatedQuestion: FormQuestion) => void;
    users: any[];
    profiles: any[];
}) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 'auto',
    };

    return (
        <div ref={setNodeRef} style={style} className="bg-card border rounded-lg overflow-hidden">
            <Accordion type="single" collapsible>
                <AccordionItem value={question.id} className="border-b-0">
                    <div className="flex items-center p-2 pr-3">
                        <Button {...listeners} {...attributes} variant="ghost" size="icon" className="cursor-grab h-10 w-10">
                            <GripVertical className="h-5 w-5 text-muted-foreground" />
                        </Button>
                        <AccordionTrigger className="p-2 text-left flex-1 hover:no-underline">
                             <div className="flex-1">
                                <p className="font-semibold">{question.label}</p>
                                <p className="text-xs text-muted-foreground uppercase">{question.type}</p>
                            </div>
                        </AccordionTrigger>
                        <Button variant="ghost" size="icon" className="text-destructive h-10 w-10" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                            <Trash2 className="h-4 w-4"/>
                        </Button>
                    </div>
                    <AccordionContent className="px-4 pb-4">
                        <QuestionSettingsPanel
                            key={question.id} // Re-mount when question changes
                            question={question}
                            allQuestions={allQuestions}
                            onChange={onQuestionChange}
                            users={users}
                            profiles={profiles}
                        />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
}

export default function FormBuilderPage() {
    const { addTemplate, updateTemplate, templates, loading } = useFormHook();
    const router = useRouter();
    const params = useParams();
    const { id: templateId } = params;

    const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id' | 'status'> | null>(null);
    const [debouncedTemplate] = useDebounce(internalTemplate, 1500);

    const { users } = useAuth();
    const { profiles } = useProfiles();
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    
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
        } else {
            const templateToEdit = templates.find(t => t.id === templateId);
            if(templateToEdit) {
                 const newTemplate = JSON.parse(JSON.stringify(templateToEdit));
                 setInternalTemplate(newTemplate);
            }
        }
    }, [templateId, templates, loading]);

    useEffect(() => {
        const autoSave = async () => {
            if (!debouncedTemplate || !('questions' in debouncedTemplate)) return;

            setIsSaving(true);
            if ('id' in debouncedTemplate) {
                await updateTemplate({ ...debouncedTemplate, status: debouncedTemplate.status || 'draft' });
            } else {
                const newId = await addTemplate({ ...debouncedTemplate, status: 'draft' });
                if (newId) {
                    router.replace(`/dashboard/forms/${newId}`, { scroll: false });
                }
            }
            setIsSaving(false);
        };

        autoSave();
    }, [debouncedTemplate, addTemplate, updateTemplate, router]);
    
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

    const handleAddQuestion = (type: FormQuestion['type'] = 'text') => {
        if (!internalTemplate) return;
        const currentQuestions = internalTemplate.questions || [];
        const newQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: "Nova Pergunta",
            type: type,
            isRequired: false,
            order: currentQuestions.length
        };
        const newQuestions = [...currentQuestions, newQuestion];
        handleTemplateChange({ questions: newQuestions });
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
    };

    const handlePublish = async () => {
        if (!internalTemplate || !('id' in internalTemplate)) return;
        setIsSaving(true);
        try {
            await updateTemplate({ ...internalTemplate, status: 'published' } as FormTemplate);
            toast({ title: 'Formulário publicado!' });
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

    const handlePreviewSubmit = async () => {
        toast({
            title: "Envio de teste",
            description: "Este é um preview e a resposta não será salva.",
        });
        setIsPreviewOpen(false);
    };


    if (loading || !internalTemplate) {
        return (
             <div className="p-6 h-full">
                <Skeleton className="h-10 w-48 mb-6" />
                <Skeleton className="h-[calc(100vh-12rem)] w-full" />
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
                        <Settings className="h-5 w-5" />
                     </Button>
                </div>
                <div className="flex gap-2">
                     <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {isSaving ? (
                            <>
                                <Save className="h-4 w-4 animate-spin" /> Salvando...
                            </>
                        ) : (
                           <span>
                                {('id' in internalTemplate && internalTemplate.status === 'published')
                                    ? 'Publicado'
                                    : 'Salvo como rascunho'
                                }
                            </span>
                        )}
                     </div>
                    <Button variant="outline" size="icon" onClick={() => setIsPreviewOpen(true)}>
                        <Eye className="h-5 w-5" />
                        <span className="sr-only">Preview</span>
                    </Button>
                    <Button onClick={handlePublish} disabled={isSaving || !('id' in internalTemplate)}>
                        <FileUp className="mr-2 h-4 w-4" />
                        {isSaving ? 'Publicando...' : 'Publicar'}
                    </Button>
                </div>
            </header>
            
            <main className="flex-1 min-h-0 bg-muted/40 p-6 grid grid-cols-1 md:grid-cols-[1fr_350px] gap-6">
                <div className="space-y-4">
                    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={sortedQuestions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-4">
                            {sortedQuestions.map(q => (
                                <SortableQuestionItem
                                    key={q.id}
                                    question={q}
                                    allQuestions={internalTemplate?.questions || []}
                                    onDelete={() => handleDeleteQuestion(q.id)}
                                    onQuestionChange={handleQuestionChange}
                                    users={users}
                                    profiles={profiles}
                                />
                            ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                </div>
                 <aside className="h-full">
                    <FormBuilderSidebar onAddQuestion={handleAddQuestion} />
                </aside>
            </main>
             <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Configurações Gerais do Formulário</DialogTitle>
                    </DialogHeader>
                    <FormGeneralSettings template={internalTemplate} onTemplateChange={handleTemplateChange} />
                    <DialogFooter>
                        <Button onClick={() => setIsSettingsOpen(false)}>Concluir</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {isPreviewOpen && (
                <FillFormModal
                    open={isPreviewOpen}
                    onOpenChange={setIsPreviewOpen}
                    template={internalTemplate as FormTemplate}
                    addSubmission={handlePreviewSubmit as any}
                />
            )}
        </div>
    );
}

    

    