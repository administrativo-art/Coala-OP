
"use client";

import React from 'react';
import { Form, FormTemplate, type FormQuestion } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from './ui/button';
import { FormGeneralSettings } from './form-general-settings';
import { ScrollArea } from './ui/scroll-area';
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
  template: FormTemplate | Omit<FormTemplate, 'id' | 'status'>;
  onTemplateChange: (updates: Partial<FormTemplate>) => void;
  onAddQuestion: (type: FormQuestion['type']) => void;
}

export function FormBuilderSidebar({ template, onTemplateChange, onAddQuestion }: FormBuilderSidebarProps) {
  return (
    <div className="h-full flex flex-col">
        <Tabs defaultValue="add" className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="add">Adicionar</TabsTrigger>
                <TabsTrigger value="settings">Configurações</TabsTrigger>
            </TabsList>
            <TabsContent value="add" className="flex-1 mt-4">
                <ScrollArea className="h-full">
                    <div className="space-y-2 pr-2">
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
                </ScrollArea>
            </TabsContent>
            <TabsContent value="settings" className="flex-1 mt-4">
                 <ScrollArea className="h-full">
                    <FormGeneralSettings template={template} onTemplateChange={onTemplateChange} />
                </ScrollArea>
            </TabsContent>
        </Tabs>
    </div>
  );
}
