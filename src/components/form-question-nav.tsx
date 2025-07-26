"use client";

import React from 'react';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { type FormQuestion, type FormSection } from '@/types';
import { GripVertical, Hash, Text, ToggleRight, CheckSquare, List, FileText as FileIcon, ChevronsLeft, ChevronsRight, Star, MoveHorizontal } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';

const SortableNavItem = ({ q, index, isCollapsed, selectedQuestionId, onQuestionSelect, questionIcons }: {
    q: FormQuestion;
    index: number;
    isCollapsed: boolean;
    selectedQuestionId: string | null;
    onQuestionSelect: (id: string) => void;
    questionIcons: Record<FormQuestion['type'], React.ElementType>;
}) => {
    const Icon = questionIcons[q.type];

    const content = (
        <div 
            onClick={() => onQuestionSelect(q.id)}
            className={cn(
                "flex items-center p-2 rounded-lg cursor-pointer w-full", 
                selectedQuestionId === q.id ? "bg-primary/20" : "hover:bg-muted",
                isCollapsed && "justify-center"
            )}
        >
            <div className={cn("flex items-center", isCollapsed ? "gap-0" : "gap-2")}>
                <span className={cn("font-bold", isCollapsed ? "text-xs mr-1.5" : "text-base w-8")}>{index + 1}.</span>
                <Icon className={cn("shrink-0 text-primary", isCollapsed ? "h-5 w-5" : "h-5 w-5")}/>
                {!isCollapsed && <span className="text-sm font-normal truncate flex-1">{q.label || 'Nova Pergunta'}</span>}
            </div>
        </div>
    );

    if (isCollapsed) {
        return (
            <TooltipProvider>
                <Tooltip delayDuration={100}>
                    <TooltipTrigger asChild>{content}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={5}>
                        <p>{q.label || 'Nova Pergunta'}</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    
    return content;
};


export function FormQuestionNav({ sections, questionsBySection, selectedQuestionId, onQuestionSelect, isCollapsed, setIsCollapsed, questionIcons }: {
  sections: FormSection[];
  questionsBySection: Record<string, FormQuestion[]>;
  selectedQuestionId: string | null;
  onQuestionSelect: (id: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  questionIcons: Record<FormQuestion['type'], React.ElementType>;
}) {
  
  let globalQuestionIndex = 0;

  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6 flex flex-col h-[calc(100vh-3rem)]">
      {!isCollapsed && (
        <>
            <h3 className="text-lg font-semibold mb-2">Sumário</h3>
            <p className="text-sm text-muted-foreground mb-4">Clique para navegar ou arraste para reordenar.</p>
        </>
      )}
      <ScrollArea className="flex-1 -mx-4">
        <div className="space-y-1 px-4">
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
                                    <SortableNavItem 
                                        key={q.id}
                                        q={q}
                                        index={sectionStartIndex + index}
                                        isCollapsed={isCollapsed}
                                        selectedQuestionId={selectedQuestionId}
                                        onQuestionSelect={onQuestionSelect}
                                        questionIcons={questionIcons}
                                    />
                                 ))}
                                 {sectionQuestions.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma pergunta nesta seção</p>}
                            </AccordionContent>
                        </AccordionItem>
                    )
                })}
            </Accordion>
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