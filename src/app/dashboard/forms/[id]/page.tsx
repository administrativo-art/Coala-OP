
"use client";

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { Settings, PlusCircle, Trash2, Save, FileUp, GripVertical, ArrowLeft, Eye, Text, Hash, ToggleRight, CheckSquare, List, FileText as FileIcon, ChevronsLeft, ChevronsRight, Star, MoveHorizontal, GitBranch, Copy } from 'lucide-react';
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

const SubQuestionDisplay = React.memo(({
    parentQuestionId,
    subQuestionId,
    ...props
}: {
    parentQuestionId: string,
    subQuestionId: string,
    allQuestions: FormQuestion[],
    allSections: FormSection[],
    onQuestionChange: (updatedQuestion: FormQuestion) => void;
    onCreateSubQuestion: (parentQuestionId: string, optionId: string, type: FormQuestion['type']) => void;
    onDeleteSubQuestion: (parentQuestionId: string, subQuestionId: string) => void;
    onDuplicate: () => void;
    users: any[];
    profiles: any[];
    index: number;
    globalIndex: number;
    level?: number;
}) => {
    const question = useMemo(() => props.allQuestions.find((q: FormQuestion) => q.id === subQuestionId), [subQuestionId, props.allQuestions]);

    if (!question) {
        return null;
    }

    const subQuestions = useMemo(() => {
        if (!question.options) return [];
        const subQuestionMap = new Map(props.allQuestions.map(q => [q.id, q]));
        return question.options
            .map(opt => opt.ramification?.targetQuestionId ? subQuestionMap.get(opt.ramification.targetQuestionId) : null)
            .filter((q): q is FormQuestion => !!q);
    }, [question.options, props.allQuestions]);
    
    return (
        <div className="relative">
            {props.level > 0 && <div className="absolute -left-5 top-0 bottom-0 w-px bg-border"></div>}
            {props.level > 0 && <div className="absolute -left-5 top-7 h-px w-5 bg-border"></div>}
            <div id={`question-card-${question.id}`} className={cn("bg-card border rounded-lg overflow-hidden transition-shadow relative", props.level > 0 && "ml-10")}>
                <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value={question.id} className="border-b-0">
                        <div className="flex items-center p-2 pr-3">
                             <Button variant="ghost" size="icon" className="h-10 w-10">
                                <GitBranch className="h-5 w-5 text-muted-foreground" />
                            </Button>
                            <AccordionTrigger className="p-2 text-left flex-1 hover:no-underline">
                                <div className="flex-1 flex items-center gap-3">
                                    <span className="font-bold text-lg">{props.globalIndex + 1}.{props.index + 1}</span>
                                    <div className="flex-1">
                                        <Input
                                            value={question.label}
                                            onChange={(e) => props.onQuestionChange({ ...question, label: e.target.value })}
                                            className="font-semibold border-none focus-visible:ring-1 bg-transparent p-1 h-auto"
                                            onClick={e => e.stopPropagation()}
                                        />
                                        <p className="text-xs text-muted-foreground uppercase">{questionTypeLabels[question.type] || question.type}</p>
                                    </div>
                                </div>
                            </AccordionTrigger>
                        </div>
                        <AccordionContent className="px-4 pb-4">
                            <QuestionSettingsPanel
                                question={question}
                                allQuestions={props.allQuestions}
                                allSections={props.allSections}
                                onChange={props.onQuestionChange}
                                onCreateSubQuestion={props.onCreateSubQuestion}
                                onDeleteSubQuestion={props.onDeleteSubQuestion}
                                users={props.users}
                                profiles={props.profiles}
                            />
                            <div className="border-t mt-4 pt-4 flex justify-end gap-2">
                                <Button variant="outline" onClick={props.onDuplicate}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Duplicar
                                </Button>
                                <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => props.onDeleteSubQuestion(parentQuestionId, subQuestionId)}>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Excluir Sub-pergunta
                                </Button>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
             {subQuestions.length > 0 && (
                <div className="pt-4 space-y-4">
                    {subQuestions.map((subQ, subIndex) => (
                         <SubQuestionDisplay
                            key={subQ.id}
                            parentQuestionId={question.id}
                            subQuestionId={subQ.id}
                            allQuestions={props.allQuestions}
                            allSections={props.allSections}
                            onQuestionChange={props.onQuestionChange}
                            onDeleteSubQuestion={props.onDeleteSubQuestion}
                            onCreateSubQuestion={props.onCreateSubQuestion}
                            onDuplicate={() => { /* Not implemented yet */ }}
                            users={props.users}
                            profiles={props.profiles}
                            index={subIndex}
                            level={props.level + 1}
                            globalIndex={props.globalIndex}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});
SubQuestionDisplay.displayName = 'SubQuestionDisplay';

const SortableQuestionItem = React.memo(({
    question,
    allQuestions,
    allSections,
    onDelete,
    onDuplicate,
    onQuestionChange,
    onCreateSubQuestion,
    onDeleteSubQuestion,
    users,
    profiles,
    isDragging,
    isHighlighted,
    index,
    level = 0
}: {
    question: FormQuestion,
    allQuestions: FormQuestion[],
    allSections: FormSection[],
    onDelete: () => void,
    onDuplicate: () => void,
    onQuestionChange: (updatedQuestion: FormQuestion) => void;
    onCreateSubQuestion: (parentQuestionId: string, optionId: string, type: FormQuestion['type']) => void;
    onDeleteSubQuestion: (parentQuestionId: string, subQuestionId: string) => void;
    users: any[];
    profiles: any[];
    isDragging?: boolean;
    isHighlighted?: boolean;
    index: number;
    level?: number;
}) => {
    const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: question.id, data: { type: 'question', question } });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition: transition || 'transform 250ms ease',
        marginLeft: `${level * 40}px`
    };
    
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (question.label === 'Nova Pergunta') {
            inputRef.current?.select();
        }
    }, [question.label]);
    
    const subQuestions = useMemo(() => {
        if (!question.options) return [];
        const subQuestionMap = new Map(allQuestions.map(q => [q.id, q]));
        return question.options
            .map(opt => opt.ramification?.targetQuestionId ? subQuestionMap.get(opt.ramification.targetQuestionId) : null)
            .filter((q): q is FormQuestion => !!q && q.excluidaDoSumario);
    }, [question.options, allQuestions]);

    return (
         <div className="relative">
             {level > 0 && <div className="absolute -left-5 top-0 bottom-0 w-px bg-border"></div>}
             {level > 0 && <div className="absolute -left-5 top-7 h-px w-5 bg-border"></div>}
            <div
                id={`question-card-${question.id}`}
                ref={setNodeRef}
                style={style}
                className={cn(
                    "bg-card border rounded-lg overflow-hidden transition-shadow relative",
                    isDragging && 'opacity-50 z-50 shadow-2xl',
                    isOver && 'shadow-lg',
                    isHighlighted && 'animate-pulse-once'
                )}
                key={`${question.id}-${isHighlighted}`}
            >
                <Accordion type="single" collapsible className="w-full">
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
                        </div>
                        <AccordionContent className="px-4 pb-4">
                            <QuestionSettingsPanel
                                key={question.id}
                                question={question}
                                allQuestions={allQuestions}
                                allSections={allSections}
                                onChange={onQuestionChange}
                                onCreateSubQuestion={onCreateSubQuestion}
                                onDeleteSubQuestion={onDeleteSubQuestion}
                                users={users}
                                profiles={profiles}
                            />
                             <div className="border-t mt-4 pt-4 flex justify-end gap-2">
                                <Button variant="outline" onClick={onDuplicate}>
                                    <Copy className="h-4 w-4 mr-2" />
                                    Duplicar
                                </Button>
                                <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Excluir Pergunta
                                </Button>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            </div>
             {subQuestions.length > 0 && (
                <div className="pt-4 space-y-4">
                    {subQuestions.map((subQ, subIndex) => (
                         <SubQuestionDisplay
                            key={subQ.id}
                            parentQuestionId={question.id}
                            subQuestionId={subQ.id}
                            allQuestions={allQuestions}
                            allSections={allSections}
                            onQuestionChange={onQuestionChange}
                            onDeleteSubQuestion={onDeleteSubQuestion}
                            onCreateSubQuestion={onCreateSubQuestion}
                            onDuplicate={() => { /* Not implemented for sub-questions yet */ }}
                            users={users}
                            profiles={profiles}
                            index={subIndex}
                            level={level + 1}
                            globalIndex={index}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});
SortableQuestionItem.displayName = 'SortableQuestionItem';

const RecursiveQuestionRenderer = React.memo(({ 
    questionIds,
    level = 0,
    ...props 
}: { 
    questionIds: string[];
    allQuestions: FormQuestion[];
    allSections: FormSection[];
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
    onQuestionChange: (q: FormQuestion) => void;
    onCreateSubQuestion: (parentQuestionId: string, optionId: string, type: FormQuestion['type']) => void;
    onDeleteSubQuestion: (parentQuestionId: string, subQuestionId: string) => void;
    users: any[];
    profiles: any[];
    activeId: string | null;
    overId: string | null;
    highlightedQuestionId: string | null;
    globalIndex: number;
    level?: number;
}) => {
    const questionMap = useMemo(() => new Map(props.allQuestions.map(q => [q.id, q])), [props.allQuestions]);
    const questionsToRender = useMemo(() => questionIds.map(id => questionMap.get(id)).filter(q => !!q && !q.excluidaDoSumario) as FormQuestion[], [questionIds, questionMap]);
    
    return (
        <div className={cn("space-y-4", level > 0 && "pt-4")}>
            {questionsToRender.map((q, index) => (
                 <div key={q.id}>
                    {props.activeId && props.overId === q.id && <Placeholder index={index} />}
                    <SortableQuestionItem
                        index={props.globalIndex + index}
                        question={q}
                        allQuestions={props.allQuestions}
                        allSections={props.allSections}
                        onDelete={() => props.onDelete(q.id)}
                        onDuplicate={() => props.onDuplicate(q.id)}
                        onQuestionChange={props.onQuestionChange}
                        onCreateSubQuestion={props.onCreateSubQuestion}
                        onDeleteSubQuestion={props.onDeleteSubQuestion}
                        users={props.users}
                        profiles={props.profiles}
                        isDragging={props.activeId === q.id}
                        isHighlighted={props.highlightedQuestionId === q.id}
                        level={level}
                    />
                </div>
            ))}
        </div>
    )
});
RecursiveQuestionRenderer.displayName = 'RecursiveQuestionRenderer';


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
    
    const { questionsBySection, topLevelQuestionsBySection } = useMemo(() => {
        const result: Record<string, FormQuestion[]> = {};
        const topLevelResult: Record<string, FormQuestion[]> = {};

        if (!internalTemplate || !internalTemplate.questions || !internalTemplate.sections) {
            return { questionsBySection: result, topLevelQuestionsBySection: topLevelResult };
        }

        const allQuestions = internalTemplate.questions;
        
        sortedSections.forEach(section => {
            result[section.id] = [];
            topLevelResult[section.id] = [];
        });

        allQuestions.forEach(q => {
            const sectionId = q.sectionId && Object.prototype.hasOwnProperty.call(result, q.sectionId)
                ? q.sectionId
                : sortedSections[0]?.id;
            
            if(sectionId && result[sectionId]) {
                result[sectionId].push({ ...q, sectionId });
                if(!q.excluidaDoSumario) {
                    topLevelResult[sectionId].push({ ...q, sectionId });
                }
            }
        });
        
        Object.keys(result).forEach(sectionId => {
            result[sectionId].sort((a, b) => a.order - b.order);
            topLevelResult[sectionId].sort((a, b) => a.order - b.order);
        });

        return { questionsBySection: result, topLevelQuestionsBySection: topLevelResult };
    }, [internalTemplate, sortedSections]);

    const scrollToQuestion = useCallback((questionId: string) => {
        setSelectedQuestionId(questionId);
        setHighlightedQuestionId(questionId);
        const element = document.getElementById(`question-card-${questionId}`);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setTimeout(() => setHighlightedQuestionId(null), 1500);
    }, []);

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
    
    const handleCreateSubQuestion = useCallback((
      parentQuestionId: string, 
      optionId: string,
      type: FormQuestion['type'] = 'text'
    ) => {
      setInternalTemplate(currentTemplate => {
        if (!currentTemplate) return null;

        let allQuestions = [...currentTemplate.questions];
        const parentIndex = allQuestions.findIndex(q => q.id === parentQuestionId);
        if (parentIndex === -1) return currentTemplate;
        
        const parentQuestion = allQuestions[parentIndex];
        
        const newSubQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: 'Nova Sub-pergunta',
            type,
            isRequired: false,
            order: 0, // Placeholder
            sectionId: parentQuestion.sectionId,
            excluidaDoSumario: true,
        };
        
        // Update parent question's option with ramification
        const updatedParentQuestion = {
            ...parentQuestion,
            options: (parentQuestion.options || []).map(opt => {
                if (opt.id !== optionId) return opt;
                return {
                    ...opt,
                    ramification: {
                        id: `ram-${nanoid()}`,
                        action: 'add_question',
                        targetQuestionId: newSubQuestion.id
                    }
                };
            })
        };

        allQuestions[parentIndex] = updatedParentQuestion;

        // Find the correct insertion index
        let lastSubQuestionIndex = parentIndex;
        const parentSubTreeIds = new Set<string>();
        const queue = [parentQuestion.id];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if(visited.has(currentId)) continue;
            visited.add(currentId);

            const currentQ = allQuestions.find(q => q.id === currentId);
            if(currentQ?.options){
                for(const opt of currentQ.options){
                    if(opt.ramification?.targetQuestionId){
                        parentSubTreeIds.add(opt.ramification.targetQuestionId);
                        queue.push(opt.ramification.targetQuestionId);
                    }
                }
            }
        }
        
        for (let i = parentIndex + 1; i < allQuestions.length; i++) {
            if (parentSubTreeIds.has(allQuestions[i].id)) {
                lastSubQuestionIndex = i;
            } else {
                break;
            }
        }
        
        // Insert new sub-question
        allQuestions.splice(lastSubQuestionIndex + 1, 0, newSubQuestion);
        
        const finalQuestions = allQuestions.map((q, index) => ({...q, order: index}));
        
        setTimeout(() => scrollToQuestion(newSubQuestion.id), 100);

        return { ...currentTemplate, questions: finalQuestions };
      });
    }, [scrollToQuestion]);


    const handleDeleteSubQuestion = useCallback((parentQuestionId: string, subQuestionId: string) => {
        setInternalTemplate(currentTemplate => {
            if (!currentTemplate) return null;

            // Remove the sub-question from the main questions array
            let newQuestions = currentTemplate.questions.filter(q => q.id !== subQuestionId);

            // Find the parent and remove the ramification link
            const parentIndex = newQuestions.findIndex(q => q.id === parentQuestionId);
            if (parentIndex !== -1) {
                const parent = { ...newQuestions[parentIndex] };
                parent.options = (parent.options || []).map(opt => {
                    if (opt.ramification?.targetQuestionId === subQuestionId) {
                        const { ramification, ...restOfOption } = opt;
                        // Important: setting ramification to undefined to clear it.
                        return { ...restOfOption, ramification: undefined };
                    }
                    return opt;
                }).filter(opt => opt.ramification !== undefined || !opt.ramification); // Clean up fully empty options if needed
                newQuestions[parentIndex] = parent;
            }
            
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
    
    const duplicateQuestionAndSubQuestions = useCallback((questionId: string, allQuestions: FormQuestion[]): { newQuestions: FormQuestion[], newTopLevelQuestionId: string } => {
        const questionMap = new Map(allQuestions.map(q => [q.id, q]));
        const duplicatedQuestionsMap = new Map<string, FormQuestion>();
        const newQuestionsArray: FormQuestion[] = [];

        const recursiveDuplicate = (qId: string): FormQuestion => {
            if (duplicatedQuestionsMap.has(qId)) {
                return duplicatedQuestionsMap.get(qId)!;
            }

            const originalQuestion = questionMap.get(qId);
            if (!originalQuestion) {
                throw new Error(`Question with id ${qId} not found`);
            }

            const newQuestion: FormQuestion = {
                ...JSON.parse(JSON.stringify(originalQuestion)),
                id: `question-${nanoid()}`,
                options: [],
            };
            
            if (originalQuestion.label.endsWith(" (Cópia)")) {
                newQuestion.label = originalQuestion.label;
            } else {
                newQuestion.label = `${originalQuestion.label} (Cópia)`;
            }

            duplicatedQuestionsMap.set(qId, newQuestion);

            if (originalQuestion.options) {
                newQuestion.options = originalQuestion.options.map(opt => {
                    const newOption = {
                        ...opt,
                        id: `opt-${nanoid()}`,
                    };
                    if (opt.ramification?.targetQuestionId) {
                        const newSubQuestion = recursiveDuplicate(opt.ramification.targetQuestionId);
                        newOption.ramification = {
                            ...opt.ramification,
                            id: `ram-${nanoid()}`,
                            targetQuestionId: newSubQuestion.id,
                        };
                    }
                    return newOption;
                });
            }
            
            newQuestionsArray.push(newQuestion);
            return newQuestion;
        };

        const newTopLevelQuestion = recursiveDuplicate(questionId);
        
        return { newQuestions: newQuestionsArray, newTopLevelQuestionId: newTopLevelQuestion.id };
    }, []);

    const handleDuplicateQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        const { newQuestions: duplicatedQuestions, newTopLevelQuestionId } = duplicateQuestionAndSubQuestions(questionId, internalTemplate.questions);
        
        const originalQuestionIndex = internalTemplate.questions.findIndex(q => q.id === questionId);

        const newQuestionsList = [...internalTemplate.questions];
        
        const originalQuestion = internalTemplate.questions[originalQuestionIndex];
        const subTreeIds = new Set<string>();
        const queue = [originalQuestion];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current && current.options) {
                current.options.forEach(opt => {
                    if (opt.ramification?.targetQuestionId) {
                        subTreeIds.add(opt.ramification.targetQuestionId);
                        const subQ = internalTemplate.questions.find(q => q.id === opt.ramification.targetQuestionId);
                        if (subQ) queue.push(subQ);
                    }
                });
            }
        }
        
        let lastSubTreeIndex = originalQuestionIndex;
        for (let i = originalQuestionIndex + 1; i < newQuestionsList.length; i++) {
            if (subTreeIds.has(newQuestionsList[i].id)) {
                lastSubTreeIndex = i;
            }
        }

        newQuestionsList.splice(lastSubTreeIndex + 1, 0, ...duplicatedQuestions);

        const finalQuestions = newQuestionsList.map((q, index) => ({...q, order: index}));

        handleTemplateChange({ questions: finalQuestions });

        setTimeout(() => scrollToQuestion(newTopLevelQuestionId), 100);
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        const questionToDelete = internalTemplate.questions.find(q => q.id === questionId);
        if (!questionToDelete) return;

        let allIdsToDelete = new Set([questionId]);
        const queue = [questionToDelete];

        while(queue.length > 0) {
            const current = queue.shift();
            if (current?.options) {
                current.options.forEach(opt => {
                    if (opt.ramification?.targetQuestionId) {
                        allIdsToDelete.add(opt.ramification.targetQuestionId);
                        const subQ = internalTemplate.questions.find(q => q.id === opt.ramification.targetQuestionId);
                        if(subQ) queue.push(subQ);
                    }
                })
            }
        }
        
        let newQuestions = internalTemplate.questions
            .filter(q => !allIdsToDelete.has(q.id))
            .map(q => {
                if (!q.options) return q;
                const cleanedOptions = q.options.map(opt => {
                    if (opt.ramification && allIdsToDelete.has(opt.ramification.targetQuestionId!)) {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            
            if (overData?.type === 'question-dropzone') {
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
                        <Button variant="outline" onClick={() => setIsPreviewOpen(true)}>
                            <Eye className="mr-2 h-4 w-4" /> Preview
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
                        questionsBySection={topLevelQuestionsBySection}
                        selectedQuestionId={selectedQuestionId}
                        onQuestionSelect={scrollToQuestion}
                        isCollapsed={isSummaryCollapsed}
                        setIsCollapsed={setIsSummaryCollapsed}
                        questionIcons={questionIcons}
                        allQuestions={internalTemplate.questions || []}
                    />

                    <div ref={mainContentRef} className="space-y-4 h-[calc(100vh-10rem)] overflow-y-auto pr-2">
                        {sortedSections.map(section => {
                             const sectionQuestions = topLevelQuestionsBySection[section.id] || [];
                             const sectionStartIndex = globalQuestionIndex;
                             globalQuestionIndex += sectionQuestions.length;
                            return (
                                <div key={section.id}>
                                    <div className="flex items-center mb-4">
                                        <Input 
                                            value={section.name} 
                                            onChange={e => handleSectionChange(section.id, e.target.value)} 
                                            className="text-xl font-bold border-none focus-visible:ring-1 flex-grow bg-transparent p-1 h-auto"
                                        />
                                        {sortedSections.length > 1 && (
                                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteSection(section.id); }} className="text-destructive h-9 w-9">
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        )}
                                    </div>
                                    <div className="space-y-4">
                                        <SortableContext items={sectionQuestions.map(q => q.id)}>
                                             <RecursiveQuestionRenderer 
                                                questionIds={sectionQuestions.map(q => q.id)} 
                                                globalIndex={sectionStartIndex}
                                                allQuestions={internalTemplate?.questions || []}
                                                allSections={internalTemplate?.sections || []}
                                                onDelete={handleDeleteQuestion}
                                                onDuplicate={handleDuplicateQuestion}
                                                onQuestionChange={handleQuestionChange}
                                                onCreateSubQuestion={handleCreateSubQuestion}
                                                onDeleteSubQuestion={handleDeleteSubQuestion}
                                                users={users}
                                                profiles={profiles}
                                                activeId={activeId}
                                                overId={overId}
                                                highlightedQuestionId={highlightedQuestionId}
                                            />
                                        </SortableContext>
                                        <QuestionDropzone sectionId={section.id} atIndex={sectionQuestions.length} overId={overId} />
                                    </div>
                                </div>
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
                    {activeQuestion && <SortableQuestionItem question={activeQuestion} allQuestions={[]} allSections={[]} users={users} profiles={profiles} onDelete={() => {}} onDuplicate={() => {}} onQuestionChange={() => {}} onCreateSubQuestion={() => {}} onDeleteSubQuestion={() => {}} index={0} />}
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



