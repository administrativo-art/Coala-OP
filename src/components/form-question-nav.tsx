
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

export function FormQuestionNav({ sections, questionsBySection, selectedQuestionId, onQuestionSelect, isCollapsed, setIsCollapsed }: {
  sections: FormSection[];
  questionsBySection: Record<string, FormQuestion[]>;
  selectedQuestionId: string | null;
  onQuestionSelect: (id: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}) {

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
                {sections.map(section => (
                    <AccordionItem value={section.id} key={section.id} className="border-none">
                        <AccordionTrigger className="p-2 text-base hover:no-underline hover:bg-muted rounded-lg [&[data-state=open]>svg]:text-primary">
                            <span className="font-semibold truncate flex-1 text-left">{section.name}</span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-1 pl-4 border-l-2 ml-2">
                             {(questionsBySection[section.id] || []).map((q, index) => {
                                 const Icon = questionIcons[q.type];
                                 return (
                                    <div 
                                        key={q.id}
                                        onClick={() => onQuestionSelect(q.id)}
                                        className={cn("flex items-center p-2 rounded-lg cursor-pointer", selectedQuestionId === q.id ? "bg-primary/20" : "hover:bg-muted")}
                                    >
                                        <span className="text-base font-bold w-8">{index + 1}.</span>
                                        <Icon className="h-5 w-5 shrink-0 text-primary mr-2"/>
                                        <span className="text-sm font-normal truncate flex-1">{q.label || 'Nova Pergunta'}</span>
                                    </div>
                                )
                             })}
                             {(questionsBySection[section.id] || []).length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhuma pergunta nesta seção</p>}
                        </AccordionContent>
                    </AccordionItem>
                ))}
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
