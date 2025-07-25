
"use client";

import React, { useState } from 'react';
import { type FormQuestion } from '@/types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Search, Type, Text, Hash, ToggleRight, CheckSquare, List, FileText as FileIcon } from 'lucide-react';

const questionTypes: { type: FormQuestion['type'], label: string, icon: React.ElementType }[] = [
    { type: 'text', label: 'Texto', icon: Text },
    { type: 'number', label: 'Número', icon: Hash },
    { type: 'yes-no', label: 'Sim/Não', icon: ToggleRight },
    { type: 'single-choice', label: 'Escolha Única', icon: List },
    { type: 'multiple-choice', label: 'Múltipla Escolha', icon: CheckSquare },
    { type: 'file-attachment', label: 'Anexo', icon: FileIcon },
];

const DraggableQuestionType = ({ type, label, icon: Icon }: { type: FormQuestion['type'], label: string, icon: React.ElementType }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
      id: `new-question-${type}`,
      data: { type },
    });
  
    const style = {
      transform: CSS.Translate.toString(transform),
      zIndex: isDragging ? 100 : 'auto',
      opacity: isDragging ? 0.5 : 1,
    };
  
    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
            <Button
                variant="outline"
                className="w-full justify-start h-12 cursor-grab"
            >
                <Icon className="mr-3 h-5 w-5 text-muted-foreground" />
                {label}
            </Button>
      </div>
    );
  };
  

export function FormBuilderSidebar() {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredQuestionTypes = questionTypes.filter(({ label }) =>
    label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6">
        <div className="relative mb-4">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar tipo de campo..."
              className="w-full rounded-lg bg-muted pl-8 h-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
        <div className="grid grid-cols-1 gap-2">
            {filteredQuestionTypes.map(({ type, label, icon: Icon }) => (
                <DraggableQuestionType key={type} type={type} label={label} icon={Icon} />
            ))}
        </div>
    </div>
  );
}

