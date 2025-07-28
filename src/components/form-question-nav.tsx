
"use client";

import React from 'react';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { type FormQuestion, type FormSection } from '@/types';
import { GripVertical, Hash, Text, ToggleRight, CheckSquare, List, FileText as FileIcon, ChevronsLeft, ChevronsRight, Star, MoveHorizontal, GitBranch } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';

interface NavItemProps {
    question: FormQuestion;
    indexPrefix: string;
    isCollapsed: boolean;
    selectedQuestionId: string | null;
    onQuestionSelect: (id: string) => void;
    questionIcons: Record<FormQuestion['type'], React.ElementType>;
    allQuestions: FormQuestion[];
    level?: number;
}

const NavItem = ({ question, indexPrefix, isCollapsed, selectedQuestionId, onQuestionSelect, questionIcons, allQuestions, level = 0 }: NavItemProps) => {
    const Icon = questionIcons[question.type];
    
    const allQuestionsMap = React.useMemo(() => new Map(allQuestions.map(q => [q.id, q])), [allQuestions]);

    const subQuestions = React.useMemo(() => {
        if (!question.options) return [];
        return question.options
            .map(opt => opt.ramification?.targetQuestionId ? allQuestionsMap.get(opt.ramification.targetQuestionId) : null)
            .filter((q): q is FormQuestion => !!q);
    }, [question.options, allQuestionsMap]);
    
    const hasSubQuestions = subQuestions.length > 0;

    const content = (
        <div 
            onClick={() => onQuestionSelect(question.id)}
            className={cn(
                "flex items-center p-2 rounded-lg cursor-pointer w-full text-left", 
                selectedQuestionId === question.id ? "bg-primary/20" : "hover:bg-muted",
                isCollapsed && "justify-center"
            )}
            style={{ paddingLeft: `${8 + level * 16}px` }}
        >
            <div className={cn("flex items-center flex-1", isCollapsed ? "gap-0" : "gap-2")}>
                {level > 0 && <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />}
                <span className={cn("font-bold text-muted-foreground", isCollapsed ? "text-xs" : "text-base w-6")}>{indexPrefix}</span>
                <Icon className={cn("shrink-0 text-primary", isCollapsed ? "h-5 w-5" : "h-5 w-5")}/>
                {!isCollapsed && <span className="text-sm font-normal truncate flex-1">{question.label || 'Nova Pergunta'}</span>}
            </div>
        </div>
    );

    return (
        <li>
             <TooltipProvider>
                <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>{content}</TooltipTrigger>
                    {isCollapsed && (
                        <TooltipContent side="right" sideOffset={5}>
                            <p>{question.label || 'Nova Pergunta'}</p>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
             {!isCollapsed && hasSubQuestions && (
                <ul className="mt-1 space-y-1">
                    {subQuestions.map((sub, subIndex) => (
                        <NavItem 
                            key={sub.id}
                            question={sub}
                            indexPrefix={`${indexPrefix}${subIndex + 1}.`}
                            isCollapsed={isCollapsed}
                            selectedQuestionId={selectedQuestionId}
                            onQuestionSelect={onQuestionSelect}
                            questionIcons={questionIcons}
                            allQuestions={allQuestions}
                            level={level + 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
};


export function FormQuestionNav({ sections, questionsBySection, selectedQuestionId, onQuestionSelect, isCollapsed, setIsCollapsed, questionIcons, allQuestions }: {
  sections: FormSection[];
  questionsBySection: Record<string, FormQuestion[]>;
  selectedQuestionId: string | null;
  onQuestionSelect: (id: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  questionIcons: Record<FormQuestion['type'], React.ElementType>;
  allQuestions: FormQuestion[];
}) {
  
  let globalQuestionIndex = 0;

  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6 flex flex-col h-[calc(100vh-3rem)]">
      {!isCollapsed && (
            <h3 className="text-lg font-semibold mb-2">Sumário</h3>
      )}
      <ScrollArea className="flex-1 -mx-4">
        <div className="space-y-1 px-4">
            {sections.length > 1 ? (
                <Accordion type="multiple" defaultValue={sections.map(s => s.id)} className="w-full">
                    {sections.map(section => {
                        const sectionQuestions = questionsBySection[section.id] || [];
                        const sectionStartIndex = globalQuestionIndex;
                        globalQuestionIndex += sectionQuestions.length;
                        
                        return (
                            <AccordionItem value={section.id} key={section.id} className="border-none">
                                <AccordionTrigger className="p-2 text-base hover:no-underline hover:bg-muted rounded-lg [&[data-state=open]>svg]:text-primary">
                                    <span className="font-semibold truncate flex-1 text-left">{section.name}</span>
                                </AccordionTrigger>
                                <AccordionContent className="pt-1 pl-4 border-l-2 ml-2">
                                     {sectionQuestions.map((q, index) => (
                                        <NavItem 
                                            key={q.id}
                                            question={q}
                                            indexPrefix={`${sectionStartIndex + index + 1}.`}
                                            isCollapsed={isCollapsed}
                                            selectedQuestionId={selectedQuestionId}
                                            onQuestionSelect={onQuestionSelect}
                                            questionIcons={questionIcons}
                                            allQuestions={allQuestions}
                                        />
                                     ))}
                                     {sectionQuestions.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma pergunta nesta seção</p>}
                                </AccordionContent>
                            </AccordionItem>
                        )
                    })}
                </Accordion>
            ) : (
                <ul className="space-y-1">
                    {(Object.values(questionsBySection).flat()).map((q, index) => (
                         <NavItem 
                            key={q.id}
                            question={q}
                            indexPrefix={`${index + 1}.`}
                            isCollapsed={isCollapsed}
                            selectedQuestionId={selectedQuestionId}
                            onQuestionSelect={onQuestionSelect}
                            questionIcons={questionIcons}
                            allQuestions={allQuestions}
                        />
                    ))}
                </ul>
            )}
        </div>
      </ScrollArea>
       <div className="mt-auto pt-4 border-t shrink-0">
            <Button variant="ghost" size={isCollapsed ? "icon" : "default"} className="w-full" onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronsRight /> : <ChevronsLeft className="mr-2" />}
                {!isCollapsed && <span>Recolher</span>}
            </Button>
       </div>
    </div>
  );
}
