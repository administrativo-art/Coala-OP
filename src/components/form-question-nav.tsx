
"use client";

import React from 'react';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { type FormQuestion } from '@/types';
import { GripVertical, Hash, Text, ToggleRight, CheckSquare, List, FileText as FileIcon, ChevronsLeft, ChevronsRight, Star, MoveHorizontal } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

const SortableNavItem = ({ question, index, isSelected, onSelect, isCollapsed }: { question: FormQuestion; index: number; isSelected: boolean; onSelect: (id: string) => void; isCollapsed: boolean; }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = questionIcons[question.type];
  
  const content = (
     <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center p-2 rounded-lg cursor-pointer transition-colors w-full",
        isSelected ? "bg-primary/20 text-primary-foreground" : "hover:bg-muted"
      )}
      onClick={() => onSelect(question.id)}
    >
      <Button variant="ghost" size="icon" className="cursor-grab h-8 w-8" {...listeners} {...attributes}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </Button>
      {!isCollapsed && <span className="font-mono text-sm w-6 font-semibold">{index + 1}.</span>}
      <Icon className={cn("h-5 w-5 shrink-0 text-primary", !isCollapsed && "mr-2")}/>
      {!isCollapsed && <span className="text-sm font-medium truncate flex-1">{question.label || 'Nova Pergunta'}</span>}
    </div>
  );
  
  if (isCollapsed) {
    return (
        <TooltipProvider><Tooltip delayDuration={100}><TooltipTrigger asChild>
            {content}
        </TooltipTrigger><TooltipContent side="right"><p>{index + 1}. {question.label || 'Nova Pergunta'}</p></TooltipContent></Tooltip></TooltipProvider>
    )
  }

  return content;
};

export function FormQuestionNav({ questions, selectedQuestionId, onQuestionSelect, onReorder, isCollapsed, setIsCollapsed }: {
  questions: FormQuestion[];
  selectedQuestionId: string | null;
  onQuestionSelect: (id: string) => void;
  onReorder: (reorderedQuestions: FormQuestion[]) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}) {
  const { setNodeRef } = useDroppable({ id: 'question-nav-drop-area' });

  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6 flex flex-col h-full">
      {!isCollapsed && (
        <>
            <h3 className="text-lg font-semibold mb-2">Sumário</h3>
            <p className="text-sm text-muted-foreground mb-4">Clique para navegar ou arraste para reordenar.</p>
        </>
      )}
      <ScrollArea className="flex-1">
        <div ref={setNodeRef} className="space-y-1 pr-2">
            <SortableContext items={questions.map(q => q.id)}>
                {questions.map((q, index) => (
                    <SortableNavItem
                        key={q.id}
                        question={q}
                        index={index}
                        isSelected={selectedQuestionId === q.id}
                        onSelect={onQuestionSelect}
                        isCollapsed={isCollapsed}
                    />
                ))}
            </SortableContext>
        </div>
      </ScrollArea>
       <div className="mt-auto pt-4 border-t">
            <Button variant="ghost" size={isCollapsed ? "icon" : "default"} className="w-full" onClick={() => setIsCollapsed(!isCollapsed)}>
                {isCollapsed ? <ChevronsRight /> : <ChevronsLeft className="mr-2" />}
                {!isCollapsed && <span>Recolher</span>}
            </Button>
       </div>
    </div>
  );
}
