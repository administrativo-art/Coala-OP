
"use client";

import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { type FormQuestion } from '@/types';
import { Text, Hash, ToggleRight, CheckSquare, List, FileText as FileIcon, GripVertical, Star, MoveHorizontal } from 'lucide-react';

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

export const DraggableQuestionType = ({ type, label, isOverlay }: { type: FormQuestion['type']; label?: string; isOverlay?: boolean }) => {
  const Icon = questionIcons[type];
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: `new-question-${type}`,
    data: { type },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "flex items-center p-3 rounded-lg border bg-card cursor-grab",
        isOverlay && "shadow-lg"
      )}
    >
      <GripVertical className="h-5 w-5 text-muted-foreground mr-3" />
      <Icon className="h-5 w-5 text-primary mr-3" />
      <span className="font-medium">{label || type}</span>
    </div>
  );
};

export const Placeholder = ({ index }: { index: number }) => {
    return (
        <div
            id={`placeholder-${index}`}
            className="h-16 w-full rounded-lg border-2 border-dashed border-primary/50 bg-primary/10 my-2 transition-all duration-150 ease-in-out animate-in fade-in"
        />
    );
};

export const QuestionDropzone = ({ sectionId, atIndex, overId }: { sectionId: string, atIndex: number, overId: string | null }) => {
    const id = `dropzone-${sectionId}-${atIndex}`;
    const { setNodeRef, isOver } = useDroppable({
        id,
        data: {
            type: 'question-dropzone',
            dropzoneData: { sectionId, atIndex },
        },
    });

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground transition-colors",
                isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30 hover:border-primary hover:text-primary"
            )}
        >
            Arraste um campo aqui
        </div>
    );
};
