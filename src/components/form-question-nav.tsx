
"use client";

import React from 'react';
import { SortableContext, useSortable, arrayMove } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { type FormQuestion } from '@/types';
import { GripVertical, Hash, Text, ToggleRight, CheckSquare, List, FileText as FileIcon } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';

const questionIcons: Record<FormQuestion['type'], React.ElementType> = {
  text: Text,
  number: Hash,
  'yes-no': ToggleRight,
  'single-choice': List,
  'multiple-choice': CheckSquare,
  'file-attachment': FileIcon,
};

const SortableNavItem = ({ question, index, isSelected, onSelect }: { question: FormQuestion; index: number; isSelected: boolean; onSelect: (id: string) => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: question.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const Icon = questionIcons[question.type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center p-2 rounded-lg cursor-pointer transition-colors",
        isSelected ? "bg-primary/20 text-primary-foreground" : "hover:bg-muted"
      )}
      onClick={() => onSelect(question.id)}
    >
      <Button variant="ghost" size="icon" className="cursor-grab h-8 w-8" {...listeners} {...attributes}>
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </Button>
      <span className="font-mono text-xs w-6 text-muted-foreground">{index + 1}.</span>
      <Icon className="h-4 w-4 mr-2 shrink-0" />
      <span className="text-sm font-medium truncate flex-1">{question.label || 'Nova Pergunta'}</span>
    </div>
  );
};

export function FormQuestionNav({ questions, selectedQuestionId, onQuestionSelect, onReorder }: {
  questions: FormQuestion[];
  selectedQuestionId: string | null;
  onQuestionSelect: (id: string) => void;
  onReorder: (reorderedQuestions: FormQuestion[]) => void;
}) {
  const { setNodeRef } = useDroppable({ id: 'question-nav-drop-area' });

  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6">
      <h3 className="text-lg font-semibold mb-2">Sumário</h3>
      <p className="text-sm text-muted-foreground mb-4">Clique para navegar ou arraste para reordenar.</p>
      <ScrollArea className="h-[calc(100vh-16rem)]">
        <div ref={setNodeRef} className="space-y-1 pr-2">
            <SortableContext items={questions.map(q => q.id)}>
                {questions.map((q, index) => (
                    <SortableNavItem
                        key={q.id}
                        question={q}
                        index={index}
                        isSelected={selectedQuestionId === q.id}
                        onSelect={onQuestionSelect}
                    />
                ))}
            </SortableContext>
        </div>
      </ScrollArea>
    </div>
  );
}
