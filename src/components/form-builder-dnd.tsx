
"use client";

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
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
            className="h-14 w-full rounded-lg border-2 border-dashed border-primary bg-primary/10 my-2"
        />
    );
};
