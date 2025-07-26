
"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
import { DraggableQuestionType, Placeholder, QuestionDropzone } from '@/components/form-builder-dnd';
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
    allSections,
    onDelete,
    onQuestionChange,
    onCreateSubQuestion,
    users,
    profiles,
    isDragging,
    isHighlighted,
    index,
    overId,
}: {
    question: FormQuestion,
    allQuestions: FormQuestion[],
    allSections: FormSection[],
    onDelete: () => void,
    onQuestionChange: (updatedQuestion: FormQuestion) => void;
    onCreateSubQuestion: (parentQuestion: FormQuestion, optionId: string, type: FormQuestion['type']) => void;
    users: any[];
    profiles: any[];
    isDragging?: boolean;
    isHighlighted?: boolean;
    index: number;
    overId: string | null;
}) => {
    const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: question.id, data: { type: 'question', question } });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition: transition || 'transform 250ms ease',
    };
    
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (question.label === 'Nova Pergunta') {
            inputRef.current?.select();
        }
    }, [question.label]);

    return (
        <div
            id={`question-card-${question.id}`}
            ref={setNodeRef}
            style={style}
            className={cn(
                "bg-card border rounded-lg overflow-hidden transition-shadow",
                isDragging && 'opacity-50 z-50 shadow-2xl',
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
                                    <Input
                                        ref={inputRef}
                                        value={question.label}
                                        onChange={(e) => onQuestionChange({...question, label: e.target.value})}
                                        className="font-semibold border-none focus-visible:ring-1 bg-transparent p-1 h-auto"
                                        onClick={e => e.stopPropagation()}
                                    />
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
                            allSections={allSections}
                            onChange={onQuestionChange}
                            onCreateSubQuestion={onCreateSubQuestion}
                            users={users}
                            profiles={profiles}
                            overId={overId}
                        />
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
    );
}

// Recursive component to render questions and their sub-questions
const RecursiveQuestionRenderer = ({ 
    questions, 
    level = 0, 
    ...props 
}: { 
    questions: FormQuestion[];
    level?: number;
    sectionStartIndex: number;
    allQuestions: FormQuestion[];
    allSections: FormSection[];
    onDelete: (id: string) => void;
    onQuestionChange: (q: FormQuestion) => void;
    onCreateSubQuestion: (parent: FormQuestion, optionId: string, type: FormQuestion['type']) => void;
    users: any[];
    profiles: any[];
    activeId: string | null;
    overId: string | null;
    highlightedQuestionId: string | null;
    activeType: FormQuestion['type'] | null;
}) => {
    return (
        <div className="space-y-2">
            {questions.map((q, index) => (
                <div key={q.id} style={{ paddingLeft: `${level * 20}px`}}>
                    {props.activeType && props.overId === q.id && <Placeholder index={index} />}
                    <SortableQuestionItem
                        index={props.sectionStartIndex + index}
                        question={q}
                        allQuestions={props.allQuestions}
                        allSections={props.allSections}
                        onDelete={() => props.onDelete(q.id)}
                        onQuestionChange={props.onQuestionChange}
                        onCreateSubQuestion={props.onCreateSubQuestion}
                        users={props.users}
                        profiles={props.profiles}
                        isDragging={props.activeId === q.id}
                        isHighlighted={props.highlightedQuestionId === q.id}
                        overId={props.overId}
                    />
                    {q.subPerguntas && q.subPerguntas.length > 0 && (
                        <div className="mt-2">
                             <RecursiveQuestionRenderer 
                                questions={q.subPerguntas}
                                level={level + 1}
                                {...props}
                            />
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
};


export default function FormBuilderPage() {
    const { addTemplate, updateTemplate, templates, loading } = useFormHook();
    const router = useRouter();
    const params = useParams();
    const { id: templateId } = params;

    const [internalTemplate, setInternalTemplate] = useState<FormTemplate | null>(null);
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
        if (!activeId || !internalTemplate) return null;
        if (String(activeId).startsWith('new-question-')) return null;
        return internalTemplate.questions.find(q => q.id === activeId);
    }, [activeId, internalTemplate]);

    const activeType = useMemo(() => {
        if (!activeId || !String(activeId).startsWith('new-question-')) return null;
        return String(activeId).replace('new-question-', '') as FormQuestion['type'];
    }, [activeId]);
    
    useEffect(() => {
        if(loading) return;

        if (templateId === 'new') {
             const newTemplate = {
                  name: 'Novo Formulário',
                  type: 'standard' as const,
                  layout: 'continuous' as const,
                  moment: null,
                  submissionTitleFormat: '',
                  questions: [],
                  sections: [{ id: `section-${nanoid()}`, name: 'Seção 1', order: 0 }],
              };
            setInternalTemplate(newTemplate as any);
        } else {
            const templateToEdit = templates.find(t => t.id === templateId);
            if(templateToEdit) {
                 const newTemplate = JSON.parse(JSON.stringify(templateToEdit));
                 if (!newTemplate.sections || newTemplate.sections.length === 0) {
                     newTemplate.sections = [{ id: `section-${nanoid()}`, name: 'Seção 1', order: 0 }];
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
                const newId = await addTemplate({ ...debouncedTemplate, status: 'draft' } as Omit<FormTemplate, 'id'|'status'>);
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
        const newSection: Omit<FormSection, 'questions'> = {
            id: `section-${nanoid()}`,
            name: `Seção ${currentSections.length + 1}`,
            order: currentSections.length,
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
        let newQuestions = internalTemplate.questions.filter(q => q.sectionId !== sectionId);
        
        if (questionsInSection.length > 0 && newSections.length > 0) {
            const targetSectionId = newSections[0].id;
            const movedQuestions = questionsInSection.map(q => ({ ...q, sectionId: targetSectionId }));
            newQuestions.push(...movedQuestions);
        }

        handleTemplateChange({ sections: newSections.map((s,i) => ({ ...s, order: i })), questions: newQuestions });
    };
    
    const handleCreateSubQuestion = useCallback((parentQuestion: FormQuestion, optionId: string, type: FormQuestion['type']) => {
        setInternalTemplate(currentTemplate => {
            if (!currentTemplate) return null;

            const newSubQuestion: FormQuestion = {
                id: `question-${nanoid()}`,
                label: 'Nova Sub-pergunta',
                type: type,
                isRequired: false,
                order: 0, // This will be recalculated later if needed for display, but it's not a root question.
                sectionId: parentQuestion.sectionId,
                excluidaDoSumario: true,
            };

            const newQuestions = currentTemplate.questions.map(q => {
                if (q.id === parentQuestion.id) {
                    const updatedParent = { ...q };
                    
                    // Add to subPerguntas array
                    if (!updatedParent.subPerguntas) {
                        updatedParent.subPerguntas = [];
                    }
                    updatedParent.subPerguntas.push(newSubQuestion);
                    
                    // Add to options ramification
                    updatedParent.options = (updatedParent.options || []).map(opt => {
                        if (opt.id === optionId) {
                            return {
                                ...opt,
                                ramification: {
                                    ...(opt.ramification || { id: `ram-${nanoid()}` }),
                                    targetQuestionId: newSubQuestion.id
                                }
                            };
                        }
                        return opt;
                    });
                    
                    return updatedParent;
                }
                return q;
            });

            setTimeout(() => scrollToQuestion(newSubQuestion.id), 100);
            return { ...currentTemplate, questions: newQuestions };
        });
    }, []);


    const handleQuestionChange = (updatedQuestion: FormQuestion) => {
        if (!internalTemplate) return;
        const newQuestions = internalTemplate.questions.map(q => q.id === updatedQuestion.id ? updatedQuestion : q);
        handleTemplateChange({ questions: newQuestions });
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
        
        let currentQuestions = [...(internalTemplate.questions || [])];
        
        currentQuestions.splice(atIndex, 0, newQuestion);
        
        const finalQuestions = currentQuestions.map((q, index) => ({...q, order: index}));

        handleTemplateChange({ questions: finalQuestions });
        
        setTimeout(() => scrollToQuestion(newQuestion.id), 100);
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        let newQuestions = (internalTemplate.questions || []).filter(q => q.id !== questionId)
        .map(q => {
            if (!q.options) return q;
            const cleanedOptions = q.options.map(opt => {
                if (opt.ramification && opt.ramification.targetQuestionId === questionId) {
                    const { ramification, ...rest } = opt;
                    return rest;
                }
                return opt;
            });
            return { ...q, options: cleanedOptions };
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
        const overData = over.data?.current;

        if (isNewQuestionDrag) {
            const questionType = String(active.id).replace('new-question-', '') as FormQuestion['type'];

            if (overData?.type === 'sub-question-droppable') {
                 const { parentQuestionId, optionId } = overData.droppableData;
                 const parentQuestion = internalTemplate.questions.find(q => q.id === parentQuestionId);
                 if (parentQuestion) {
                     handleCreateSubQuestion(parentQuestion, optionId, questionType);
                 }
            } else if (overData?.type === 'question-dropzone') {
                const { sectionId, atIndex } = overData.dropzoneData;
                handleAddQuestion(questionType, sectionId, atIndex);
            }
        } else if (active.id !== over.id) {
             const questions = internalTemplate.questions || [];
             const oldIndex = questions.findIndex(q => q.id === active.id);
             let newIndex: number;
             let newSectionId: string;
             const overQuestionData = over.data.current?.type === 'question' ? over.data.current?.question : null;

             if (overQuestionData) {
                newIndex = questions.findIndex(q => q.id === over.id);
                newSectionId = overQuestionData.sectionId!;
             } else if (over.data.current?.type === 'question-dropzone') {
                newSectionId = over.data.current.dropzoneData.sectionId;
                const questionsInSection = questions.filter(q => q.sectionId === newSectionId);
                const lastQuestionInTarget = questionsInSection[questionsInSection.length - 1];
                newIndex = lastQuestionInTarget ? questions.findIndex(q => q.id === lastQuestionInTarget.id) + 1 : oldIndex;
             } else {
                setActiveId(null);
                setOverId(null);
                return;
             }
 
             if (oldIndex > -1 && newIndex > -1) {
                 let reorderedQuestions = arrayMove(questions, oldIndex, newIndex);
                 const movedQuestion = { ...reorderedQuestions[newIndex], sectionId: newSectionId };
                 reorderedQuestions[newIndex] = movedQuestion;
                 
                 handleTemplateChange({ questions: reorderedQuestions.map((q, i) => ({ ...q, order: i })) });
             }
        }
    
        setActiveId(null);
        setOverId(null);
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
                        allQuestions={internalTemplate.questions || []}
                    />

                    <div ref={mainContentRef} className="space-y-4 h-[calc(100vh-10rem)] overflow-y-auto pr-2">
                        {sortedSections.map(section => {
                             const sectionQuestions = questionsBySection[section.id] || [];
                             const sectionStartIndex = globalQuestionIndex;
                             globalQuestionIndex += sectionQuestions.length;
                            return (
                                <Accordion type="single" collapsible key={section.id} defaultValue="item-1" className="border-b-0">
                                    <AccordionItem value="item-1" className="bg-card rounded-lg border">
                                        {sortedSections.length > 1 && (
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
                                        )}
                                        <AccordionContent className={cn(sortedSections.length > 1 && "border-t")}>
                                            <div className="p-4 space-y-4">
                                                <SortableContext items={sectionQuestions.map(q => q.id)}>
                                                     <RecursiveQuestionRenderer 
                                                        questions={sectionQuestions} 
                                                        sectionStartIndex={sectionStartIndex}
                                                        allQuestions={internalTemplate?.questions || []}
                                                        allSections={internalTemplate?.sections || []}
                                                        onDelete={handleDeleteQuestion}
                                                        onQuestionChange={handleQuestionChange}
                                                        onCreateSubQuestion={handleCreateSubQuestion}
                                                        users={users}
                                                        profiles={profiles}
                                                        activeId={activeId}
                                                        overId={overId}
                                                        highlightedQuestionId={highlightedQuestionId}
                                                        activeType={activeType}
                                                    />
                                                </SortableContext>
                                                <QuestionDropzone sectionId={section.id} atIndex={sectionQuestions.length} overId={overId} />
                                            </div>
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
                    {activeQuestion && <SortableQuestionItem question={activeQuestion} allQuestions={[]} allSections={[]} users={[]} profiles={[]} onDelete={() => {}} onQuestionChange={() => {}} onCreateSubQuestion={() => {}} index={0} overId={null}/>}
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
