
"use client";

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { Settings, PlusCircle, Trash2, Save, FileUp, GripVertical, ArrowLeft, Eye, Text, Hash, ToggleRight, CheckSquare, List, FileText as FileIcon, ChevronsLeft, ChevronsRight, Star, MoveHorizontal } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { useToast } from '@/hooks/use-toast';
import { useForm as useFormHook } from '@/hooks/use-form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { QuestionSettingsPanel } from '@/components/QuestionSettingsPanel';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragOverEvent, type DragEndEvent, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { FormBuilderSidebar } from '@/components/form-builder-sidebar';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { FormGeneralSettings } from '@/components/form-general-settings';
import { useDebounce } from 'use-debounce';
import { FillFormModal } from '@/components/fill-form-modal';
import { DraggableQuestionType } from '@/components/form-builder-dnd';
import { FormQuestionNav } from '@/components/form-question-nav';
import { Input } from '@/components/ui/input';


const questionTypeLabels: Record<FormQuestion['type'], string> = {
    'text': 'Texto',
    'number': 'Número',
    'range': 'Intervalo',
    'rating': 'Avaliação',
    'yes-no': 'Sim/Não',
    'single-choice': 'Escolha Única',
    'multiple-choice': 'Múltipla Escolha',
    'file-attachment': 'Anexo de Arquivo',
};

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


const SortableQuestionItem = ({
    question,
    allQuestions,
    onDelete,
    onQuestionChange,
    users,
    profiles,
    isDragging,
    isHighlighted,
    index
}: {
    question: FormQuestion,
    allQuestions: FormQuestion[],
    onDelete: () => void,
    onQuestionChange: (updatedQuestion: FormQuestion) => void;
    users: any[];
    profiles: any[];
    isDragging?: boolean;
    isHighlighted?: boolean;
    index: number;
}) => {
    const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: question.id, data: { type: 'question', question } });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            id={`question-card-${question.id}`}
            ref={setNodeRef}
            style={style}
            className={cn(
                "bg-card border rounded-lg overflow-hidden",
                isDragging && 'opacity-50',
                isOver && 'shadow-lg',
                isHighlighted && 'animate-pulse-once'
            )}
            key={`${question.id}-${isHighlighted}`}
        >
            <Accordion type="single" collapsible>
                <AccordionItem value={question.id} className="border-b-0">
                    <div className="flex items-center p-2 pr-3">
                        <Button {...listeners} {...attributes} variant="ghost" size="icon" className="cursor-grab h-10 w-10">
                            <GripVertical className="h-5 w-5 text-muted-foreground" />
                        </Button>
                        <AccordionTrigger className="p-2 text-left flex-1 hover:no-underline">
                             <div className="flex-1 flex items-center gap-3">
                                <span className="font-bold text-lg">{index + 1}.</span>
                                <div className="flex-1">
                                    <p className="font-semibold">{question.label}</p>
                                    <p className="text-xs text-muted-foreground uppercase">{questionTypeLabels[question.type] || question.type}</p>
                                </div>
                            </div>
                        </AccordionTrigger>
                        <Button variant="ghost" size="icon" className="text-destructive h-10 w-10" onClick={(e) => { e.stopPropagation(); onDelete();}}>
                            <Trash2 className="h-4 w-4"/>
                        </Button>
                    </div>
                    <AccordionContent className="px-4 pb-4">
                        <QuestionSettingsPanel
                            key={question.id}
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

