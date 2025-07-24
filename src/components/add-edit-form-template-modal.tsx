
"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { Settings, PlusCircle, Trash2, Save, FileUp } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { FormGeneralSettings } from './form-general-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from '@/hooks/use-toast';
import { Badge } from './ui/badge';
import { useForm as useFormHook } from '@/hooks/use-form';
import { ScrollArea } from './ui/scroll-area';
import { QuestionSettingsPanel } from './QuestionSettingsPanel';


type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
};

export function AddEditFormTemplateModal({ open, onOpenChange, templateToEdit }: AddEditFormTemplateModalProps) {
    const { addTemplate, updateTemplate } = useFormHook();
    const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id' | 'status'> | null>(null);
    const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
    const { users } = useAuth();
    const { profiles } = useProfiles();
    const [activeTab, setActiveTab] = useState("builder");
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (open) {
            const initialTemplate = templateToEdit
              ? JSON.parse(JSON.stringify(templateToEdit))
              : {
                  name: 'Novo Formulário',
                  type: 'standard',
                  layout: 'continuous',
                  moment: null,
                  submissionTitleFormat: '',
                  questions: [],
              };
            setInternalTemplate(initialTemplate);
            setActiveTab("builder");
            setSelectedQuestionId(null);
        } else {
            setInternalTemplate(null);
        }
    }, [open, templateToEdit]);

    const handleTemplateChange = (updates: Partial<FormTemplate>) => {
        if (!internalTemplate) return;
        setInternalTemplate(prev => ({ ...prev!, ...updates }));
    };

    const handleQuestionChange = (updatedQuestion: FormQuestion) => {
        if (!internalTemplate) return;
        const newQuestions = (internalTemplate.questions || []).map(q => q.id === updatedQuestion.id ? updatedQuestion : q);
        handleTemplateChange({ questions: newQuestions });
    };

    const handleAddQuestion = () => {
        if (!internalTemplate) return;
        const newQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: "Nova Pergunta",
            type: 'text',
            isRequired: false,
        };
        const newQuestions = [...(internalTemplate.questions || []), newQuestion];
        handleTemplateChange({ questions: newQuestions });
        setSelectedQuestionId(newQuestion.id);
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
        
        const newQuestions = (internalTemplate.questions || []).filter(q => q.id !== questionId)
        .map(q => {
            if (!q.ramifications) return q;
            const cleanedRamifications = q.ramifications.filter(r => r.targetQuestionId !== questionId);
            return { ...q, ramifications: cleanedRamifications };
        });

        handleTemplateChange({ questions: newQuestions });
        
        if (selectedQuestionId === questionId) {
            setSelectedQuestionId(null);
        }
    };

    const handleSave = async (publish: boolean) => {
        if (!internalTemplate) return;
        setIsSaving(true);
        const status = publish ? 'published' : 'draft';

        try {
            if ('id' in internalTemplate && internalTemplate.id) {
                await updateTemplate({ ...internalTemplate, status } as FormTemplate);
            } else {
                await addTemplate({ ...internalTemplate, status });
            }
            toast({ title: publish ? 'Formulário publicado!' : 'Rascunho salvo!' });
            onOpenChange(false);
        } finally {
            setIsSaving(false);
        }
    };
    
    const selectedQuestion = useMemo(() => {
        if (!selectedQuestionId || !internalTemplate) return null;
        return internalTemplate.questions?.find(q => q.id === selectedQuestionId) || null;
    }, [selectedQuestionId, internalTemplate]);


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle>{internalTemplate?.name || 'Novo formulário'}</DialogTitle>
                </DialogHeader>
                
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
                    <div className="p-4 border-b">
                        <TabsList>
                            <TabsTrigger value="builder">Editor de Perguntas</TabsTrigger>
                            <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/> Configurações Gerais</TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="builder" className="flex-1 min-h-0">
                        <div className="flex-1 min-h-0 flex h-full">
                            <div className="flex-1 p-4 space-y-2">
                                <Button onClick={handleAddQuestion} className="w-full">
                                    <PlusCircle className="mr-2"/> Adicionar Pergunta
                                </Button>
                                <ScrollArea className="h-[calc(100%-4rem)]">
                                    <div className="space-y-2 pr-4">
                                    {(internalTemplate?.questions || []).map(q => (
                                        <div key={q.id} className="border p-3 rounded-lg flex justify-between items-center hover:bg-muted/50">
                                            <button className="flex-1 text-left" onClick={() => setSelectedQuestionId(q.id)}>
                                                <p className="font-medium">{q.label}</p>
                                                <p className="text-xs text-muted-foreground">{q.type}</p>
                                            </button>
                                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteQuestion(q.id)}>
                                                <Trash2 className="h-4 w-4"/>
                                            </Button>
                                        </div>
                                    ))}
                                    </div>
                                </ScrollArea>
                            </div>
                            {selectedQuestion && (
                                <QuestionSettingsPanel
                                    key={selectedQuestion.id}
                                    question={selectedQuestion}
                                    allQuestions={internalTemplate?.questions || []}
                                    onChange={handleQuestionChange}
                                    onClose={() => setSelectedQuestionId(null)}
                                    users={users}
                                    profiles={profiles}
                                />
                            )}
                        </div>
                    </TabsContent>
                    <TabsContent value="settings" className="flex-1 overflow-auto p-6">
                        {internalTemplate && (
                            <FormGeneralSettings 
                                template={internalTemplate} 
                                onTemplateChange={(updates) => handleTemplateChange(updates)}
                            />
                        )}
                    </TabsContent>
                </Tabs>
                
                <DialogFooter className="p-4 border-t shrink-0">
                    <div className="flex justify-end gap-2">
                         <Button onClick={() => handleSave(false)} variant="secondary" disabled={isSaving}>
                            <Save className="mr-2 h-4 w-4"/>
                            Salvar Rascunho
                        </Button>
                        <Button onClick={() => handleSave(true)} disabled={isSaving}>
                            <FileUp className="mr-2 h-4 w-4" />
                            Publicar
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
