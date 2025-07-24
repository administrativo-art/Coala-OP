
"use client";

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { type FormTemplate, type FormQuestion, type FormSection } from '@/types';
import { Settings, GitBranch, CheckCircle2, FileUp, Undo2, PlusCircle, Pencil, Cloud, Save } from 'lucide-react';
import { FormBuilder } from './form-builder';
import { QuestionSettingsPanel } from './QuestionSettingsPanel';
import { nanoid } from 'nanoid';
import { useAuth } from '@/hooks/use-auth';
import { useProfiles } from '@/hooks/use-profiles';
import { FormGeneralSettings } from './form-general-settings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from '@/hooks/use-toast';
import { Badge } from './ui/badge';
import { ReactFlowProvider, useReactFlow } from 'reactflow';
import { useForm as useFormHook } from '@/hooks/use-form';


type AddEditFormTemplateModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateToEdit: FormTemplate | null;
};

function AddEditFormTemplateModalContent({ open, onOpenChange, templateToEdit }: AddEditFormTemplateModalProps) {
    const { addTemplate, updateTemplate } = useFormHook();
    const [internalTemplate, setInternalTemplate] = useState<FormTemplate | Omit<FormTemplate, 'id' | 'status'> | null>(null);
    const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
    const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
    const { users } = useAuth();
    const { profiles } = useProfiles();
    const [activeTab, setActiveTab] = useState("builder");
    const [isSaving, setIsSaving] = useState<'draft' | 'publish' | false>(false);
    const { toast } = useToast();
    const reactFlowInstance = useReactFlow();

    const handleTemplateChange = useCallback((newTemplate: FormTemplate | Omit<FormTemplate, 'id' | 'status'>) => {
        setInternalTemplate(newTemplate);
    }, []);

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
                  sections: [
                      { id: `section-${nanoid()}`, name: 'Seção 1', questions: [], position: { x: 50, y: 50 }, color: '#FEE2E2' }
                  ],
              };
            setInternalTemplate(initialTemplate);
            setActiveTab("builder");
            setSelectedSectionId(null);
            setSelectedQuestionId(null);
        } else {
            setInternalTemplate(null);
        }
    }, [open, templateToEdit]);
    
    const handleSaveDraft = async () => {
        if (!internalTemplate || ('id' in internalTemplate && internalTemplate.status === 'published')) {
            return;
        }

        setIsSaving('draft');
        try {
            if ('id' in internalTemplate) {
                await updateTemplate({ ...internalTemplate, status: 'draft' } as FormTemplate);
                toast({ title: "Rascunho salvo!" });
            } else {
                const newId = await addTemplate({ ...internalTemplate, status: 'draft' });
                if (newId) {
                    setInternalTemplate(prev => ({ ...prev!, id: newId, status: 'draft' }));
                    toast({ title: "Rascunho salvo!" });
                }
            }
        } finally {
            setIsSaving(false);
        }
    };


    const handleAddSection = () => {
        if (!internalTemplate) return;
        
        const position = reactFlowInstance.project({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
        });

        const newSection: FormSection = {
            id: `section-${nanoid()}`,
            name: `Seção ${internalTemplate.sections.length + 1}`,
            questions: [],
            position: {
                x: position.x - 200, // Center the new section
                y: position.y - 100,
            },
            width: 400,
            height: 200,
            color: '#E2E8F0',
        };
        handleTemplateChange({ ...internalTemplate, sections: [...internalTemplate.sections, newSection] });
    };

    const handleAddQuestion = () => {
        if (!internalTemplate) return;
    
        const viewport = reactFlowInstance.getViewport();
        const position = reactFlowInstance.project({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
        });
    
        const newQuestion: FormQuestion = {
            id: `question-${nanoid()}`,
            label: "Nova Pergunta",
            type: 'text',
            isRequired: false,
            options: [],
            position: {
                x: position.x - 150, // 150 is half node width
                y: position.y - 40, // 40 is half node height
            },
            sectionId: null, // Starts as a floating question
            customColor: undefined,
        };
    
        const newQuestions = [...(internalTemplate.questions || []), newQuestion];
        handleTemplateChange({ ...internalTemplate, questions: newQuestions });
    };

    const handleDeleteQuestion = (questionId: string) => {
        if (!internalTemplate) return;
    
        // Function to clean ramifications pointing to the deleted question
        const cleanRamifications = (questions: FormQuestion[]) => {
            return questions.map(q => {
                if (!q.ramifications) return q;
                const cleanedRamifications = q.ramifications.filter(r => r.targetQuestionId !== questionId);
                return { ...q, ramifications: cleanedRamifications };
            });
        };

        // Remove the question from sections
        const newSections = (internalTemplate.sections || []).map(section => ({
            ...section,
            questions: cleanRamifications((section.questions || []).filter(q => q.id !== questionId))
        }));

        // Remove the question from floating questions
        const newFloatingQuestions = cleanRamifications((internalTemplate.questions || []).filter(q => q.id !== questionId));

        handleTemplateChange({ ...internalTemplate, sections: newSections, questions: newFloatingQuestions });
        
        if (selectedQuestionId === questionId) {
            setSelectedQuestionId(null);
        }
    };
    
    const handlePublish = async () => {
        if (!internalTemplate) return;
        setIsSaving('publish');

        if (!('id' in internalTemplate) || !internalTemplate.id) {
            // This is a new template, add it first
            const newId = await addTemplate({ ...internalTemplate, status: 'published' });
            if(newId) {
                toast({ title: 'Formulário publicado!', description: 'Seu formulário agora está disponível para os usuários.' });
                onOpenChange(false);
            }
        } else {
            await updateTemplate({ ...internalTemplate, status: 'published' } as FormTemplate);
            toast({ title: 'Formulário publicado!', description: 'Seu formulário agora está disponível para os usuários.' });
            onOpenChange(false);
        }
        setIsSaving(false);
    }

    const handleReopen = async () => {
        if (!internalTemplate || !('id' in internalTemplate)) return;
        await updateTemplate({ ...internalTemplate as FormTemplate, status: 'draft' });
        toast({ title: 'Formulário reaberto!', description: 'Agora você pode editar o formulário novamente.' });
    }

    const allQuestions = useMemo(() => {
        if (!internalTemplate) return [];
        const sectionQuestions = (internalTemplate.sections || []).flatMap(s => s.questions || []);
        const floatingQuestions = internalTemplate.questions || [];
        return [...sectionQuestions, ...floatingQuestions];
    }, [internalTemplate]);

    const selectedQuestion = useMemo(() => {
        if (!selectedQuestionId) return null;
        return allQuestions.find(q => q.id === selectedQuestionId) || null;
    }, [selectedQuestionId, allQuestions]);

    const handleQuestionChange = (updatedQuestion: FormQuestion) => {
        if (!internalTemplate) return;

        const updateFn = (q: FormQuestion) => q.id === updatedQuestion.id ? updatedQuestion : q;

        const newSections = (internalTemplate.sections || []).map(section => ({
            ...section,
            questions: (section.questions || []).map(updateFn)
        }));

        const newFloatingQuestions = (internalTemplate.questions || []).map(updateFn);
        
        handleTemplateChange({ ...internalTemplate, sections: newSections, questions: newFloatingQuestions });
    };

    const isPublished = internalTemplate && 'id' in internalTemplate && internalTemplate.status === 'published';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] w-full h-[95vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b flex flex-row items-center justify-between">
                <div>
                    <DialogTitle>{templateToEdit?.name || internalTemplate?.name || 'Novo formulário'}</DialogTitle>
                    <DialogDescription>
                        Use as abas abaixo para configurar o formulário e construir o fluxo de perguntas.
                    </DialogDescription>
                </div>
                </DialogHeader>
                
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
                    <div className="p-4 border-b">
                        <TabsList>
                            <TabsTrigger value="builder"><GitBranch className="mr-2 h-4 w-4"/> Builder Visual</TabsTrigger>
                            <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/> Configurações Gerais</TabsTrigger>
                        </TabsList>
                    </div>
                    <TabsContent value="builder" className="flex-1 min-h-0">
                        <div className="flex-1 min-h-0 flex h-full">
                            {internalTemplate && (
                                <FormBuilder 
                                    key={('id' in internalTemplate && internalTemplate.id) ? internalTemplate.id : 'new'}
                                    template={internalTemplate}
                                    onTemplateChange={handleTemplateChange}
                                    onSelectQuestion={setSelectedQuestionId}
                                    selectedQuestionId={selectedQuestionId}
                                    onSelectSection={setSelectedSectionId}
                                    selectedSectionId={selectedSectionId}
                                    onDeleteQuestion={handleDeleteQuestion}
                                />
                            )}
                            {selectedQuestion && (
                                <QuestionSettingsPanel
                                    key={selectedQuestion.id}
                                    question={selectedQuestion}
                                    allQuestions={allQuestions}
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
                                onTemplateChange={handleTemplateChange}
                            />
                        )}
                    </TabsContent>
                </Tabs>
                
                <DialogFooter className="p-4 border-t shrink-0">
                <div className="w-full flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleAddSection}><PlusCircle className="mr-2 h-4 w-4"/> Seção</Button>
                        <Button variant="outline" onClick={handleAddQuestion}><PlusCircle className="mr-2 h-4 w-4"/> Pergunta</Button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {isPublished ? (
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="bg-green-100 text-green-800">Publicado</Badge>
                                <Button onClick={handleReopen} variant="outline">
                                    <Undo2 className="mr-2 h-4 w-4"/> Reabrir para Edição
                                </Button>
                            </div>
                        ) : (
                            <>
                                <Button onClick={handleSaveDraft} variant="secondary" disabled={isSaving !== false}>
                                    <Save className="mr-2 h-4 w-4"/>
                                    {isSaving === 'draft' ? 'Salvando...' : 'Salvar Rascunho'}
                                </Button>
                                <Button onClick={handlePublish} disabled={isSaving !== false}>
                                    <FileUp className="mr-2 h-4 w-4" />
                                    {isSaving === 'publish' ? 'Publicando...' : 'Publicar'}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function AddEditFormTemplateModal(props: AddEditFormTemplateModalProps) {
    if (!props.open) return null;
    return (
        <ReactFlowProvider>
            <AddEditFormTemplateModalContent {...props} />
        </ReactFlowProvider>
    );
}
