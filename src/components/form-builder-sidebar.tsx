
"use client";

import React, { useState } from 'react';
import { type FormQuestion } from '@/types';
import { DraggableQuestionType } from './form-builder-dnd';
import { Input } from './ui/input';
import { Search } from 'lucide-react';

const questionTypes: { type: FormQuestion['type'], label: string }[] = [
    { type: 'text', label: 'Texto' },
    { type: 'number', label: 'Número' },
    { type: 'yes-no', label: 'Sim/Não' },
    { type: 'single-choice', label: 'Escolha Única' },
    { type: 'multiple-choice', label: 'Múltipla Escolha' },
    { type: 'file-attachment', label: 'Anexo' },
];

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
            {filteredQuestionTypes.map(({ type, label }) => (
                <DraggableQuestionType key={type} type={type} label={label} />
            ))}
        </div>
    </div>
  );
}
