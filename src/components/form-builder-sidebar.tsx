
"use client";

import React from 'react';
import { type FormQuestion } from '@/types';
import { Button } from './ui/button';
import { Type, Text, Hash, ToggleRight, CheckSquare, List, FileText as FileIcon } from 'lucide-react';

const questionTypes: { type: FormQuestion['type'], label: string, icon: React.ElementType }[] = [
    { type: 'text', label: 'Texto', icon: Text },
    { type: 'number', label: 'Número', icon: Hash },
    { type: 'yes-no', label: 'Sim/Não', icon: ToggleRight },
    { type: 'single-choice', label: 'Escolha Única', icon: List },
    { type: 'multiple-choice', label: 'Múltipla Escolha', icon: CheckSquare },
    { type: 'file-attachment', label: 'Anexo', icon: FileIcon },
];

interface FormBuilderSidebarProps {
  onAddQuestion: (type: FormQuestion['type']) => void;
}

export function FormBuilderSidebar({ onAddQuestion }: FormBuilderSidebarProps) {
  return (
    <div className="p-4 border rounded-lg bg-card sticky top-6">
        <h3 className="font-semibold mb-4 text-center">Adicionar Pergunta</h3>
        <div className="grid grid-cols-1 gap-2">
            {questionTypes.map(({ type, label, icon: Icon }) => (
                <Button
                    key={type}
                    variant="outline"
                    className="w-full justify-start h-12"
                    onClick={() => onAddQuestion(type)}
                >
                    <Icon className="mr-3 h-5 w-5 text-muted-foreground" />
                    {label}
                </Button>
            ))}
        </div>
    </div>
  );
}