const DroppableArea = ({ children, id, isOver }: { children?: React.ReactNode, id: string, isOver?: boolean }) => {
    const { setNodeRef } = useDroppable({ id, data: { type: 'section' } });
    
    return (
        <div ref={setNodeRef} className={cn("p-4 space-y-4 rounded-lg", isOver && "bg-primary/10")}>
            {children}
        </div>
    );
};

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

    // DND state
    const [activeId, setActiveId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    const sensors = useSensors(useSensor(PointerSensor));
    
    // Navigation state
    const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
    const [highlightedQuestionId, setHighlightedQuestionId] = useState<string | null>(null);
    const mainContentRef = useRef<HTMLDivElement>(null);
    const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);


    const activeQuestion = useMemo(() => {
        if (!activeId || !String(activeId).startsWith('question-')) return null;
        return internalTemplate?.questions?.find(q => q.id === activeId);
    }, [activeId, internalTemplate?.questions]);

    const activeType = useMemo(() => {
        if (!activeId || !String(activeId).startsWith('new-question-')) return null;
        return String(activeId).replace('new-question-', '') as FormQuestion['type'];
    }, [activeId]);
    
    useEffect(() => {
        if(loading) return;

        if (templateId === 'new') {
             const initialSection: FormSection = { id: `section-${nanoid()}`, name: 'Seção 1', order: 0, questions: [] };
             const initialTemplate = {
                  name: 'Novo Formulário',
                  type: 'standard' as const,
                  layout: 'continuous' as const,
                  moment: null,
                  submissionTitleFormat: '',
                  questions: [],
                  sections: [initialSection],
              };
            setInternalTemplate(initialTemplate);
        } else {
            const templateToEdit = templates.find(t => t.id === templateId);
            if(templateToEdit) {
                 const newTemplate = JSON.parse(JSON.stringify(templateToEdit));
                 if (!newTemplate.sections || newTemplate.sections.length === 0) {
                     newTemplate.sections = [{ id: `section-${nanoid()}`, name: 'Seção 1', order: 0, questions: [] }];
                     // Assign all existing questions to the new section
                     newTemplate.questions.forEach((q: FormQuestion) => {
                         q.sectionId = newTemplate.sections[0].id;
                     });
                 }
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
    
    const sortedSections = useMemo(() => {
        if (!internalTemplate?.sections) return [];
        return [...internalTemplate.sections].sort((a,b) => a.order - b.order);
    }, [internalTemplate]);
    
    const questionsBySection = useMemo(() => {
        const result: Record<string, FormQuestion[]> = {};
        if (!internalTemplate || !internalTemplate.questions || !internalTemplate.sections) return result;
    
        sortedSections.forEach(section => {
            result[section.id] = [];
        });

        internalTemplate.questions.forEach(q => {
            const sectionId = q.sectionId && result.hasOwnProperty(q.sectionId)
                ? q.sectionId
                : sortedSections[0]?.id;

            if (sectionId && result[sectionId]) {
                result[sectionId].push({ ...q, sectionId });
            }
        });
    
        Object.keys(result).forEach(sectionId => {
            result[sectionId].sort((a, b) => a.order - b.order);
        });
    
        return result;
    }, [internalTemplate, sortedSections]);

    const scrollToQuestion = (questionId: string) => {
        setSelectedQuestionId(questionId);
        setHighlightedQuestionId(questionId);
        const element = document.getElementById(`question-card-${questionId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setTimeout(() => setHighlightedQuestionId(null), 1500);
    };

    const handleTemplateChange = (updates: Partial<FormTemplate>) => {
        if (!internalTemplate) return;
        setInternalTemplate(prev => ({ ...prev!, ...updates }));
    };
    
    const handleAddSection = () => {
        if (!internalTemplate) return;
        const currentSections = internalTemplate.sections || [];
        const newSection: FormSection = {
            id: `section-${nanoid()}`,
            name: `Seção ${currentSections.length + 1}`,
            order: currentSections.length,
            questions: []
        };
        const newSections = [...currentSections, newSection];
        handleTemplateChange({ sections: newSections });
    };

    const handleSectionChange = (sectionId: string, newName: string) => {
         if (!internalTemplate) return;
        const newSections = internalTemplate.sections.map(s => s.id === sectionId ? { ...s, name: newName } : s);
        handleTemplateChange({ sections: newSections });
    };

    const handleDeleteSection = (sectionId: string) => {
        if (!internalTemplate || internalTemplate.sections.length <= 1) {
            toast({ variant: 'destructive', title: 'Não é possível remover a única seção.' });
            return;
        }

        const questionsInSection = questionsBySection[sectionId] || [];
        const newSections = internalTemplate.sections.filter(s => s.id !== sectionId);
        const newQuestions = internalTemplate.questions.filter(q => q.sectionId !== sectionId);
        
        if (questionsInSection.length > 0 && newSections.length > 0) {
            const targetSectionId = newSections[0].id;
            const movedQuestions = questionsInSection.map(q => ({ ...q, sectionId: targetSectionId }));
            newQuestions.push(...movedQuestions);
        }

        handleTemplateChange({ sections: newSections.map((s,i) => ({ ...s, order: i })), questions: newQuestions });
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
                order: (internalTemplate.questions || []).length,
                sectionId: updatedQuestion.sectionId,
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

    const handleAddQuestion = (type: FormQuestion['type'], sectionId: string, atIndex: number) => {
        if (!internalTemplate) return;
        
        const newQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: "Nova Pergunta",
            type: type,
            isRequired: false,
            order: atIndex,
            sectionId: sectionId
        };
        
        let newQuestions = [...(internalTemplate.questions || [])];
        
        const allQuestionsInSection = questionsBySection[sectionId] || [];
        if(atIndex >= 0 && atIndex < allQuestionsInSection.length) {
            const questionToInsertBefore = allQuestionsInSection[atIndex];
            const globalIndex = newQuestions.findIndex(q => q.id === questionToInsertBefore.id);
            newQuestions.splice(globalIndex, 0, newQuestion);
        } else {
            newQuestions.push(newQuestion);
        }

        handleTemplateChange({ questions: newQuestions });
        
        setTimeout(() => scrollToQuestion(newQuestion.id), 100);
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        let newQuestions = (internalTemplate.questions || []).filter(q => q.id !== questionId)
        .map(q => {
            if (!q.ramifications) return q;
            const cleanedRamifications = q.ramifications.filter(r => r.targetQuestionId !== questionId);
            return { ...q, ramifications: cleanedRamifications };
        });

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

    const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
    
    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;
        setOverId(over ? String(over.id) : null);
    };
    
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
    
        if (!over || !internalTemplate) {
            setActiveId(null);
            setOverId(null);
            return;
        }
    
        const isNewQuestionDrag = String(active.id).startsWith('new-question-');
    
        if (isNewQuestionDrag) {
            const questionType = String(active.id).replace('new-question-', '') as FormQuestion['type'];
            
            let targetSectionId: string;
            let targetIndex: number;
    
            if (over.data?.current?.type === 'section') {
                targetSectionId = String(over.id);
                targetIndex = questionsBySection[targetSectionId]?.length || 0;
            } else if (over.data?.current?.type === 'question') {
                const overQuestion = over.data.current.question as FormQuestion;
                targetSectionId = overQuestion.sectionId!;
                targetIndex = overQuestion.order;
            } else {
                 targetSectionId = sortedSections[0].id;
                 targetIndex = 0;
            }
            
            if (targetSectionId !== undefined) {
                handleAddQuestion(questionType, targetSectionId, targetIndex);
            }
        } else if (active.id !== over.id) {
            const questions = internalTemplate.questions || [];
            const oldIndex = questions.findIndex((q) => q.id === active.id);
            let newIndex = questions.findIndex((q) => q.id === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                let movedQuestions = arrayMove(questions, oldIndex, newIndex);
                
                const overQuestion = questions.find(q => q.id === over.id);
                if (overQuestion) {
                    movedQuestions[newIndex].sectionId = overQuestion.sectionId;
                }
                
                handleTemplateChange({ questions: movedQuestions });
            }
        }
    
        setActiveId(null);
        setOverId(null);
    };

    useEffect(() => {
        if (!internalTemplate || !internalTemplate.sections || !internalTemplate.questions) return;
    
        const finalQuestions: FormQuestion[] = [];
    
        sortedSections.forEach(section => {
            const sectionQuestions = (internalTemplate.questions || [])
                .filter(q => q.sectionId === section.id)
                .sort((a, b) => a.order - b.order)
                .map((q, index) => ({ ...q, order: index })); // Re-order within section
            
            finalQuestions.push(...sectionQuestions);
        });
    
        // Ensure all questions are accounted for, assigning orphans to the first section
        const accountedForIds = new Set(finalQuestions.map(q => q.id));
        const orphanQuestions = (internalTemplate.questions || [])
            .filter(q => !accountedForIds.has(q.id))
            .map(q => ({ ...q, sectionId: sortedSections[0].id }));
            
        finalQuestions.push(...orphanQuestions);
    
        // Final re-sorting and re-ordering pass
        const reorderedFinal: FormQuestion[] = [];
        sortedSections.forEach(section => {
            const sectionQuestions = finalQuestions
                .filter(q => q.sectionId === section.id)
                .sort((a,b) => a.order - b.order) // This might be redundant but safe
                .map((q, index) => ({ ...q, order: index }));
            
            reorderedFinal.push(...sectionQuestions);
        });
    
        if (JSON.stringify(reorderedFinal) !== JSON.stringify(internalTemplate.questions)) {
            setInternalTemplate(prev => ({ ...prev!, questions: reorderedFinal }));
        }
    
    }, [internalTemplate?.questions, sortedSections]);


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
    
    let globalQuestionIndex = 0;

    return (
       <DndContext sensors={sensors} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
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
                
                <main className={cn("flex-1 min-h-0 bg-muted/40 p-6 grid gap-6 transition-all", isSummaryCollapsed ? "grid-cols-[120px_1fr_350px]" : "grid-cols-[280px_1fr_350px]")}>
                    <FormQuestionNav
                        sections={sortedSections}
                        questionsBySection={questionsBySection}
                        selectedQuestionId={selectedQuestionId}
                        onQuestionSelect={scrollToQuestion}
                        isCollapsed={isSummaryCollapsed}
                        setIsCollapsed={setIsSummaryCollapsed}
                        questionIcons={questionIcons}
                    />

                    <div ref={mainContentRef} className="space-y-4 h-[calc(100vh-10rem)] overflow-y-auto pr-2">
                        {sortedSections.map(section => {
                             const sectionQuestions = questionsBySection[section.id] || [];
                             const sectionStartIndex = globalQuestionIndex;
                             globalQuestionIndex += sectionQuestions.length;
                            return (
                                <Accordion type="single" collapsible key={section.id} defaultValue="item-1" className="border-b-0">
                                    <AccordionItem value="item-1" className="bg-card rounded-lg border">
                                        <div className="flex items-center pr-4">
                                            <AccordionTrigger className="p-4 text-lg font-semibold hover:no-underline rounded-lg [&[data-state=open]]:rounded-b-none flex-grow">
                                                <div className="flex-1 flex items-center gap-2">
                                                    <Input value={section.name} onChange={e => handleSectionChange(section.id, e.target.value)} className="text-lg font-semibold border-none focus-visible:ring-1"/>
                                                </div>
                                            </AccordionTrigger>
                                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteSection(section.id); }} className="text-destructive h-9 w-9">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <AccordionContent className="border-t">
                                            <DroppableArea id={section.id} isOver={overId === section.id}>
                                                <SortableContext items={sectionQuestions.map(q => q.id)}>
                                                    {sectionQuestions.map((q, index) => (
                                                        <SortableQuestionItem
                                                            key={q.id}
                                                            index={sectionStartIndex + index}
                                                            question={q}
                                                            allQuestions={internalTemplate?.questions || []}
                                                            onDelete={() => handleDeleteQuestion(q.id)}
                                                            onQuestionChange={handleQuestionChange}
                                                            users={users}
                                                            profiles={profiles}
                                                            isDragging={activeId === q.id}
                                                            isHighlighted={highlightedQuestionId === q.id}
                                                        />
                                                    ))}
                                                </SortableContext>
                                                 {sectionQuestions.length === 0 && (
                                                    <div className="text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground">
                                                        Arraste um campo aqui
                                                    </div>
                                                 )}
                                            </DroppableArea>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            )})}
                        <Button variant="outline" onClick={handleAddSection} className="w-full">
                            <PlusCircle className="mr-2" /> Adicionar Seção
                        </Button>
                    </div>

                    <aside className="h-full">
                        <FormBuilderSidebar />
                    </aside>
                </main>

                 <DragOverlay>
                    {activeQuestion && <SortableQuestionItem question={activeQuestion} allQuestions={[]} users={[]} profiles={[]} onDelete={() => {}} onQuestionChange={() => {}} index={0} />}
                    {activeType && <DraggableQuestionType type={activeType} isOverlay />}
                </DragOverlay>

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
        </DndContext>
    );
}
